import { describe, expect, it } from "vitest";
import { ghosttyVesperTerminalProfile } from "./terminal-visual-profile";

// Patryk's Ghostty: Geist Mono 13 with the Vesper theme, his own cursor and selection colours.
describe("ghosttyVesperTerminalProfile", () => {
  it("uses Geist Mono 13 with a Nerd Font for the prompt's icons, then the system monospace", () => {
    expect(ghosttyVesperTerminalProfile.fontFamily).toBe(
      '"Geist Mono", "JetBrainsMono NFM", "MesloLGS Nerd Font Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
    );
    expect(ghosttyVesperTerminalProfile.fontSize).toBe(13);
    // Ghostty reports an 18 px cell (CSI 16 t); 1.06 gives Geist Mono 13 the same row in xterm.
    expect(ghosttyVesperTerminalProfile.lineHeight).toBe(1.06);
    // Medium stands in for Ghostty's font-thicken.
    expect(ghosttyVesperTerminalProfile.fontWeight).toBe(500);
    expect(ghosttyVesperTerminalProfile.cursorBlink).toBe(true);
    expect(ghosttyVesperTerminalProfile.cursorStyle).toBe("bar");
    // Ghostty draws bold in the normal colour (bold-is-bright = false).
    expect(ghosttyVesperTerminalProfile.drawBoldTextInBrightColors).toBe(false);
  });

  it("uses the Vesper palette with Patryk's cursor and selection", () => {
    expect(ghosttyVesperTerminalProfile.theme).toEqual({
      background: "#101010",
      foreground: "#ffffff",
      cursor: "#b9aeda",
      cursorAccent: "#ffffff",
      selectionBackground: "#3a2a38",
      selectionForeground: "#ffffff",
      black: "#101010",
      red: "#f5a191",
      green: "#90b99f",
      yellow: "#e6b99d",
      blue: "#aca1cf",
      magenta: "#e29eca",
      cyan: "#ea83a5",
      white: "#a0a0a0",
      brightBlack: "#7e7e7e",
      brightRed: "#ff8080",
      brightGreen: "#99ffe4",
      brightYellow: "#ffc799",
      brightBlue: "#b9aeda",
      brightMagenta: "#ecaad6",
      brightCyan: "#f591b2",
      brightWhite: "#ffffff",
    });
  });
});
