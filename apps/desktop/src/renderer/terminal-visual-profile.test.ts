import { describe, expect, it } from "vitest";
import { ghosttyVesperTerminalProfile } from "./terminal-visual-profile";

describe("ghosttyVesperTerminalProfile", () => {
  it("maps Patryk's Ghostty Vesper basics to xterm options", () => {
    expect(ghosttyVesperTerminalProfile.fontFamily).toContain("GeistMono Nerd Font");
    expect(ghosttyVesperTerminalProfile.fontFamily).toContain("Geist Mono");
    expect(ghosttyVesperTerminalProfile.fontFamily).toContain("JetBrainsMono Nerd Font");
    expect(ghosttyVesperTerminalProfile.fontSize).toBe(13);
    expect(ghosttyVesperTerminalProfile.cursorBlink).toBe(true);
    expect(ghosttyVesperTerminalProfile.cursorStyle).toBe("bar");
    expect(ghosttyVesperTerminalProfile.lineHeight).toBe(1.32);
  });

  it("uses Ghostty selection and cursor colors with a Vesper-like palette", () => {
    expect(ghosttyVesperTerminalProfile.theme.background).toBe("#101010");
    expect(ghosttyVesperTerminalProfile.theme.foreground).toBe("#ffffff");
    expect(ghosttyVesperTerminalProfile.theme.cursor).toBe("#b9aeda");
    expect(ghosttyVesperTerminalProfile.theme.cursorAccent).toBe("#101010");
    expect(ghosttyVesperTerminalProfile.theme.selectionBackground).toBe("#3a2a38");
    expect(ghosttyVesperTerminalProfile.theme.selectionForeground).toBe("#ffffff");
    expect(ghosttyVesperTerminalProfile.theme.green).toBe("#5de471");
    expect(ghosttyVesperTerminalProfile.theme.magenta).toBe("#ff4db8");
    expect(ghosttyVesperTerminalProfile.theme.cyan).toBe("#00e0ff");
  });
});
