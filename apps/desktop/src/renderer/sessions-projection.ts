import {
  SESSIONS_PAGE_SIZE,
  type ExternalSessionSummary,
  type SessionLifecycle,
  type SessionProjectRef,
  type SessionSummary,
  type SessionsProjectInput,
} from "../shared/sessions-ipc";
import { sessionPresentationText, sessionPresentationTitle } from "../shared/session-presentation";
import { isFreeChatScope } from "./session-scope";
import { canRelaunchRestoredSession, type SessionTile } from "./session-state";

export type ManagedSessionTarget = { workspaceId: string; sessionId: string };
export type SessionsPrimaryAction =
  | { kind: "reveal"; label: "Reveal in Work" }
  | { kind: "recover"; label: "Resume in Work" | "Relaunch" | "Review relaunch" | "Confirm relaunch" }
  | { kind: "resume-external"; label: "Resume in Work" }
  | { kind: "add-project"; label: "Add Project…" }
  | { kind: "open-project"; label: "Open Project" };
export type SessionsPrimaryActionRequest = {
  action: SessionsPrimaryAction;
  summary: SessionSummary;
  target: ManagedSessionTarget | null;
};
export type SessionsProjectionPage = {
  items: SessionSummary[];
  managedTargets: Map<string, ManagedSessionTarget>;
  total: number;
  technicalRunCount: number;
  projectCounts: Record<string, number>;
};

export function sessionsPrimaryAction(summary: SessionSummary): SessionsPrimaryAction | null {
  if (summary.source === "managed" && summary.lifecycle === "live") {
    return { kind: "reveal", label: "Reveal in Work" };
  }
  if (summary.source === "managed" && summary.lifecycle === "recoverable") {
    return { kind: "recover", label: summary.kind === "manual" ? "Relaunch" : "Resume in Work" };
  }
  if (summary.source === "external-codex" && summary.lifecycle === "resumable" && summary.project.id) {
    return { kind: "resume-external", label: "Resume in Work" };
  }
  if (summary.source === "external-codex" && !summary.project.id) {
    return { kind: "add-project", label: "Add Project…" };
  }
  if (summary.lifecycle === "read-only" && summary.project.id) {
    return { kind: "open-project", label: "Open Project" };
  }
  return null;
}

export type BuildSessionsProjectionInput = {
  sessions: SessionTile[];
  workspaces: SessionsProjectInput[];
  externalSessions: ExternalSessionSummary[];
  query?: string;
  pageIndex?: number;
  projectId?: string;
};

type ProjectedSession = {
  summary: SessionSummary;
  group: { id: string; label: string };
  target?: ManagedSessionTarget;
  managedActivityAt?: number;
  externalContentSessionKey?: string;
  externalUpdatedAt?: number;
};

export function buildSessionsProjection({
  sessions,
  workspaces,
  externalSessions,
  query = "",
  pageIndex = 0,
  projectId = "all",
}: BuildSessionsProjectionInput): SessionsProjectionPage {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const byLineage = new Map<string, ProjectedSession>();
  const externalGroups = new Map<string, ProjectedSession[]>();
  const externalLineageByContentKey = new Map<string, string>();

  for (const external of externalSessions) {
    const summary = normalizeExternalSession(external);
    const projected: ProjectedSession = {
      summary,
      group: projectGroup(summary.project),
      externalContentSessionKey: external.contentSessionKey,
      externalUpdatedAt: summary.updatedAt,
    };
    const group = externalGroups.get(summary.lineageKey) ?? [];
    group.push(projected);
    externalGroups.set(summary.lineageKey, group);
    externalLineageByContentKey.set(external.contentSessionKey, summary.lineageKey);
  }

  for (const [lineageKey, group] of externalGroups) {
    const parents = group
      .filter((item) => !item.summary.parentContentSessionKey)
      .sort(compareExternalSessions);
    const parent = parents[0];
    if (!parent) continue;
    const delegatedRunCount = Math.max(
      parent.summary.delegatedRunCount ?? 0,
      group.length - parents.length,
    );
    parent.summary = {
      ...parent.summary,
      delegatedRunCount,
      updatedAt: Math.max(...group.map((item) => item.summary.updatedAt)),
    };
    parent.externalUpdatedAt = parent.summary.updatedAt;
    byLineage.set(lineageKey, parent);
  }

  for (const session of sessions) {
    const projected = normalizeManagedSession(session, workspacesById, externalLineageByContentKey);
    const existing = byLineage.get(projected.summary.lineageKey);
    if (existing?.managedActivityAt !== undefined && compareManagedSessions(existing, projected) <= 0) {
      continue;
    }
    if (existing?.externalContentSessionKey) {
      projected.summary = {
        ...projected.summary,
        contentSessionKey: existing.externalContentSessionKey,
        title: existing.summary.title,
        updatedAt: Math.max(projected.summary.updatedAt, existing.externalUpdatedAt ?? 0),
      };
      projected.externalContentSessionKey = existing.externalContentSessionKey;
      if (existing.externalUpdatedAt !== undefined) {
        projected.externalUpdatedAt = existing.externalUpdatedAt;
      }
    }
    const externalGroup = externalGroups.get(projected.summary.lineageKey) ?? [];
    const delegatedRunCount = externalGroup.filter((item) => item.summary.parentContentSessionKey).length;
    projected.summary = { ...projected.summary, delegatedRunCount };
    byLineage.set(projected.summary.lineageKey, projected);
  }

  let technicalRunCount = 0;
  for (const [lineageKey, group] of externalGroups) {
    if (!byLineage.has(lineageKey)) technicalRunCount += group.length;
  }

  const allProjected = [...byLineage.values()];
  const projectCounts: Record<string, number> = {};
  for (const item of allProjected) {
    const countKey = item.group.id === "free-chats"
      ? "free-chats"
      : item.summary.project.id ?? "unassigned";
    projectCounts[countKey] = (projectCounts[countKey] ?? 0) + 1;
  }
  const filtered = allProjected
    .filter((item) => projectId === "all" || (
      projectId === "free-chats"
        ? item.group.id === "free-chats"
        : item.summary.project.id === projectId && item.group.id !== "free-chats"
    ))
    .filter((item) => summaryMatchesQuery(item.summary, item.group.label, query))
    .sort(compareProjectedSessions);
  const normalizedPageIndex = Math.max(0, Math.floor(pageIndex));
  const pageItems = filtered.slice(
    normalizedPageIndex * SESSIONS_PAGE_SIZE,
    (normalizedPageIndex + 1) * SESSIONS_PAGE_SIZE,
  );
  if (pageItems.length > SESSIONS_PAGE_SIZE) throw new Error("Sessions page exceeded its hard limit.");

  const managedTargets = new Map<string, ManagedSessionTarget>();
  for (const item of pageItems) {
    if (item.target) managedTargets.set(item.summary.sessionKey, item.target);
  }

  return {
    items: pageItems.map((item) => item.summary),
    managedTargets,
    total: filtered.length,
    technicalRunCount,
    projectCounts,
  };
}

function normalizeExternalSession(session: ExternalSessionSummary): SessionSummary {
  const snippet = session.snippet ? sessionPresentationText(session.snippet) : "";
  const { snippet: _sourceSnippet, ...rest } = session;
  return {
    ...rest,
    title: sessionPresentationTitle(session.title, "Codex session"),
    ...(snippet ? { snippet } : {}),
    lineageKey: codexLineageKey(session.lineageKey) ?? session.lineageKey,
    delegatedRunCount: session.delegatedRunCount ?? 0,
    lifecycle: session.project.id ? session.lifecycle : "read-only",
  };
}

function normalizeManagedSession(
  session: SessionTile,
  workspacesById: ReadonlyMap<string, SessionsProjectInput>,
  externalLineageByContentKey: ReadonlyMap<string, string>,
): ProjectedSession {
  const workspace = workspacesById.get(session.workspaceId);
  const project: SessionProjectRef = {
    id: workspace?.id ?? session.workspaceId,
    label: workspace?.label ?? session.workspaceId,
  };
  const freeChat = isFreeChatScope(session);
  const kind = managedKind(session);
  const summary: SessionSummary = {
    sessionKey: `managed:${session.id}`,
    lineageKey: managedLineageKey(session, externalLineageByContentKey),
    contentSessionKey: null,
    parentContentSessionKey: null,
    delegatedRunCount: 0,
    source: "managed",
    kind,
    title: sessionPresentationTitle(
      session.title,
      `${kind === "codex" ? "Codex" : kind === "claude" ? "Claude" : "Manual"} session`,
    ),
    project,
    locationLabel: displayLocation(session),
    ...(session.branchName?.trim() ? { branch: session.branchName } : {}),
    updatedAt: meaningfulActivityAt(session),
    lifecycle: managedLifecycle(session),
  };

  return {
    summary,
    group: freeChat ? { id: "free-chats", label: "Free Chats" } : projectGroup(project),
    target: { workspaceId: session.workspaceId, sessionId: session.id },
    managedActivityAt: summary.updatedAt,
  };
}

function managedLineageKey(
  session: SessionTile,
  externalLineageByContentKey: ReadonlyMap<string, string>,
): string {
  if (session.resumeTarget?.agentKind !== "codex") return `managed:${session.id}`;
  const contentKey = `external-codex:${session.resumeTarget.sessionId}`;
  return externalLineageByContentKey.get(contentKey) ?? `codex:${session.resumeTarget.sessionId}`;
}

function codexLineageKey(contentSessionKey: string | null): string | null {
  const prefix = "external-codex:";
  if (!contentSessionKey?.startsWith(prefix)) return null;
  const id = contentSessionKey.slice(prefix.length);
  return id ? `codex:${id}` : null;
}

function managedKind(session: SessionTile): SessionSummary["kind"] {
  if (session.agentKind === "codex" || session.command === "codex") return "codex";
  if (session.agentKind === "claude" || session.command === "claude") return "claude";
  return "manual";
}

function managedLifecycle(session: SessionTile): SessionLifecycle {
  if (session.runtimeStatus === "live" || session.runtimeStatus === "starting") return "live";
  if (session.runtimeStatus === "restored" && canRelaunchRestoredSession(session)) {
    return "recoverable";
  }
  if (
    (session.runtimeStatus === "error" || session.runtimeStatus === "exited")
    && session.command?.trim()
  ) return "recoverable";
  return "read-only";
}

function displayLocation(session: SessionTile): string {
  if (session.branchName?.trim()) return session.branchName;
  const segments = session.cwd.split("/").filter(Boolean);
  return segments.at(-1) ?? "local desk";
}

function meaningfulActivityAt(session: SessionTile): number {
  return session.lastActivityAt ?? session.lastOutputAt ?? session.createdAt ?? 0;
}

function projectGroup(project: SessionProjectRef): { id: string; label: string } {
  return { id: `project:${project.id ?? "unassigned"}`, label: project.label };
}

function summaryMatchesQuery(summary: SessionSummary, groupLabel: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const searchableMetadata = [
    summary.title,
    groupLabel,
    summary.source,
    summary.kind,
    summary.branch,
    summary.model,
    summary.locationLabel,
    summary.snippet,
  ].filter((field): field is string => Boolean(field)).join("\n").toLowerCase();
  return tokens.every((token) => searchableMetadata.includes(token));
}

function compareManagedSessions(a: ProjectedSession, b: ProjectedSession): number {
  return (b.managedActivityAt ?? 0) - (a.managedActivityAt ?? 0)
    || a.summary.sessionKey.localeCompare(b.summary.sessionKey);
}

function compareExternalSessions(a: ProjectedSession, b: ProjectedSession): number {
  return (b.externalUpdatedAt ?? 0) - (a.externalUpdatedAt ?? 0)
    || a.summary.sessionKey.localeCompare(b.summary.sessionKey);
}

function compareProjectedSessions(a: ProjectedSession, b: ProjectedSession): number {
  return b.summary.updatedAt - a.summary.updatedAt
    || a.summary.sessionKey.localeCompare(b.summary.sessionKey);
}
