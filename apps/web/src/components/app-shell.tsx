import type { RunListItem } from "../lib/api-client";
import { useKeyboardShortcut } from "../lib/use-keyboard-shortcut";
import { Observatory } from "./observatory";
import { Reader } from "./reader";
import { Sigil } from "./sigil";

export type AppShellMode = "reader" | "observatory";

type AppShellProps = {
  error?: unknown;
  loading?: boolean;
  mode: AppShellMode;
  now: Date;
  onModeChange: (mode: AppShellMode) => void;
  onSelectRun?: (runId: string | null) => void;
  runs: RunListItem[];
  selectedRunId?: string | null;
};

export function AppShell({
  error,
  loading = false,
  mode,
  now,
  onModeChange,
  onSelectRun,
  runs,
  selectedRunId = null,
}: AppShellProps) {
  const toggleMode = () => onModeChange(mode === "reader" ? "observatory" : "reader");

  useKeyboardShortcut("mod+o", toggleMode, { ignoreEditable: true });

  return (
    <div className={`next-app-shell next-app-shell-${mode}`}>
      <header className="next-app-shell-header">
        <button
          aria-label={mode === "reader" ? "Open observatory" : "Return to reader"}
          className="next-app-shell-sigil-button"
          onClick={toggleMode}
          type="button"
        >
          <Sigil />
          <span className="next-app-shell-wordmark">Alfred</span>
        </button>
        <span className="next-app-shell-day">{formatDay(now)}</span>
      </header>

      <main className="next-app-shell-body">
        {mode === "reader" ? (
          <Reader
            error={error}
            loading={loading}
            now={now}
            onSelectRun={onSelectRun ?? (() => {})}
            runs={runs}
            selectedRunId={selectedRunId}
          />
        ) : (
          <Observatory now={now} onSelectRun={(runId) => onSelectRun?.(runId)} runs={runs} />
        )}
      </main>
    </div>
  );
}

function formatDay(now: Date): string {
  const day = now.toLocaleDateString("en-US", { weekday: "long" });
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });

  return `${day} ${time}`;
}
