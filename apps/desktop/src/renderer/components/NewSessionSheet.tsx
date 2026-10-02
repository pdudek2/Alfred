import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { ChromeMenu } from "./ChromeMenu";
import "./new-session-sheet.css";

export type NewSessionKind = "codex" | "claude" | "terminal" | "plan";
type Project = { id: string; label: string; rootPath?: string; rootStatus?: string };
export type NewSessionSheetProps = {
  projects: Project[];
  projectId: string;
  kind: NewSessionKind;
  draft: string;
  initialIsolation?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  blockedReason?: string | undefined;
  requestError?: string | undefined;
  disabled?: boolean;
  onProjectChange: (id: string) => void;
  onKindChange: (kind: NewSessionKind) => void;
  onDraftChange: (draft: string) => void;
  onStart: (isolated: boolean) => Promise<boolean> | boolean;
  onClose: () => void;
};
const kinds = [
  ["codex", "Codex", "An agent in its own terminal"],
  ["claude", "Claude", "An agent in its own terminal"],
  ["terminal", "Terminal", "A shell in the project folder"],
  ["plan", "Plan with Alfred", "Describe a goal and get drafts to launch"],
] as const;

export function NewSessionSheet({ projects, projectId, kind, draft, initialIsolation = false, triggerRef, blockedReason, requestError, disabled = false, onProjectChange, onKindChange, onDraftChange, onStart, onClose }: NewSessionSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [isolated, setIsolated] = useState(initialIsolation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const lastFocus = useRef<HTMLElement | null>(null);
  const project = projects.find((item) => item.id === projectId);
  const agent = kind === "codex" || kind === "claude";
  const reason = project?.rootStatus === "missing" ? "Reconnect the project folder first." : kind === "plan" ? blockedReason : undefined;
  const invalid = disabled || busy || !project || Boolean(reason) || (kind === "plan" && !draft.trim());
  const close = () => {
    onClose();
    queueMicrotask(() => (opener?.isConnected ? opener : triggerRef?.current)?.focus());
  };
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    (dialog?.querySelector<HTMLTextAreaElement>("textarea") ?? dialog?.querySelector<HTMLInputElement>("input:checked"))?.focus();
  }, []);
  useLayoutEffect(() => {
    if (!disabled) lastFocus.current?.focus();
  }, [disabled]);
  useEffect(() => {
    if (disabled) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !dialogRef.current?.querySelector('[role="menu"]')) {
        event.preventDefault();
        onClose();
        queueMicrotask(() => (opener?.isConnected ? opener : triggerRef?.current)?.focus());
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [disabled, onClose, opener, triggerRef]);
  const submit = async () => {
    if (invalid || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const started = await onStart(agent && Boolean(project?.rootPath) && isolated);
      if (started && mounted.current) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="new-session-backdrop" data-suspended={disabled} data-testid="new-session-backdrop" onPointerDown={(event) => {
      if (!disabled && event.target === event.currentTarget) close();
    }}>
      <div ref={dialogRef} className="new-session-sheet" inert={disabled} role="dialog" aria-modal="true" aria-label="New session" aria-busy={busy}
        onFocusCapture={(event) => { lastFocus.current = event.target; }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Tab") {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(':is(button, textarea, input):not(:disabled)') ?? [])
              .filter((element) => !(element instanceof HTMLInputElement && element.type === "radio" && !element.checked));
            const first = focusable[0]; const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          const target = event.target as HTMLElement;
          if (!event.metaKey && !event.ctrlKey && (target.closest(".chrome-menu") || target.closest("button"))) return;
          if (target.tagName === "TEXTAREA" && !event.metaKey && !event.ctrlKey) return;
          event.preventDefault();
          void submit();
        }}>
        <form aria-label="New session" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <header><span>New session in</span><ChromeMenu label="Choose project" title="Projects" selectedItemId={projectId}
            items={projects.map((item) => ({ id: item.id, label: item.label, disabled: busy || disabled || item.rootStatus === "missing", run: () => onProjectChange(item.id) }))}>
            <span>{project?.label ?? "Choose project"}</span><ChevronDown aria-hidden="true" size={13} />
          </ChromeMenu></header>
          <fieldset disabled={busy || disabled} className="new-session-kinds"><legend className="visually-hidden">Kind</legend>
            {kinds.map(([value, title, description]) => <label key={value} className={kind === value ? "selected" : undefined}>
              <input type="radio" name="new-session-kind" value={value} checked={kind === value} onChange={() => onKindChange(value)} />
              <span><strong>{title}</strong><small>{description}</small></span>
            </label>)}
          </fieldset>
          {kind !== "terminal" && <div className="new-session-prompt"><label htmlFor="new-session-prompt">{kind === "plan" ? "Goal" : "First prompt"}</label>
            <textarea id="new-session-prompt" rows={3} required={kind === "plan"} value={draft} disabled={busy || disabled} onChange={(event) => onDraftChange(event.target.value)} />
          </div>}
          {agent && project?.rootPath && <label className="new-session-isolation"><input type="checkbox" checked={isolated} disabled={busy || disabled} onChange={(event) => setIsolated(event.target.checked)} /><span>Work in an isolated worktree<small>Changes reach Alfred only when you apply them</small></span></label>}
          <div className="new-session-status" role="status">{busy ? "Thinking…" : error ?? (kind === "plan" ? requestError : undefined) ?? reason ?? (disabled ? "New session paused while another Alfred panel is active." : "")}</div>
          <footer><button type="button" disabled={disabled} onClick={close}>Cancel <kbd aria-hidden="true">esc</kbd></button><button type="submit" className="new-session-start" disabled={invalid}>Start <kbd aria-hidden="true">↩</kbd></button></footer>
        </form>
      </div>
    </div>
  );
}
