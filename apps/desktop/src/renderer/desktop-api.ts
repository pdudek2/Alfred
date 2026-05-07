import type { TerminalApi } from "../shared/terminal-ipc";
import type { AlfredApi } from "../shared/alfred-ipc";

declare global {
  interface Window {
    alfredDesktop?: {
      terminal: TerminalApi;
      alfred: AlfredApi;
      version: string;
    };
  }
}

export function getDesktopTerminalApi(): TerminalApi | null {
  return window.alfredDesktop?.terminal ?? null;
}

export function getDesktopAlfredApi(): AlfredApi | null {
  return window.alfredDesktop?.alfred ?? null;
}
