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
  },
};

export const ghosttyVesperTerminalProfile = alfredGraphiteTerminalProfile;
