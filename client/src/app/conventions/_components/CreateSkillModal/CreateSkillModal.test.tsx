import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeSkillDefaults, renderWithProviders } from "../../_lib/test-utils";
import { CreateSkillModal } from "./CreateSkillModal";
import { approxTokens } from "./constants";
import { validateDraft, hasErrors } from "./helpers";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Submit = Parameters<typeof CreateSkillModal>[0]["onSubmit"];

function setup(over: Partial<Parameters<typeof CreateSkillModal>[0]> = {}) {
  const onSubmit = vi.fn<Submit>();
  const onCancel = vi.fn<() => void>();
  renderWithProviders(
    <CreateSkillModal
      repoName="payments-api"
      acceptedCount={3}
      defaults={makeSkillDefaults()}
      saving={false}
      serverError={null}
      onCancel={onCancel}
      onSubmit={onSubmit}
      {...over}
    />,
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

describe("CreateSkillModal", () => {
  it("prefills every field from the server defaults", () => {
    setup();
    expect(screen.getByDisplayValue("payments-api-conventions")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("1 house convention extracted from payments-api"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/# payments-api-conventions/),
    ).toBeInTheDocument();
  });

  it("says how many conventions were merged, and that everything is editable", () => {
    setup();
    expect(
      screen.getByText(/Merged from 3 accepted conventions in payments-api/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Everything below is editable before you save/)).toBeInTheDocument();
  });

  it("submits nothing until Create skill is pressed", async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByDisplayValue("payments-api-conventions"), "-v2");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Create skill/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  /** Homework criterion 41: the BODY and the metadata are editable, not just the name. */
  it("sends the edited body and metadata", async () => {
    const { onSubmit, user } = setup();

    const name = screen.getByDisplayValue("payments-api-conventions");
    await user.clear(name);
    await user.type(name, "my-conventions");

    const body = screen.getByDisplayValue(/# payments-api-conventions/);
    await user.clear(body);
    await user.type(body, "# rewritten by hand");

    await user.selectOptions(screen.getByRole("combobox"), "security");
    await user.click(screen.getByRole("switch"));

    await user.click(screen.getByRole("button", { name: /Create skill/ }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "my-conventions",
      description: "1 house convention extracted from payments-api",
      type: "security",
      body: "# rewritten by hand",
      enabled: false,
    });
  });

  it("blocks submission when a required field is emptied", async () => {
    const { onSubmit, user } = setup();
    await user.clear(screen.getByDisplayValue("payments-api-conventions"));
    await user.click(screen.getByRole("button", { name: /Create skill/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("marks the body unsaved once it differs from the default", async () => {
    const { user } = setup();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    await user.type(screen.getByDisplayValue(/# payments-api-conventions/), "x");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("switches the body between Write and Preview", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByDisplayValue(/# payments-api-conventions/)).not.toBeInTheDocument();
    // The markdown heading is rendered instead of the raw textarea.
    expect(screen.getByRole("heading", { name: "payments-api-conventions" })).toBeInTheDocument();
  });

  it("cancels without submitting", async () => {
    const { onCancel, onSubmit, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces a server error", () => {
    setup({ serverError: 'A skill named "payments-api-conventions" already exists' });
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
  });
});

describe("CreateSkillModal helpers", () => {
  it("approximates tokens the way the server tokenizer falls back", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });

  it("validates required and over-long fields", () => {
    expect(hasErrors(validateDraft({ name: "n", description: "d", body: "b" }))).toBe(false);
    expect(validateDraft({ name: "  ", description: "d", body: "b" }).name).toEqual({
      key: "required",
    });
    expect(validateDraft({ name: "n".repeat(81), description: "d", body: "b" }).name).toEqual({
      key: "tooLong",
      values: { max: 80 },
    });
  });
});
