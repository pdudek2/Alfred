import { useCallback, useState } from "react";

type ComposerBarProps = {
  blockedActionLabel?: string | undefined;
  blockedReason: string | undefined;
  disabled?: boolean;
  dispatchTarget: { id: string; kind: "session" | "workspace"; label: string } | null;
  lastDispatchDestination?: string | null | undefined;
  thinking: boolean;
  onBlockedAction?: (() => void) | undefined;
  onCycleDispatchTarget?: (() => void) | undefined;
  onSubmit: (value: string) => boolean | Promise<boolean>;
};

export function ComposerBar({
  blockedActionLabel,
  blockedReason,
  disabled = false,
  dispatchTarget,
  lastDispatchDestination,
  thinking,
  onBlockedAction,
  onCycleDispatchTarget,
  onSubmit,
}: ComposerBarProps) {
  const [draft, setDraft] = useState<string>("");
  const blocked = blockedReason !== undefined;
  const composerDisabled = disabled || thinking || !dispatchTarget;
  const canSubmit = !composerDisabled && !blocked && draft.trim().length > 0;
  const state = thinking ? "busy" : composerDisabled ? "disabled" : blocked ? "blocked" : "ready";
  const targetLabel = dispatchTarget?.label ?? "Select a target";
  const targetKindLabel = dispatchTarget?.kind === "session" ? "session" : "workspace";
  const targetPreposition = dispatchTarget?.kind === "session" ? "with" : "in";
  const status = thinking
    ? `Preparing work ${targetPreposition} ${targetLabel}.`
    : disabled
      ? "Dispatch paused while another Alfred panel is active."
      : !dispatchTarget
        ? "Select a planning scope before sending."
        : blocked
          ? blockedReason
          : lastDispatchDestination
            ? `Prepared work for ${lastDispatchDestination}.`
            : `Ready to prepare work ${targetPreposition} ${targetLabel}.`;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const submitted = await onSubmit(draft);
    if (submitted) setDraft("");
  }, [canSubmit, draft, onSubmit]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSubmit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft("");
      }
    },
    [handleSubmit],
  );

  return (
    <div
      className="composer-bar dispatch-bar"
      role="form"
      aria-label="Alfred dispatch"
      data-state={state}
      data-testid="dispatch-bar"
    >
      <div className="dispatch-capsule">
        <button
          type="button"
          className="dispatch-target-chip"
          aria-label="Change planning scope"
          disabled={disabled || thinking}
          onClick={onCycleDispatchTarget}
        >
          <span>{dispatchTarget ? targetKindLabel : "Scope"}</span>
          <strong>{dispatchTarget?.label ?? "Choose target"}</strong>
        </button>
        <textarea
          className="composer-input"
          rows={1}
          value={draft}
          placeholder={dispatchTarget ? `Prepare work ${targetPreposition} ${dispatchTarget.label}...` : "Choose a planning scope first..."}
          disabled={composerDisabled}
          aria-label="Dispatch instruction"
          aria-describedby="composer-status"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span className="dispatch-kbd-hint" aria-hidden="true">
          <kbd>⌘</kbd>
          <kbd>↵</kbd>
        </span>
        <button
          type="button"
          className="composer-send"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          aria-label={`Prepare work ${targetPreposition} ${targetLabel}`}
        >
          {thinking ? "Preparing..." : "Prepare"}
        </button>
      </div>
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
