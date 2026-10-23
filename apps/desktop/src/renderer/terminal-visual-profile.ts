import type { ITheme, ITerminalOptions } from "@xterm/xterm";

export type TerminalVisualProfile = {
  cursorBlink: boolean;
  cursorStyle: NonNullable<ITerminalOptions["cursorStyle"]>;
  drawBoldTextInBrightColors: boolean;
  fontFamily: string;
  fontSize: number;
  fontWeight: NonNullable<ITerminalOptions["fontWeight"]>;
  lineHeight: number;
  theme: ITheme;
};

// A Ghostty profile: Geist Mono 13 with the Vesper theme and its own cursor and selection colours.
// Geist Mono has no Nerd Font icons, so the p10k prompt's icons and arrows come from the next font that has them.
// ponytail: Geist Mono and the Nerd Fonts must be installed; without them the terminal falls back to the system monospace.
export const ghosttyVesperTerminalProfile: TerminalVisualProfile = {
  cursorBlink: true,
  cursorStyle: "bar",
  drawBoldTextInBrightColors: false,
  fontFamily: '"Geist Mono", "JetBrainsMono NFM", "MesloLGS Nerd Font Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
  fontSize: 13,
  // Regular: Medium rendered heavier than the Ghostty reference.
  fontWeight: "normal",
  // Ghostty reports an 18 px cell (CSI 16 t); 1.06 gives Geist Mono 13 the same row in xterm.
  lineHeight: 1.06,
  theme: {
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
  },
};
