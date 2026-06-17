import type { TerminalApi } from "../shared/terminal-ipc";
import type { AlfredApi } from "../shared/alfred-ipc";
import type { LayoutApi } from "../shared/layout-ipc";
import type { SessionIndexApi } from "../shared/session-index-ipc";
import type { WorkspaceApi } from "../shared/workspace-ipc";

declare global {
  interface Window {
    alfredDesktop?: {
      terminal: TerminalApi;
      alfred: AlfredApi;
      layout: LayoutApi;
      sessionIndex?: SessionIndexApi;
      workspace?: WorkspaceApi;
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

export function getDesktopWorkspaceApi(): WorkspaceApi | null {
  return window.alfredDesktop?.workspace ?? null;
}

export function getDesktopSessionIndexApi(): SessionIndexApi | null {
  return window.alfredDesktop?.sessionIndex ?? null;
}
