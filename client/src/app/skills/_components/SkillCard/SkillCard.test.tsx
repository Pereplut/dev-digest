import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeSkill, renderWithProviders } from "../../_lib/test-utils";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

describe("SkillCard", () => {
  it("shows the skill's type, source and metrics; the toggle never selects the card", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn<() => void>();
    const onToggle = vi.fn<(enabled: boolean) => void>();
    renderWithProviders(<SkillCard skill={makeSkill()} onClick={onClick} onToggle={onToggle} />);

    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    expect(screen.getByText("71% pull")).toBeInTheDocument();
    expect(screen.getByText("74% accept")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /enable pr-quality-rubric/i }));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();

    // Space on the focused switch toggles only.
    screen.getByRole("switch").focus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onClick).not.toHaveBeenCalled();

    // Enter on the card itself selects it.
    screen.getByRole("button", { name: /pr-quality-rubric/ }).focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders — for rates with nothing to divide by and labels imported skills", () => {
    renderWithProviders(
      <SkillCard
        skill={makeSkill({
          source: "imported_file",
          stats: { agent_count: 1, pull_rate: null, accept_rate: null },
        })}
        onClick={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(screen.getByText("— pull")).toBeInTheDocument();
    expect(screen.getByText("— accept")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
  });
});
