import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ExternalLink, MoreHorizontal, RefreshCw, WifiOff, X } from "lucide-react";
import type { PreviewUrlCandidate } from "../preview-state";
import { ChromeMenu, type ChromeMenuItem } from "./ChromeMenu";

type PreviewReachability = "checking" | "online" | "offline";

export type WorkspacePreviewPanelProps = {
  candidates: PreviewUrlCandidate[];
  refreshKey: number;
  selectedUrl: string | null;
  workspaceLabel: string;
  onClose: () => void;
  onCopyUrl: (url: string) => Promise<void> | void;
  onOpenExternal: (url: string) => Promise<void> | void;
  onRefresh: () => void;
  onSelectUrl: (url: string) => void;
};

export function WorkspacePreviewPanel({
  candidates,
  refreshKey,
  selectedUrl,
  workspaceLabel,
  onClose,
  onCopyUrl,
  onOpenExternal,
  onRefresh,
  onSelectUrl,
}: WorkspacePreviewPanelProps) {
  const selected = candidates.find((candidate) => candidate.url === selectedUrl) ?? candidates[0] ?? null;
  const [reachability, setReachability] = useState<PreviewReachability>("checking");
  const [hadSuccessfulCheck, setHadSuccessfulCheck] = useState(false);

  useEffect(() => {
    setHadSuccessfulCheck(false);
  }, [selected?.url]);

  useEffect(() => {
    if (!selected) {
      setReachability("checking");
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);

    setReachability("checking");
    void fetch(selected.url, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (disposed) return;
        setReachability("online");
        setHadSuccessfulCheck(true);
      })
      .catch(() => {
        if (!disposed) setReachability("offline");
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshKey, selected]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const menuItems: ChromeMenuItem[] = selected
    ? [
        { id: "refresh", label: "Refresh preview", run: onRefresh },
        { id: "copy-url", label: "Copy URL", run: () => void onCopyUrl(selected.url) },
      ]
    : [];

  return (
    <aside
      className="workspace-preview-panel"
      aria-label="Workspace preview"
      aria-busy={reachability === "checking"}
      onKeyDown={handleKeyDown}
    >
      <header className="workspace-preview-header">
        <div className="workspace-preview-identity">
          <span className={`workspace-preview-status-dot ${reachability}`} aria-hidden="true" />
          <strong>Preview</strong>
          <span className="workspace-preview-location">
            {selected ? previewLocationLabel(selected.url) : workspaceLabel}
          </span>
          <span className="visually-hidden" aria-live="polite">
            {reachabilityLabel(reachability)}
          </span>
        </div>
        <div className="workspace-preview-actions">
          {selected && (
            <>
              <button
                type="button"
                className="workspace-preview-open"
                onClick={() => void onOpenExternal(selected.url)}
                aria-label="Open preview externally"
              >
                <span>Open</span>
                <ExternalLink aria-hidden="true" size={13} />
              </button>
              <ChromeMenu label="More Preview actions" title="Preview actions" items={menuItems}>
                <MoreHorizontal aria-hidden="true" size={15} />
              </ChromeMenu>
            </>
          )}
          <button type="button" className="workspace-preview-close" onClick={onClose} aria-label="Close Preview">
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      {selected ? (
        <>
          {candidates.length > 1 && (
            <label className="workspace-preview-selector">
              <span className="visually-hidden">Detected preview URL</span>
              <select value={selected.url} onChange={(event) => onSelectUrl(event.target.value)}>
                {candidates.map((candidate) => (
                  <option key={candidate.url} value={candidate.url}>
                    {previewLocationLabel(candidate.url)} · {candidate.sessionTitle}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="workspace-preview-frame-shell">
            {reachability !== "offline" && (
              <iframe
                key={`${selected.url}:${refreshKey}`}
                src={selected.url}
                title={`Preview of ${selected.url}`}
                referrerPolicy="no-referrer"
              />
            )}
            {reachability === "offline" && (
              <div className="workspace-preview-fallback visible" role="status">
                <div className="workspace-preview-offline-icon"><WifiOff aria-hidden="true" size={17} /></div>
                <h2>Preview is offline</h2>
                <p>The local app is no longer responding.</p>
                <dl>
                  <div><dt>Source</dt><dd>{selected.sessionTitle}</dd></div>
                  <div><dt>Last successful check</dt><dd>{hadSuccessfulCheck ? "Earlier" : "Not yet"}</dd></div>
                </dl>
                <code>{selected.url}</code>
                <div className="workspace-preview-offline-actions">
                  <button type="button" onClick={() => void onOpenExternal(selected.url)}>
                    Open externally
                  </button>
                  <button type="button" className="primary" onClick={onRefresh}>
                    <RefreshCw aria-hidden="true" size={13} />
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="workspace-preview-empty" role="status">
          <span>Waiting for local app</span>
          <strong>No preview URL yet</strong>
          <p>Start a dev server; Alfred will catch localhost URLs from terminal output.</p>
        </div>
      )}
    </aside>
  );
}

function previewLocationLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function reachabilityLabel(reachability: PreviewReachability): string {
  if (reachability === "online") return "Preview online";
  if (reachability === "offline") return "Preview offline";
  return "Checking Preview";
}
