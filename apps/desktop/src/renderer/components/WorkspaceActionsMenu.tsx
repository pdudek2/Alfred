import { ChevronDown, FolderOpen, ListChecks, Pencil, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceMissionBrief } from "../../shared/workspace-ipc";
import { shortenPath } from "../path-display";

export type WorkspaceActionsMenuProps = {
  canCloseWorkspace: boolean;
  detail: string;
  menuOpen: boolean;
  missionBrief: WorkspaceMissionBrief | undefined;
  renameDraft: string;
  renameEditing: boolean;
  rootPath?: string;
  workspaceLabel: string;
  onCancelRename: () => void;
  onCloseWorkspace: () => void;
  onChangeRenameDraft: (value: string) => void;
  onClose: () => void;
  onOpenExternalTerminal: () => void;
  onRevealFolder: () => void;
  onSaveMissionBrief: (missionBrief: WorkspaceMissionBrief | undefined) => void;
  onSaveRename: (value: string) => void;
  onStartRename: () => void;
  onToggleMenu: () => void;
};

export function WorkspaceActionsMenu({
  canCloseWorkspace,
  detail,
  menuOpen,
  missionBrief,
  renameDraft,
  renameEditing,
  rootPath,
  workspaceLabel,
  onCancelRename,
  onCloseWorkspace,
  onChangeRenameDraft,
  onClose,
  onOpenExternalTerminal,
  onRevealFolder,
  onSaveMissionBrief,
  onSaveRename,
  onStartRename,
  onToggleMenu,
}: WorkspaceActionsMenuProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const missionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [missionEditing, setMissionEditing] = useState(false);
  const [missionDraft, setMissionDraft] = useState<WorkspaceMissionDraft>(() => missionBriefToDraft(missionBrief));
  const revealLabel = navigator.platform.includes("Mac") ? "Reveal in Finder" : "Reveal folder";
  const terminalLabel = navigator.platform.includes("Mac") ? "Open in Ghostty" : "Open in external terminal";
  const popoverLabel = renameEditing
    ? "Rename workspace"
    : missionEditing
      ? "Workspace mission brief"
      : "Workspace actions";
  const missionActionLabel = missionBrief ? "Edit mission brief..." : "Add mission brief...";
  const missionSummary = missionBrief?.goal || missionBrief?.doneWhen[0] || "Give Alfred persistent context";
  const handleMissionCancel = () => {
    setMissionDraft(missionBriefToDraft(missionBrief));
    setMissionEditing(false);
  };

  useEffect(() => {
    if (!renameEditing) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [renameEditing]);

  useEffect(() => {
    if (!missionEditing) return;
    window.requestAnimationFrame(() => {
      missionInputRef.current?.focus();
      missionInputRef.current?.select();
    });
  }, [missionEditing]);

  useEffect(() => {
    if (menuOpen) return;
    setMissionEditing(false);
  }, [menuOpen]);

  useEffect(() => {
    if (missionEditing) return;
    setMissionDraft(missionBriefToDraft(missionBrief));
  }, [missionBrief, missionEditing]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node
        && (surfaceRef.current?.contains(target) || popoverRef.current?.contains(target))
      ) return;
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen, onClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (renameEditing) onCancelRename();
      else if (missionEditing) {
        setMissionDraft(missionBriefToDraft(missionBrief));
        setMissionEditing(false);
      } else onClose();
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen, missionBrief, missionEditing, onCancelRename, onClose, renameEditing]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const positionPopover = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const triggerRect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const preferredLeft = triggerRect.left - 2;
      const preferredTop = triggerRect.bottom + 8;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - popover.offsetWidth - viewportPadding);
      const maxTop = Math.max(viewportPadding, window.innerHeight - popover.offsetHeight - viewportPadding);
      popover.style.left = `${Math.max(viewportPadding, Math.min(preferredLeft, maxLeft))}px`;
      popover.style.top = `${Math.max(viewportPadding, Math.min(preferredTop, maxTop))}px`;
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [menuOpen]);

  return (
    <div
      className="workspace-title-menu"
      ref={surfaceRef}
    >
      <button
        type="button"
        className="workspace-title-trigger"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-label={`Workspace menu for ${workspaceLabel}`}
        onClick={onToggleMenu}
      >
        <span>
          <strong>{workspaceLabel}</strong>
          <small>{detail}</small>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {menuOpen && createPortal(
        <div className="workspace-popover" ref={popoverRef} role="dialog" aria-label={popoverLabel}>
          {renameEditing ? (
            <form
              className="workspace-rename-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                onSaveRename(renameDraft);
              }}
            >
              <label>
                <span>Workspace name</span>
                <input
                  ref={inputRef}
                  value={renameDraft}
                  onChange={(event) => onChangeRenameDraft(event.target.value)}
                />
              </label>
              <div>
                <button type="submit" disabled={!renameDraft.trim()}>Save</button>
                <button type="button" onClick={onCancelRename}>Cancel</button>
              </div>
            </form>
          ) : missionEditing ? (
            <form
              className="workspace-mission-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                onSaveMissionBrief(missionBriefFromDraft(missionDraft));
                setMissionEditing(false);
              }}
            >
              <label>
                <span>Mission goal</span>
                <textarea
                  aria-label="Mission goal"
                  ref={missionInputRef}
                  rows={3}
                  value={missionDraft.goal}
                  onChange={(event) => setMissionDraft((draft) => ({ ...draft, goal: event.target.value }))}
                />
              </label>
              <label>
                <span>Done when</span>
                <textarea
                  aria-label="Done when"
                  rows={3}
                  value={missionDraft.doneWhen}
                  placeholder="One condition per line"
                  onChange={(event) => setMissionDraft((draft) => ({ ...draft, doneWhen: event.target.value }))}
                />
              </label>
              <label>
                <span>Guardrails</span>
                <textarea
                  aria-label="Guardrails"
                  rows={3}
                  value={missionDraft.guardrails}
                  placeholder="Constraints Alfred should respect"
                  onChange={(event) => setMissionDraft((draft) => ({ ...draft, guardrails: event.target.value }))}
                />
              </label>
              <div className="workspace-mission-actions">
                <button type="submit" disabled={!hasMissionDraft(missionDraft)}>Save</button>
                <button type="button" onClick={handleMissionCancel}>Cancel</button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    onSaveMissionBrief(undefined);
                    setMissionDraft(missionBriefToDraft(undefined));
                    setMissionEditing(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" disabled={!rootPath} onClick={() => { onOpenExternalTerminal(); onClose(); }}>
                <SquareTerminal size={14} />
                <span><strong>{terminalLabel}</strong><small>{rootPath ? shortenPath(rootPath) : "No folder bound"}</small></span>
              </button>
              <button type="button" disabled={!rootPath} onClick={() => { onRevealFolder(); onClose(); }}>
                <FolderOpen size={14} />
                <span><strong>{revealLabel}</strong><small>{rootPath ? shortenPath(rootPath) : "No folder bound"}</small></span>
              </button>
              <hr />
              <button type="button" onClick={onStartRename}>
                <Pencil size={14} />
                <span><strong>Rename workspace...</strong><small>Keep this desk readable</small></span>
              </button>
              <button type="button" onClick={() => { setMissionDraft(missionBriefToDraft(missionBrief)); setMissionEditing(true); }}>
                <ListChecks size={14} />
                <span><strong>{missionActionLabel}</strong><small>{truncateText(missionSummary, 38)}</small></span>
              </button>
              {canCloseWorkspace && (
                <>
                  <hr />
                  <button
                    type="button"
                    className="danger"
                    aria-label="Close workspace"
                    onClick={() => { onCloseWorkspace(); onClose(); }}
                  >
                    <Trash2 size={14} />
                    <span><strong>Close workspace</strong><small>Remove this empty workspace</small></span>
                  </button>
                </>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

type WorkspaceMissionDraft = { goal: string; doneWhen: string; guardrails: string };

function missionBriefToDraft(brief: WorkspaceMissionBrief | undefined): WorkspaceMissionDraft {
  return {
    goal: brief?.goal ?? "",
    doneWhen: brief?.doneWhen.join("\n") ?? "",
    guardrails: brief?.guardrails.join("\n") ?? "",
  };
}

function missionBriefFromDraft(draft: WorkspaceMissionDraft): WorkspaceMissionBrief | undefined {
  const goal = normalizeMissionDraftLine(draft.goal, 320);
  const doneWhen = normalizeMissionDraftList(draft.doneWhen);
  const guardrails = normalizeMissionDraftList(draft.guardrails);
  if (!goal) return undefined;
  return { goal, doneWhen, guardrails };
}

function hasMissionDraft(draft: WorkspaceMissionDraft): boolean {
  return missionBriefFromDraft(draft) !== undefined;
}

function normalizeMissionDraftList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const normalized = normalizeMissionDraftLine(line, 240);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
    if (items.length >= 8) break;
  }
  return items;
}

function normalizeMissionDraftLine(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
