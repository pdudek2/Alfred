import { useCallback } from "react";

type ComposerBarProps = {
  blockedActionLabel?: string | undefined;
  blockedReason: string | undefined;
  disabled?: boolean;
  value: string;
  thinking: boolean;
  workspaceName: string;
  onChange: (value: string) => void;
  onBlockedAction?: (() => void) | undefined;
  onSubmit: () => void;
};

export function ComposerBar({
  blockedActionLabel,
  blockedReason,
  disabled = false,
  value,
  thinking,
  workspaceName,
  onBlockedAction,
  onChange,
  onSubmit,
}: ComposerBarProps) {
  const blocked = blockedReason !== undefined;
  const composerDisabled = disabled || thinking;
  const canSubmit = !composerDisabled && !blocked && value.trim().length > 0;
  const state = thinking ? "busy" : blocked ? "blocked" : disabled ? "disabled" : "ready";
  const status = thinking
    ? "Alfred is preparing a launch plan."
    : blocked
      ? blockedReason
      : disabled
        ? "Composer paused."
      : `Ready in ${workspaceName}.`;

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
    <div className="composer-bar" role="form" aria-label="Alfred composer" data-state={state}>
      <div className="alfred-mark" aria-hidden="true">A</div>
      <textarea
        className="composer-input"
        rows={1}
        value={value}
        placeholder={`Ask Alfred to prepare ${workspaceName}…`}
        disabled={composerDisabled}
        aria-label="Alfred prompt"
        aria-describedby="composer-status"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="composer-send"
        disabled={!canSubmit}
        onClick={onSubmit}
        aria-label="Send prompt to Alfred"
      >
        {thinking ? "Thinking…" : "Send"}
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
