import { useId, useLayoutEffect, useRef, useState } from "react";
import type {
  DesktopPrivacySettings,
  DesktopSaveStatus,
  DesktopStateClearSavedTerminalDataResult,
  DesktopStateRevealFileResult,
} from "../../shared/desktop-state-ipc";
import "./settings-page.css";

export type SettingsPageProps = {
  saveStatus: DesktopSaveStatus;
  settings: DesktopPrivacySettings;
  onClearSavedTerminalData: () => Promise<DesktopStateClearSavedTerminalDataResult>;
  onLeave: () => void;
  onRevealStateFile: () => Promise<DesktopStateRevealFileResult>;
  onRetrySave: () => Promise<void>;
  onUpdateSettings: (settings: DesktopPrivacySettings) => Promise<void>;
};

/** Settings is a surface beside Deck and History; Escape leaves it as it leaves History. */
export function SettingsPage({
  saveStatus,
  settings,
  onClearSavedTerminalData,
  onLeave,
  onRevealStateFile,
  onRetrySave,
  onUpdateSettings,
}: SettingsPageProps) {
  const [clearArmed, setClearArmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const privacyHeadingId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const clearActionRef = useRef<HTMLButtonElement | null>(null);
  const keepDataButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreClearFocusRef = useRef(false);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (clearArmed) {
      keepDataButtonRef.current?.focus();
    } else if (restoreClearFocusRef.current) {
      restoreClearFocusRef.current = false;
      clearActionRef.current?.focus();
    }
  }, [clearArmed]);

  const updateRetention = (terminalScrollbackRetention: DesktopPrivacySettings["terminalScrollbackRetention"]) => {
    setMessage(null);
    void onUpdateSettings({ ...settings, terminalScrollbackRetention });
  };

  const clearSavedTerminalData = async () => {
    const result = await onClearSavedTerminalData();
    restoreClearFocusRef.current = true;
    setClearArmed(false);
    setMessage(
      result.ok
        ? `Cleared saved data for ${result.clearedSessions} session${result.clearedSessions === 1 ? "" : "s"}.`
        : result.error,
    );
  };

  const revealStateFile = async () => {
    const result = await onRevealStateFile();
    setMessage(result.ok ? "Local state file revealed." : result.error);
  };

  const cancelClearSavedTerminalData = () => {
    restoreClearFocusRef.current = true;
    setClearArmed(false);
  };

  return (
    <section
      className="settings-page"
      aria-label="Settings"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (clearArmed) cancelClearSavedTerminalData();
        else onLeave();
      }}
    >
      <section className="settings-section" aria-labelledby={privacyHeadingId}>
        <header className="settings-section-header">
          <h2 ref={headingRef} id={privacyHeadingId} tabIndex={-1}>Local Data & Privacy</h2>
          <p>Choose what Alfred keeps on this Mac.</p>
        </header>

        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>Saved terminal output</strong>
            <span>{settings.terminalScrollbackRetention === "off" ? "Alfred keeps each session's name, folder and conversation so it can resume, but no terminal output or agent events." : "Alfred keeps the last 80,000 characters of each terminal and the agent events, with detected secrets removed."}</span>
          </div>
          <div className="settings-segmented" role="group" aria-label="Saved terminal output">
            <button
              type="button"
              aria-pressed={settings.terminalScrollbackRetention === "redactedTail"}
              onClick={() => updateRetention("redactedTail")}
            >
              Keep recent
            </button>
            <button
              type="button"
              aria-pressed={settings.terminalScrollbackRetention === "off"}
              onClick={() => updateRetention("off")}
            >
              Off
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>Asleep sessions</strong>
            <span>
              Clear Alfred&apos;s saved terminal output, activity previews, the draft plan, and the agent event log.
              This can&apos;t be undone.
            </span>
          </div>
          {clearArmed ? (
            <div className="settings-confirm-actions">
              <button ref={keepDataButtonRef} type="button" className="settings-button" onClick={cancelClearSavedTerminalData}>
                Keep data
              </button>
              <button type="button" className="settings-button danger" onClick={() => void clearSavedTerminalData()}>
                Clear asleep sessions
              </button>
            </div>
          ) : (
            <button ref={clearActionRef} type="button" className="settings-button danger" onClick={() => setClearArmed(true)}>
              Clear asleep sessions…
            </button>
          )}
        </div>

        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>Local state file</strong>
            <span>Reveal Alfred's desktop state file in Finder.</span>
          </div>
          <button type="button" className="settings-button outlined" onClick={() => void revealStateFile()}>
            Reveal in Finder
          </button>
        </div>

        {saveStatus.status === "saveFailed" && (
          <div className="settings-notice error" role="alert">
            <span>{saveStatus.message}</span>
            <button type="button" className="settings-button" onClick={() => void onRetrySave()}>
              Retry
            </button>
          </div>
        )}
        {message && (
          <div className="settings-notice" role="status">
            {message}
          </div>
        )}
      </section>
    </section>
  );
}
