import { describe, expect, it } from "vitest";
import { alfredGraphiteTerminalProfile, ghosttyVesperTerminalProfile } from "./terminal-visual-profile";

describe("alfredGraphiteTerminalProfile", () => {
  it("keeps Alfred's xterm font and cursor defaults intact", () => {
    expect(alfredGraphiteTerminalProfile.fontFamily).toContain("GeistMono Nerd Font");
    expect(alfredGraphiteTerminalProfile.fontFamily).toContain("Geist Mono");
    expect(alfredGraphiteTerminalProfile.fontFamily).toContain("JetBrainsMono Nerd Font");
    expect(alfredGraphiteTerminalProfile.fontSize).toBe(13);
    expect(alfredGraphiteTerminalProfile.cursorBlink).toBe(true);
    expect(alfredGraphiteTerminalProfile.cursorStyle).toBe("bar");
    expect(alfredGraphiteTerminalProfile.lineHeight).toBe(1.32);
  });

  it("keeps Alfred's tactical graphite xterm surface aligned with CSS tokens", () => {
    expect(alfredGraphiteTerminalProfile.theme.background).toBe("#0a0e12");
    expect(alfredGraphiteTerminalProfile.theme.cursor).toBe("#6ee7ff");
    expect(alfredGraphiteTerminalProfile.theme.selectionBackground).toBe("#12313a");
  });

  it("keeps the legacy Ghostty export wired to Alfred's graphite profile", () => {
    expect(ghosttyVesperTerminalProfile).toBe(alfredGraphiteTerminalProfile);
  });
});
