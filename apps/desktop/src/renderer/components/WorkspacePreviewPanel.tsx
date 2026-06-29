import { useEffect, useState } from "react";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import type { PreviewUrlCandidate } from "../preview-state";

type PreviewReachability = "checking" | "online" | "offline";

export type WorkspacePreviewPanelProps = {
  candidates: PreviewUrlCandidate[];
  refreshKey: number;
  selectedUrl: string | null;
  workspaceLabel: string;
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
  onCopyUrl,
  onOpenExternal,
  onRefresh,
  onSelectUrl,
}: WorkspacePreviewPanelProps) {
  const selected = candidates.find((candidate) => candidate.url === selectedUrl) ?? candidates[0] ?? null;
  const [reachability, setReachability] = useState<PreviewReachability>("checking");

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
  }, [refreshKey, selected]);

  return (
    <aside className="workspace-preview-panel" aria-label="Workspace preview">
      <header className="workspace-preview-header">
        <div>
          <span>Preview</span>
          <strong>{selected ? previewHostLabel(selected.url) : workspaceLabel}</strong>
        </div>
        {selected && (
          <div className="workspace-preview-actions">
            <button type="button" onClick={onRefresh} aria-label="Refresh preview">
              <RefreshCw size={13} />
            </button>
            <button type="button" onClick={() => void onOpenExternal(selected.url)} aria-label="Open preview externally">
              <ExternalLink size={13} />
            </button>
            <button type="button" onClick={() => void onCopyUrl(selected.url)} aria-label="Copy preview URL">
              <Copy size={13} />
            </button>
          </div>
        )}
      </header>

      {selected ? (
        <>
          <div className="workspace-preview-selector" aria-label="Detected preview URLs">
            {candidates.map((candidate) => (
              <button
                type="button"
                key={candidate.url}
                className={candidate.url === selected.url ? "active" : ""}
                aria-pressed={candidate.url === selected.url}
                onClick={() => onSelectUrl(candidate.url)}
                title={candidate.url}
              >
                <span>{previewHostLabel(candidate.url)}</span>
                <small>{candidate.sessionTitle}</small>
              </button>
            ))}
          </div>
          <div className="workspace-preview-frame-shell">
            <iframe
              key={`${selected.url}:${refreshKey}`}
              src={selected.url}
              title={`Preview of ${selected.url}`}
              referrerPolicy="no-referrer"
            />
            {reachability === "offline" && (
              <div className="workspace-preview-fallback visible" role="status">
                <span>Preview offline</span>
                <strong>{selected.url}</strong>
                <p>Start or restart the local dev server for this workspace.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="workspace-preview-empty" role="status">
          <span>waiting for local app</span>
          <strong>No preview URL yet</strong>
          <p>Start a dev server; Alfred will catch localhost URLs from terminal output.</p>
        </div>
      )}
    </aside>
  );
}

function previewHostLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return url;
  }
}
