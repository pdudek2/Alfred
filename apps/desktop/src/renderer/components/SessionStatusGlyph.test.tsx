import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionStatusGlyphKind } from "./SessionStatusGlyph";
import { SessionStatusGlyph } from "./SessionStatusGlyph";

afterEach(() => {
  cleanup();
});

const statusLabels: Record<SessionStatusGlyphKind, string> = {
  active: "active",
  blocked: "blocked",
  done: "done",
  error: "error",
  idle: "idle",
  restored: "restored",
  runtime: "unavailable",
  staged: "ready",
  checking: "checking",
  starting: "starting",
  waiting: "waiting",
};

const statusCases = Object.entries(statusLabels) as ReadonlyArray<readonly [SessionStatusGlyphKind, string]>;

describe("SessionStatusGlyph", () => {
  it.each(statusCases)("renders an accessible glyph for %s", (kind, label) => {
    render(<SessionStatusGlyph kind={kind} label={label} />);
    expect(screen.getByLabelText(`status ${label}`)).toBeInTheDocument();
  });
});
