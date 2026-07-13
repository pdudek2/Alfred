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
  fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 12.5,
  lineHeight: 1.62,
  theme: {
    background: "#0A0C0F",
    foreground: "#C9CED5",
    cursor: "#EDF0F3",
    cursorAccent: "#0A0C0F",
    selectionBackground: "#1D2228",
    selectionForeground: "#EDF0F3",
    black: "#14181D",
    red: "#C97F76",
    green: "#7FAE8F",
    yellow: "#CBA96A",
    blue: "#7FA5C9",
    magenta: "#A98FC9",
    cyan: "#7FB8B4",
    white: "#C9CED5",
    brightBlack: "#2A313A",
    brightRed: "#DBA39B",
    brightGreen: "#9CC7AA",
    brightYellow: "#E0C188",
    brightBlue: "#9DBCD9",
    brightMagenta: "#C0A9D9",
    brightCyan: "#9CCFCB",
    brightWhite: "#EDF0F3",
  },
};

export const ghosttyVesperTerminalProfile = alfredGraphiteTerminalProfile;
