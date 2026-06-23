export type TerminalScrollbackRetention = "off" | "redactedTail";

export type DesktopPrivacySettings = {
  terminalScrollbackRetention: TerminalScrollbackRetention;
  externalSessionIndexingEnabled: boolean;
};

export type DesktopSaveStatus =
  | { status: "saved" }
  | { status: "saveFailed"; message: string; failedAt: number };

export type DesktopStateClearSavedTerminalDataResult =
  | { ok: true; clearedSessions: number }
  | { ok: false; error: string };

export type DesktopStateRevealFileResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; error: string; resolvedPath?: string };

export type DesktopStateApi = {
  getPrivacySettings(): Promise<DesktopPrivacySettings>;
  updatePrivacySettings(settings: DesktopPrivacySettings): Promise<DesktopPrivacySettings>;
  clearSavedTerminalData(): Promise<DesktopStateClearSavedTerminalDataResult>;
  revealStateFile(): Promise<DesktopStateRevealFileResult>;
  retrySave(): Promise<DesktopSaveStatus>;
  onSaveStatus(callback: (status: DesktopSaveStatus) => void): () => void;
};

export const desktopStateChannels = {
  getPrivacySettings: "alfred:desktop-state:get-privacy-settings",
  updatePrivacySettings: "alfred:desktop-state:update-privacy-settings",
  clearSavedTerminalData: "alfred:desktop-state:clear-saved-terminal-data",
  revealStateFile: "alfred:desktop-state:reveal-state-file",
  retrySave: "alfred:desktop-state:retry-save",
  saveStatus: "alfred:desktop-state:save-status",
} as const;
