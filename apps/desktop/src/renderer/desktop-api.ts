import type { TerminalApi } from "../shared/terminal-ipc";

declare global {
  interface Window {
    alfredDesktop?: {
      terminal: TerminalApi;
      version: string;
    };
  }
}

export function getDesktopTerminalApi(): TerminalApi | null {
  return window.alfredDesktop?.terminal ?? null;
}
