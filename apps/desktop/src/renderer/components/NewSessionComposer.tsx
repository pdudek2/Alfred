import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { TileKindIcon } from "../tile-kind-icon";
import { ChromeMenu } from "./ChromeMenu";
import "./new-session-composer.css";

export type NewSessionKind = "codex" | "claude" | "terminal" | "plan";
type Project = { id: string; label: string; rootPath?: string; rootStatus?: string; gitBranch?: string };
export type NewSessionComposerProps = {
  /** False shows the one-line rest state under the terminal. */
  expanded: boolean;
  /** Only an explicit open (⌘N, a click) takes focus; an expanded empty deck waits. */
  autoFocus?: boolean;
  shortcutLabel?: string;
  restRef?: RefObject<HTMLButtonElement | null> | undefined;
  onExpand?: () => void;
  projects: Project[];
  projectId: string;
  kind: NewSessionKind;
  draft: string;
  initialWorktree?: boolean;
  /** False when Claude Code has not been told to trust the project's folder yet; unknown counts as trusted. */
  claudeTrusted?: boolean | undefined;
  /** Set when the session starts as a worker of another ("New worker" on its rail row). */
  parentTitle?: string | undefined;
  /** Plan with Alfred needs an OpenRouter key; without one it is not offered. */
  planAvailable?: boolean;
  blockedReason?: string | undefined;
  requestError?: string | undefined;
  disabled?: boolean;
  onProjectChange: (id: string) => void;
  onKindChange: (kind: NewSessionKind) => void;
  onDraftChange: (draft: string) => void;
  onStart: (worktree: boolean) => Promise<boolean> | boolean;
  onClose: () => void;
};
const kinds = [
  ["codex", "Codex"],
  ["claude", "Claude"],
  ["terminal", "Terminal"],
  ["plan", "Plan with Alfred"],
] as const;
const kindMark = { codex: "codex", claude: "claude", terminal: "manual" } as const;

export function NewSessionComposer({ expanded, shortcutLabel = "⌘N", restRef, onExpand, ...props }: NewSessionComposerProps) {
  const projectLabel = props.projects.find((item) => item.id === props.projectId)?.label;
  return (
    // The dock keeps one height, so opening the composer never resizes the terminal's PTY.
    <div className="new-session-dock" data-expanded={expanded}>
      {expanded ? <ComposerForm {...props} restRef={restRef} /> : (
        // Keeping the pointer from taking focus leaves it in the terminal, so Escape can hand it back.
        <button ref={restRef} type="button" className="new-session-rest" aria-expanded="false" aria-label="New session"
          onMouseDown={(event) => event.preventDefault()} onClick={onExpand}>
          <span>New session{projectLabel && <> in <strong>{projectLabel}</strong></>}</span><kbd aria-hidden="true">{shortcutLabel}</kbd>
        </button>
      )}
    </div>
  );
}

function ComposerForm({ autoFocus = true, restRef, projects, projectId, kind, draft, initialWorktree = false, claudeTrusted = true, parentTitle, planAvailable = true, blockedReason, requestError, disabled = false, onProjectChange, onKindChange, onDraftChange, onStart, onClose }: Omit<NewSessionComposerProps, "expanded" | "shortcutLabel" | "onExpand">) {
  const formRef = useRef<HTMLFormElement>(null);
  const [opener] = useState(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  const [worktreeChoice, setWorktree] = useState<boolean>();
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
  // The agent makes the worktree, which needs the project to be a git repository on a branch.
  const worktreeOffered = (kind === "codex" || kind === "claude") && Boolean(project?.rootPath && project.gitBranch);
  // `claude --worktree` exits at once in a folder Claude does not trust yet, where plain `claude` asks.
  const needsClaudeTrust = kind === "claude" && !claudeTrusted;
  const worktree = worktreeChoice ?? (initialWorktree && !needsClaudeTrust);
  const reason = project?.rootStatus === "missing" ? "Reconnect the project folder first." : kind === "plan" ? blockedReason : undefined;
  const invalid = disabled || busy || !project || Boolean(reason) || (kind === "plan" && !draft.trim());
  const kindTitle = kinds.find(([value]) => value === kind)?.[1] ?? "";
  const close = () => {
    onClose();
    queueMicrotask(() => (opener?.isConnected ? opener : restRef?.current)?.focus());
  };
  useLayoutEffect(() => {
    if (!autoFocus) return;
    const form = formRef.current;
    (form?.querySelector<HTMLTextAreaElement>("textarea") ?? form?.querySelector<HTMLInputElement>("input:checked"))?.focus();
  }, [autoFocus]);
  // The palette suspends the composer; closing it hands focus back to where you were typing.
  useLayoutEffect(() => {
    if (!disabled) lastFocus.current?.focus();
  }, [disabled]);
  const submit = async () => {
    if (invalid || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const started = await onStart(worktreeOffered && worktree);
      if (started && mounted.current) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const status = busy ? "Thinking…" : error ?? (kind === "plan" ? requestError : undefined) ?? reason
    ?? (worktreeOffered && needsClaudeTrust ? `Claude asks to trust ${project?.label} first. Start it here once without a worktree.` : undefined)
    ?? (disabled ? "New session paused while another Alfred panel is active." : "");
  return (
    <form ref={formRef} className="new-session-composer" aria-label="New session" aria-busy={busy} inert={disabled}
      onFocusCapture={(event) => { lastFocus.current = event.target; }}
      // Leaving for the terminal means the palette must not pull focus back here when it closes.
      onBlurCapture={(event) => { if (!disabled && !formRef.current?.contains(event.relatedTarget as Node | null)) lastFocus.current = null; }}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      onKeyDown={(event) => {
        if (disabled || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          if (event.defaultPrevented || formRef.current?.querySelector('[role="menu"]')) return;
          event.preventDefault();
          close();
          return;
        }
        if (event.key !== "Enter") return;
        const target = event.target as HTMLElement;
        const command = event.metaKey || event.ctrlKey;
        if (!command && (target.closest(".chrome-menu") || target.closest("button"))) return;
        if (target.tagName === "TEXTAREA" && event.shiftKey && !command) return;
        event.preventDefault();
        void submit();
      }}>
      <header className="new-session-target">
        <span>{parentTitle !== undefined ? <>Worker of <strong>{parentTitle}</strong> in</> : "New session in"}</span>
        <ChromeMenu label="Choose project" title="Projects" selectedItemId={projectId}
          items={projects.map((item) => ({ id: item.id, label: item.label, disabled: busy || disabled || item.rootStatus === "missing", run: () => onProjectChange(item.id) }))}>
          <span>{project?.label ?? "Choose project"}</span><ChevronDown aria-hidden="true" size={12} />
        </ChromeMenu>
      </header>
      {kind === "terminal" ? <p className="new-session-shell">A shell opens in {project?.label ?? "the project"}’s folder.</p> : (
        <div className="new-session-prompt">
          <label className="visually-hidden" htmlFor="new-session-prompt">{kind === "plan" ? "Goal" : "First prompt"}</label>
          <textarea id="new-session-prompt" rows={2} required={kind === "plan"} value={draft} disabled={busy || disabled}
            placeholder={kind === "plan" ? "Describe a goal; Alfred drafts the sessions" : `First prompt for the new ${kindTitle} session`}
            onChange={(event) => onDraftChange(event.target.value)} />
        </div>
      )}
      <div className="new-session-status" role="status">{status}</div>
      <footer>
        <fieldset disabled={busy || disabled} className="new-session-kinds"><legend className="visually-hidden">Kind</legend>
          {kinds.filter(([value]) => value !== "plan" || (parentTitle === undefined && planAvailable)).map(([value, title]) => (
            <label key={value} className={kind === value ? "selected" : undefined}>
              <input type="radio" name="new-session-kind" value={value} checked={kind === value} onChange={() => onKindChange(value)} />
              {value !== "plan" && <span className={`new-session-mark kind-${kindMark[value]}`}><TileKindIcon kind={kindMark[value]} size={14} /></span>}
              {title}
            </label>
          ))}
        </fieldset>
        {worktreeOffered && <label className="new-session-worktree" title={`${project?.label} stays untouched until you merge`}><input type="checkbox" checked={worktree} disabled={busy || disabled} onChange={(event) => setWorktree(event.target.checked)} />New worktree</label>}
        {kind !== "terminal" && <span className="new-session-hint" aria-hidden="true"><kbd>⇧↩</kbd> new line</span>}
        <button type="button" className="new-session-cancel" disabled={disabled} onClick={close}>Cancel <kbd aria-hidden="true">esc</kbd></button>
        <button type="submit" className="new-session-start" disabled={invalid}>Start <kbd aria-hidden="true">↩</kbd></button>
      </footer>
    </form>
  );
}
