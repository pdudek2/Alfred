export type TerminalScrollbackRetention = "off" | "redactedTail";

export type DesktopPrivacySettings = {
  terminalScrollbackRetention: TerminalScrollbackRetention;
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

/** A newer Alfred Preview release is built: a window reload loads it, or it needs a restart (main-process change). */
export type DesktopUpdate = {
  sha: string;
  subject: string;
  ref: string;
  action: "reload" | "restart";
  reloadFailed?: boolean;
};

export type DesktopStateApi = {
  getPrivacySettings(): Promise<DesktopPrivacySettings>;
  updatePrivacySettings(settings: DesktopPrivacySettings): Promise<DesktopPrivacySettings>;
  clearSavedTerminalData(): Promise<DesktopStateClearSavedTerminalDataResult>;
  revealStateFile(): Promise<DesktopStateRevealFileResult>;
  retrySave(): Promise<DesktopSaveStatus>;
  onSaveStatus(callback: (status: DesktopSaveStatus) => void): () => void;
  getUpdate(): Promise<DesktopUpdate | null>;
  applyUpdate(action: DesktopUpdate["action"]): Promise<void>;
  onUpdate(callback: (update: DesktopUpdate | null) => void): () => void;
};

export const desktopStateChannels = {
  getPrivacySettings: "alfred:desktop-state:get-privacy-settings",
  updatePrivacySettings: "alfred:desktop-state:update-privacy-settings",
  clearSavedTerminalData: "alfred:desktop-state:clear-saved-terminal-data",
  revealStateFile: "alfred:desktop-state:reveal-state-file",
  retrySave: "alfred:desktop-state:retry-save",
  saveStatus: "alfred:desktop-state:save-status",
  getUpdate: "alfred:desktop-state:get-update",
  applyUpdate: "alfred:desktop-state:apply-update",
  update: "alfred:desktop-state:update",
} as const;
