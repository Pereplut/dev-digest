import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MermaidDiagram } from "./MermaidDiagram";

/* Spec 0017 (Onboarding Generator), AC-75: all three ways this component can
   fail to render a diagram — failing the keyword test, `mermaid.parse`
   returning `false`, and the lazy import/render throwing — land on the same
   "invalid" state, which the new `fallback` prop now fills instead of `null`. */

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("mermaid");
});

describe("MermaidDiagram", () => {
  it("renders the fallback and no svg for a source that is not mermaid (fails the keyword test)", async () => {
    render(<MermaidDiagram chart="see the drawing above" fallback={<p>Diagram unavailable.</p>} />);

    expect(await screen.findByText("Diagram unavailable.")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("renders the fallback and no svg when mermaid.parse returns false", async () => {
    vi.doMock("mermaid", () => ({
      default: {
        initialize: vi.fn(),
        parse: vi.fn().mockResolvedValue(false),
        render: vi.fn(),
      },
    }));
    const { MermaidDiagram: Mocked } = await import("./MermaidDiagram");

    render(<Mocked chart="flowchart TD\nA-->B" fallback={<p>Diagram unavailable.</p>} />);

    expect(await screen.findByText("Diagram unavailable.")).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("renders the svg and no fallback when mermaid parses and renders", async () => {
    vi.doMock("mermaid", () => ({
      default: {
        initialize: vi.fn(),
        parse: vi.fn().mockResolvedValue(true),
        render: vi.fn().mockResolvedValue({ svg: '<svg data-ok="1"/>' }),
      },
    }));
    const { MermaidDiagram: Mocked } = await import("./MermaidDiagram");

    render(<Mocked chart="flowchart TD\nA-->B" fallback={<p>Diagram unavailable.</p>} />);

    await waitFor(() => expect(document.querySelector("svg[data-ok]")).not.toBeNull());
    expect(screen.queryByText("Diagram unavailable.")).not.toBeInTheDocument();
  });

  it("renders nothing (no fallback prop) on an invalid source", async () => {
    const { container } = render(<MermaidDiagram chart="not mermaid" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
