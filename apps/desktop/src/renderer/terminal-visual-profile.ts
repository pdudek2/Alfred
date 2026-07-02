import type { ITheme, ITerminalOptions } from "@xterm/xterm";

export type TerminalVisualProfile = {
  cursorBlink: boolean;
  cursorStyle: NonNullable<ITerminalOptions["cursorStyle"]>;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: ITheme;
};

export const alfredGraphiteTerminalProfile: TerminalVisualProfile = {
  cursorBlink: true,
  cursorStyle: "bar",
  fontFamily:
    '"GeistMono Nerd Font", "Geist Mono", "JetBrainsMono Nerd Font", "JetBrains Mono", "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 13,
  lineHeight: 1.32,
  theme: {
    background: "#0a0e12",
    foreground: "#ffffff",
    cursor: "#6ee7ff",
    cursorAccent: "#0a0e12",
    selectionBackground: "#12313a",
    selectionForeground: "#ffffff",
    black: "#101010",
    blue: "#6699ff",
    brightBlack: "#666666",
    brightBlue: "#99bbff",
    brightCyan: "#33eeff",
    brightGreen: "#8cff9a",
    brightMagenta: "#ff8ad8",
    brightRed: "#ff8a8a",
    brightWhite: "#ffffff",
    brightYellow: "#ffe080",
    cyan: "#00e0ff",
    green: "#5de471",
    magenta: "#ff4db8",
    red: "#ff5c57",
    white: "#f4f4f4",
    yellow: "#f3d779",
  },
};

export const ghosttyVesperTerminalProfile = alfredGraphiteTerminalProfile;
