import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import type { PreviewUrlCandidate } from "../preview-state";
import "./workspace-preview.css";

type PreviewReachability = "checking" | "online" | "offline";

export type WorkspacePreviewPanelProps = {
  candidates: PreviewUrlCandidate[];
  refreshKey: number;
  selectedUrl: string | null;
  onClose: () => void;
  onOpenExternal: (url: string) => Promise<void> | void;
  onRefresh: () => void;
  onSelectUrl: (url: string) => void;
};

/** The Preview tab from the v4 canvas: a quiet address row, then the local app. */
export function WorkspacePreviewPanel({
  candidates,
  refreshKey,
  selectedUrl,
  onClose,
  onOpenExternal,
  onRefresh,
  onSelectUrl,
}: WorkspacePreviewPanelProps) {
  const selected = candidates.find((candidate) => candidate.url === selectedUrl) ?? candidates[0] ?? null;
  const [reachability, setReachability] = useState<PreviewReachability>("checking");

  // The address, not the candidate object: terminal output recomputes the candidates, and each new object asked again.
  const selectedAddress = selected?.url;
  useEffect(() => {
    if (!selectedAddress) {
      setReachability("checking");
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);

    setReachability("checking");
    void fetch(selectedAddress, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (!disposed) setReachability("online");
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
  }, [refreshKey, selectedAddress]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <section
      className="workspace-preview-panel"
      aria-label="Project preview"
      aria-busy={reachability === "checking"}
      onKeyDown={handleKeyDown}
    >
      <header className="workspace-preview-toolbar">
        <button
          type="button"
          className="workspace-preview-icon"
          aria-label="Reload"
          title="Reload"
          disabled={!selected}
          onClick={onRefresh}
        >
          <RotateCw aria-hidden="true" size={14} />
        </button>
        {candidates.length > 1 && selected ? (
          <label className="workspace-preview-address">
            <span className="visually-hidden">Detected preview URL</span>
            <select value={selected.url} onChange={(event) => onSelectUrl(event.target.value)}>
              {candidates.map((candidate) => (
                <option key={candidate.url} value={candidate.url}>
                  {previewLocationLabel(candidate.url)} from {candidate.sessionTitle}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="workspace-preview-address">
            {selected ? (
              <>
                <span className="workspace-preview-url" title={selected.url}>{previewLocationLabel(selected.url)}</span>
                <span className="workspace-preview-source">from {selected.sessionTitle}</span>
              </>
            ) : (
              <span className="workspace-preview-source">No preview URL yet</span>
            )}
          </div>
        )}
        {selected && (
          <button
            type="button"
            className="workspace-preview-icon"
            aria-label="Open in browser"
            title="Open in browser"
            onClick={() => void onOpenExternal(selected.url)}
          >
            <ExternalLink aria-hidden="true" size={14} />
          </button>
        )}
      </header>

      <div className="workspace-preview-frame-shell">
        {selected && reachability !== "offline" && (
          <iframe
            key={`${selected.url}:${refreshKey}`}
            src={selected.url}
            title={`Preview of ${selected.url}`}
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-same-origin allow-scripts"
          />
        )}
        {selected && reachability === "offline" && (
          <div className="workspace-preview-fallback" role="status">
            <h2>Preview is offline</h2>
            <p><span className="workspace-preview-offline-url">{selected.url}</span> stopped responding.</p>
            <button type="button" className="workspace-preview-retry" onClick={onRefresh}>Retry</button>
          </div>
        )}
        {!selected && (
          <div className="workspace-preview-fallback" role="status">
            <h2>No preview URL yet</h2>
            <p>Start a dev server; Alfred will catch localhost URLs from terminal output.</p>
          </div>
        )}
      </div>
    </section>
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
