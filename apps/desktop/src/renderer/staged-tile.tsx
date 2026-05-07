import { X } from "lucide-react";
import type { SessionTile } from "./session-state";

type StagedTilePreviewProps = {
  armed: boolean;
  tile: SessionTile;
  onApprove: (tileId: string) => void;
  onReject: (tileId: string) => void;
};

export function StagedTilePreview({ armed, tile, onApprove, onReject }: StagedTilePreviewProps) {
  const command = tile.command ?? "";
  const args = tile.args ?? [];
  const fullCommand = [command, ...args].join(" ").trim();
  const agentClass = tile.agentKind ?? "shell";
  const unsafe = Boolean(tile.safetyNote);
  const approveLabel = unsafe ? (armed ? "Confirm" : "Review") : "Approve";
  const approveAriaLabel = unsafe
    ? armed
      ? `Confirm unsafe command: ${tile.title}`
      : `Review unsafe command: ${tile.title}`
    : `Approve ${tile.title}`;

  return (
    <article className="terminal-tile staged" aria-label={`Staged ${tile.title}`}>
      <header className="tile-header">
        <div className="tile-title">
          <span className={`tool-dot ${agentClass}`} />
          <div>
            <b>{tile.title}</b>
            <small>{tile.cwd ? shortenPath(tile.cwd) : "default cwd"}</small>
          </div>
        </div>
        <div className="tile-actions">
          <span className="tile-status">staged</span>
        </div>
      </header>
      <div className="staged-body">
        {unsafe && (
          <div className={`staged-safety-chip ${armed ? "armed" : ""}`} role="note">
            {armed ? "Confirm to launch: " : "Review before launch: "}
            {tile.safetyNote}
          </div>
        )}
        <div className="staged-label">command</div>
        <div className="staged-command">{fullCommand || "(no command)"}</div>
        {tile.cwd && <div className="staged-cwd">cwd: {tile.cwd}</div>}
      </div>
      <div className="staged-actions">
        <button
          type="button"
          className={`approve-button ${unsafe ? "unsafe" : ""} ${armed ? "armed" : ""}`}
          onClick={() => onApprove(tile.id)}
          aria-label={approveAriaLabel}
        >
          {approveLabel}
        </button>
        <button
          type="button"
          className="reject-button"
          onClick={() => onReject(tile.id)}
          aria-label={`Reject ${tile.title}`}
          title="Reject"
        >
          <X size={14} />
        </button>
      </div>
    </article>
  );
}

function shortenPath(value: string): string {
  const parts = value.split("/");
  if (parts.length <= 3) return value;
  return `…/${parts.slice(-2).join("/")}`;
}
