import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionStatusGlyphKind } from "./SessionStatusGlyph";
import { SessionStatusGlyph } from "./SessionStatusGlyph";
import { SESSION_STATE_LABELS } from "../session-status";

afterEach(() => {
  cleanup();
});

const statusLabels = SESSION_STATE_LABELS;

const statusCases = Object.entries(statusLabels) as ReadonlyArray<readonly [SessionStatusGlyphKind, string]>;

describe("SessionStatusGlyph", () => {
  it.each(statusCases)("renders an accessible glyph for %s", (kind, label) => {
    render(<SessionStatusGlyph kind={kind} label={label} />);
    expect(screen.getByLabelText(`status ${label}`)).toBeInTheDocument();
  });

  it("draws the v4 canvas shape for each state", () => {
    const glyph = (kind: SessionStatusGlyphKind) => {
      const { container } = render(<SessionStatusGlyph kind={kind} label={kind} />);
      return container.querySelector(".session-status-glyph")!;
    };

    expect(glyph("needs-you").querySelector(".glyph-star-fill")).not.toBeNull();
    expect(glyph("your-turn").querySelector(".glyph-star-outline")).not.toBeNull();
    expect(glyph("your-turn").querySelector(".glyph-star-fill")).toBeNull();
    for (const kind of ["working", "running"] as const) {
      const node = glyph(kind);
      expect(node).toHaveClass(`status-${kind}`);
      expect(node.querySelector(".glyph-arc")).not.toBeNull();
    }
    expect(glyph("draft").querySelector(".glyph-dashed")).not.toBeNull();
    expect(glyph("failed").querySelector(".glyph-dot")).not.toBeNull();
    expect(glyph("idle").querySelectorAll("svg > *")).toHaveLength(1);
  });
});
