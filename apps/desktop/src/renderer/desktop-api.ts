import type { TerminalApi } from "../shared/terminal-ipc";
import type { AlfredApi } from "../shared/alfred-ipc";
import type { DesktopStateApi } from "../shared/desktop-state-ipc";
import type { LayoutApi } from "../shared/layout-ipc";
import type { SessionsApi } from "../shared/sessions-ipc";
import type { WorkspaceApi } from "../shared/workspace-ipc";

declare global {
  interface Window {
    alfredDesktop?: {
      terminal: TerminalApi;
      alfred: AlfredApi;
      desktopState?: DesktopStateApi;
      layout: LayoutApi;
      sessions?: SessionsApi;
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

export function getDesktopStateApi(): DesktopStateApi | null {
  return window.alfredDesktop?.desktopState ?? null;
}

export function getDesktopLayoutApi(): LayoutApi | null {
  return window.alfredDesktop?.layout ?? null;
}

export function getDesktopWorkspaceApi(): WorkspaceApi | null {
  return window.alfredDesktop?.workspace ?? null;
}

export function getDesktopSessionsApi(): SessionsApi | null {
  return window.alfredDesktop?.sessions ?? null;
}
