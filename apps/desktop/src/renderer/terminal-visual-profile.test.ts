import { describe, expect, it } from "vitest";
import { alfredGraphiteTerminalProfile, ghosttyVesperTerminalProfile } from "./terminal-visual-profile";

describe("alfredGraphiteTerminalProfile", () => {
  it("uses the approved graphite typography and cursor defaults", () => {
    expect(alfredGraphiteTerminalProfile.fontFamily).toBe(
      '"SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    );
    expect(alfredGraphiteTerminalProfile.fontSize).toBe(12.5);
    expect(alfredGraphiteTerminalProfile.cursorBlink).toBe(true);
    expect(alfredGraphiteTerminalProfile.cursorStyle).toBe("bar");
    expect(alfredGraphiteTerminalProfile.lineHeight).toBe(1.62);
  });

  it("uses the approved graphite xterm palette", () => {
    expect(alfredGraphiteTerminalProfile.theme).toEqual({
      background: "#09090A",
      foreground: "#CACACF",
      cursor: "#F0F0F2",
      cursorAccent: "#09090A",
      selectionBackground: "#1B1B1E",
      selectionForeground: "#F0F0F2",
      black: "#111113",
      red: "#C97F76",
      green: "#7FAE8F",
      yellow: "#CBA96A",
      blue: "#7FA5C9",
      magenta: "#A98FC9",
      cyan: "#7FB8B4",
      white: "#CACACF",
      brightBlack: "#39393F",
      brightRed: "#DBA39B",
      brightGreen: "#9CC7AA",
      brightYellow: "#E0C188",
      brightBlue: "#9DBCD9",
      brightMagenta: "#C0A9D9",
      brightCyan: "#9CCFCB",
      brightWhite: "#F0F0F2",
    });
  });

  it("keeps the legacy Ghostty export wired to Alfred's graphite profile", () => {
    expect(ghosttyVesperTerminalProfile).toBe(alfredGraphiteTerminalProfile);
  });
});
