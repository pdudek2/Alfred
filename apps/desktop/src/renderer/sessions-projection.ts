import {
  SESSIONS_PAGE_SIZE,
  type ExternalSessionSummary,
  type SessionLifecycle,
  type SessionProjectRef,
  type SessionSummary,
  type SessionsProjectInput,
} from "../shared/sessions-ipc";
import { isFreeChatSession } from "./session-scope";
import type { SessionTile } from "./session-state";

export type ManagedSessionTarget = { workspaceId: string; sessionId: string };
export type SessionsProjectionPage = {
  groups: Array<{ id: string; label: string; items: SessionSummary[] }>;
  items: SessionSummary[];
  managedTargets: Map<string, ManagedSessionTarget>;
  total: number;
};

export type BuildSessionsProjectionInput = {
  sessions: SessionTile[];
  workspaces: SessionsProjectInput[];
  externalSessions: ExternalSessionSummary[];
  query?: string;
  pageIndex?: number;
};

type ProjectedSession = {
  summary: SessionSummary;
  group: { id: string; label: string };
  target?: ManagedSessionTarget;
};

export function buildSessionsProjection({
  sessions,
  workspaces,
  externalSessions,
  query = "",
  pageIndex = 0,
}: BuildSessionsProjectionInput): SessionsProjectionPage {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const byLineage = new Map<string, ProjectedSession>();

  for (const external of externalSessions) {
    const summary = normalizeExternalSession(external);
    const projected: ProjectedSession = {
      summary,
      group: projectGroup(summary.project),
    };
    const existing = byLineage.get(summary.lineageKey);
    if (
      !existing
      || (existing.summary.source === "external-codex" && existing.summary.updatedAt < summary.updatedAt)
    ) {
      byLineage.set(summary.lineageKey, projected);
    }
  }

  for (const session of sessions) {
    const projected = normalizeManagedSession(session, workspacesById);
    const existing = byLineage.get(projected.summary.lineageKey);
    if (existing?.summary.source === "managed" && existing.summary.updatedAt > projected.summary.updatedAt) {
      continue;
    }
    if (existing?.summary.contentSessionKey) {
      projected.summary = {
        ...projected.summary,
        contentSessionKey: existing.summary.contentSessionKey,
        updatedAt: Math.max(projected.summary.updatedAt, existing.summary.updatedAt),
      };
    }
    byLineage.set(projected.summary.lineageKey, projected);
  }

  const filtered = [...byLineage.values()]
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
    groups: groupPageItems(pageItems),
    items: pageItems.map((item) => item.summary),
    managedTargets,
    total: filtered.length,
  };
}

function normalizeExternalSession(session: ExternalSessionSummary): SessionSummary {
  return {
    ...session,
    lineageKey: codexLineageKey(session.contentSessionKey) ?? session.lineageKey,
    lifecycle: session.project.id ? "resumable" : "read-only",
  };
}

function normalizeManagedSession(
  session: SessionTile,
  workspacesById: ReadonlyMap<string, SessionsProjectInput>,
): ProjectedSession {
  const workspace = workspacesById.get(session.workspaceId);
  const project: SessionProjectRef = {
    id: workspace?.id ?? session.workspaceId,
    label: workspace?.label ?? session.workspaceId,
  };
  const freeChat = isFreeChatSession(session);
  const summary: SessionSummary = {
    sessionKey: `managed:${session.id}`,
    lineageKey: managedLineageKey(session),
    contentSessionKey: null,
    source: "managed",
    kind: managedKind(session),
    title: session.title,
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
  };
}

function managedLineageKey(session: SessionTile): string {
  return session.resumeTarget?.agentKind === "codex"
    ? `codex:${session.resumeTarget.sessionId}`
    : `managed:${session.id}`;
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
  if (
    (session.runtimeStatus === "restored" || session.runtimeStatus === "error" || session.runtimeStatus === "exited")
    && hasRelaunchContract(session)
  ) {
    return "recoverable";
  }
  return "read-only";
}

function hasRelaunchContract(session: SessionTile): boolean {
  const resumableAgent = session.agentKind === "codex"
    || session.agentKind === "claude"
    || session.command === "codex"
    || session.command === "claude";
  return Boolean(session.command?.trim()) || (session.runtimeStatus === "restored" && resumableAgent);
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
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    summary.title,
    groupLabel,
    summary.source,
    summary.kind,
    summary.branch,
    summary.model,
    summary.locationLabel,
    summary.snippet,
  ].some((field) => field?.toLowerCase().includes(normalizedQuery));
}

function compareProjectedSessions(a: ProjectedSession, b: ProjectedSession): number {
  return b.summary.updatedAt - a.summary.updatedAt
    || a.summary.sessionKey.localeCompare(b.summary.sessionKey);
}

function groupPageItems(items: ProjectedSession[]): SessionsProjectionPage["groups"] {
  const groupsById = new Map<string, { id: string; label: string; items: SessionSummary[] }>();
  for (const item of items) {
    const group = groupsById.get(item.group.id) ?? { ...item.group, items: [] };
    group.items.push(item.summary);
    groupsById.set(item.group.id, group);
  }

  return [...groupsById.values()].sort((a, b) => {
    if (a.id === "free-chats") return 1;
    if (b.id === "free-chats") return -1;
    return 0;
  });
}
