import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Briefing } from "../components/briefing";
import type { BriefingVM } from "../lib/briefing";

const vm: BriefingVM = {
  voice: "morning",
  pieces: [
    { kind: "text", value: "Codex is on " },
    { kind: "highlight", value: "alfred-runner", runId: "r1" },
    { kind: "text", value: " right now - " },
    { kind: "highlight", value: "12m", runId: "r1" },
    { kind: "text", value: " in." },
  ],
};

function renderBriefing(testVm = vm, onHighlight = vi.fn()) {
  const result = render(<Briefing vm={testVm} onHighlight={onHighlight} />);
  const paragraph = result.container.querySelector("p[aria-live='polite']");

  expect(paragraph).toBeInTheDocument();
  return { ...result, paragraph: paragraph as HTMLParagraphElement, onHighlight };
}

describe("Briefing", () => {
  afterEach(() => cleanup());

  it("renders text and highlight pieces in order", () => {
    const { paragraph } = renderBriefing();

    expect(paragraph).toHaveTextContent("Codex is on alfred-runner right now - 12m in.");
    expect(screen.getByRole("button", { name: "alfred-runner" })).toHaveClass("reader-briefing__highlight");
    expect(screen.getByRole("button", { name: "12m" })).toHaveClass("reader-briefing__highlight");
  });

  it("calls onHighlight with the runId when a highlight is clicked", async () => {
    const user = userEvent.setup();
    const onHighlight = vi.fn();
    renderBriefing(vm, onHighlight);

    await user.click(screen.getByRole("button", { name: "alfred-runner" }));

    expect(onHighlight).toHaveBeenCalledTimes(1);
    expect(onHighlight).toHaveBeenCalledWith("r1");
  });

  it("keeps highlight buttons keyboard-focusable and visually inline", async () => {
    const user = userEvent.setup();
    renderBriefing();

    await user.tab();

    expect(screen.getByRole("button", { name: "alfred-runner" })).toHaveFocus();
  });

  it("applies a voice-specific class for styling", () => {
    const { paragraph } = renderBriefing();

    expect(paragraph).toHaveClass("reader-briefing", "reader-briefing--morning");
  });

  it("announces paragraph updates politely", () => {
    const { paragraph } = renderBriefing();

    expect(paragraph).toHaveAttribute("aria-live", "polite");
  });
});
