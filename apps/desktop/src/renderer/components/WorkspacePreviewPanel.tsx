import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import type { PreviewUrlCandidate } from "../preview-state";

type WorkspacePreviewPanelProps = {
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
            <div className="workspace-preview-fallback" aria-hidden="true">
              <span>Preview unavailable?</span>
              <strong>{selected.url}</strong>
            </div>
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
