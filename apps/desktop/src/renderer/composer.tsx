import { useCallback } from "react";

type ComposerBarProps = {
  value: string;
  thinking: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function ComposerBar({ value, thinking, onChange, onSubmit }: ComposerBarProps) {
  const canSubmit = !thinking && value.trim().length > 0;

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
        placeholder="Ask Alfred to prepare a workspace…"
        disabled={thinking}
        aria-label="Alfred prompt"
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
      {thinking && <span className="composer-thinking" role="status">Alfred is thinking…</span>}
    </div>
  );
}
