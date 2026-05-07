import { useCallback } from "react";

type ComposerBarProps = {
  blockedReason: string | undefined;
  value: string;
  thinking: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function ComposerBar({ blockedReason, value, thinking, onChange, onSubmit }: ComposerBarProps) {
  const blocked = blockedReason !== undefined;
  const canSubmit = !thinking && !blocked && value.trim().length > 0;

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
    <div className="composer-bar" role="form" aria-label="Alfred composer">
      <div className="alfred-mark" aria-hidden="true">A</div>
      <textarea
        className="composer-input"
        rows={1}
        value={value}
        placeholder={blockedReason ?? "Ask Alfred to prepare a workspace…"}
        disabled={thinking}
        aria-label="Alfred prompt"
        aria-describedby={blocked ? "composer-status" : undefined}
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
      {(thinking || blocked) && (
        <span className="composer-status" id="composer-status" role="status">
          {thinking ? "Alfred is thinking…" : blockedReason}
        </span>
      )}
    </div>
  );
}
