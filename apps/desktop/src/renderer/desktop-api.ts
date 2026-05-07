import type { TerminalApi } from "../shared/terminal-ipc";
import type { AlfredApi } from "../shared/alfred-ipc";
import type { LayoutApi } from "../shared/layout-ipc";

declare global {
  interface Window {
    alfredDesktop?: {
      terminal: TerminalApi;
      alfred: AlfredApi;
      layout: LayoutApi;
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

export function getDesktopLayoutApi(): LayoutApi | null {
  return window.alfredDesktop?.layout ?? null;
}
