import { useCallback } from "react";

type ComposerBarProps = {
  blockedActionLabel?: string | undefined;
  blockedReason: string | undefined;
  disabled?: boolean;
  dispatchTarget: { id: string; kind: "session" | "workspace"; label: string } | null;
  lastDispatchDestination?: string | null | undefined;
  value: string;
  thinking: boolean;
  workspaceName: string;
  onChange: (value: string) => void;
  onBlockedAction?: (() => void) | undefined;
  onCycleDispatchTarget?: (() => void) | undefined;
  onSubmit: () => void;
};

export function ComposerBar({
  blockedActionLabel,
  blockedReason,
  disabled = false,
  dispatchTarget,
  lastDispatchDestination,
  value,
  thinking,
  workspaceName,
  onBlockedAction,
  onCycleDispatchTarget,
  onChange,
  onSubmit,
}: ComposerBarProps) {
  const blocked = blockedReason !== undefined;
  const composerDisabled = disabled || thinking || !dispatchTarget;
  const canSubmit = !composerDisabled && !blocked && value.trim().length > 0;
  const state = thinking ? "busy" : composerDisabled ? "disabled" : blocked ? "blocked" : "ready";
  const targetLabel = dispatchTarget?.label ?? "Select a target";
  const status = thinking
    ? `Dispatching to ${targetLabel}.`
    : disabled
      ? "Dispatch paused while another Alfred panel is active."
      : !dispatchTarget
        ? "Select a dispatch target before sending."
        : blocked
          ? blockedReason
          : lastDispatchDestination
            ? `Dispatched to ${lastDispatchDestination}.`
            : `Ready to dispatch to ${targetLabel}.`;

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (canSubmit) onSubmit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onChange("");
      }
    },
    [canSubmit, onChange, onSubmit],
  );

  return (
    <div
      className="composer-bar dispatch-bar"
      role="form"
      aria-label="Alfred dispatch"
      data-state={state}
      data-testid="dispatch-bar"
    >
      <div className="alfred-mark" aria-hidden="true">A</div>
      <button
        type="button"
        className="dispatch-target-chip"
        disabled={disabled || thinking}
        onClick={onCycleDispatchTarget}
        aria-label={`Dispatch target: ${targetLabel}`}
      >
        <span>{dispatchTarget?.kind === "workspace" ? "Workspace" : "Session"}</span>
        <strong>{targetLabel}</strong>
      </button>
      <textarea
        className="composer-input"
        rows={1}
        value={value}
        placeholder={dispatchTarget ? `Dispatch instruction to ${targetLabel}…` : `Select a target in ${workspaceName}…`}
        disabled={composerDisabled}
        aria-label="Dispatch instruction"
        aria-describedby="composer-status"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="composer-send"
        disabled={!canSubmit}
        onClick={onSubmit}
        aria-label={`Dispatch to ${targetLabel}`}
      >
        {thinking ? "Dispatching…" : "Send"}
      </button>
      <div className="composer-status-row">
        <span className="composer-status-indicator" aria-hidden="true" />
        <span className="composer-status" id="composer-status" role="status" aria-live="polite">
          {status}
        </span>
        {blocked && blockedActionLabel && onBlockedAction && (
          <button type="button" className="composer-blocked-action" onClick={onBlockedAction}>
            {blockedActionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
