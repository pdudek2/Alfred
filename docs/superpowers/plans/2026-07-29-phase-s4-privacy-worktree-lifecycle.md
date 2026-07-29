# Phase S4 Privacy and Worktree Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve isolated work after live Close while ensuring retention Off, Clear, and legacy migration remove sensitive terminal launch data from memory and disk.

**Architecture:** Keep the existing terminal snapshot store and Recovery UI, but make launch fields optional and route every persisted snapshot through one sanitizer. Resolve sanitized worktrees through the existing workspace registry plus an opaque root fingerprint, and make destructive Discard an awaited transaction that forgets metadata only after cleanup succeeds.

**Tech Stack:** Electron IPC, TypeScript, React, Vitest, Node.js `crypto`/`path`/atomic file rename, existing Git-worktree helpers.

## Global Constraints

- Implement only findings 13, 15, and 16 from `docs/audits/2026-07-29-agent-sanity-review.md`.
- The accepted contract is `docs/superpowers/specs/2026-07-29-phase-s4-privacy-worktree-lifecycle.md`.
- Reuse the existing Recovery, worktree review/apply/discard, workspace store, and desktop-state store.
- Do not add dependencies, encryption, Keychain integration, a second persistence system, a new page, or a new modal family.
- Do not retain raw `cwd`, `baseCwd`, `shell`, `command`, `args`, `resumeTarget`, buffer, activity, or activity timestamps after retention Off or Clear.
- Never delete a worktree or branch before successful inspection/confirmation and successful cleanup.
- Never fall back to an untrusted or guessed workspace path.
- Do not modify `pnpm-lock.yaml`, database schema/migrations, API behavior, or broad global styles.
- Do not touch the real `~/.codex`; use fixtures or temporary workspaces.
- Never force-push or add AI co-author trailers.
- Do not push without Patryk's explicit authorization for the implementation session.

## File map

- `packages/schema/src/redactor.ts` — shared credential-pattern coverage.
- `packages/schema/test/redactor.test.ts` — realistic leak fixtures and overmatch controls.
- `apps/desktop/src/shared/terminal-ipc.ts` — optional persisted launch fields, opaque root fingerprint, and awaited Forget result.
- `apps/desktop/src/main/git-worktree.ts` — deterministic root fingerprint and managed-branch validation.
- `apps/desktop/src/main/git-worktree.test.ts` — fingerprint and branch-validation regressions.
- `apps/desktop/src/main/persisted-desktop-state.ts` — canonical snapshot sanitizer and automatic atomic migration.
- `apps/desktop/src/main/persisted-desktop-state.test.ts` — Off/Clear policy and migration-on-read regressions.
- `apps/desktop/src/main/terminal-manager.ts` — in-memory policy, retained live Close, workspace-root resolution, and transactional Discard.
- `apps/desktop/src/main/terminal-manager.test.ts` — lifecycle, resolver, cleanup-failure, and no-repersistence regressions.
- `apps/desktop/src/main/desktop-state-ipc.ts` — immediate Off/Clear application.
- `apps/desktop/src/main/desktop-state-ipc.test.ts` — settings and Clear IPC regressions.
- `apps/desktop/src/main/preload.cts` — Promise-returning Forget bridge.
- `apps/desktop/src/main/main.ts` — inject the existing workspace-store root resolver.
- `apps/desktop/src/main/main.test.ts` — verify resolver wiring.
- `apps/desktop/src/renderer/session-state.ts` — hydrate recovery-only records without inventing launch data.
- `apps/desktop/src/renderer/session-state.test.ts` — recovery-only hydration/relaunch guards.
- `apps/desktop/src/renderer/components/TerminalDesk.tsx` — hide Resume and reuse existing recovery/action-strip presentation.
- `apps/desktop/src/renderer/app.tsx` — await Discard and retain the tile on cleanup failure.
- `apps/desktop/src/renderer/app.test.tsx` — recovery-only actions, privacy copy, and failed Discard behavior.
- `docs/superpowers/specs/2026-07-29-phase-s4-privacy-worktree-lifecycle.md` — mark Complete only after all gates.
- `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md` — S4 closeout evidence and S5 routing.

---

### Task 1: Close the shared redactor gaps

**Files:**
- Modify: `packages/schema/src/redactor.ts`
- Test: `packages/schema/test/redactor.test.ts`

**Interfaces:**
- Consumes: existing `redactText(value: string): string`.
- Produces: unchanged public API with coverage for URI userinfo, Stripe, Google, GitLab, npm, SendGrid, JSON API-key assignments, and complete Cookie header values.

- [ ] **Step 1: Add failing realistic leak fixtures**

Append focused tests:

```ts
it.each([
  ["postgresql://alfred:sup3rs3cret@db.example.com:5432/alfred", "sup3rs3cret"],
  ["https://user:ghp_1234567890abcdef@github.com/a/b.git", "ghp_1234567890abcdef"],
  ["stripe sk_live_1234567890abcdef", "sk_live_1234567890abcdef"],
  ["google AIzaSyD1234567890abcdefghijklmnop", "AIzaSyD1234567890abcdefghijklmnop"],
  ["gitlab glpat-1234567890abcdef", "glpat-1234567890abcdef"],
  ["npm npm_1234567890abcdef", "npm_1234567890abcdef"],
  ["sendgrid SG.1234567890abcdef.abcdefghijklmnop", "SG.1234567890abcdef.abcdefghijklmnop"],
  ['{"api_key": "abc123SECRET"}', "abc123SECRET"],
  ["Cookie: session=abc123SECRET; csrf=xyz789LEAK", "abc123SECRET"],
  ["Cookie: session=abc123SECRET; csrf=xyz789LEAK", "xyz789LEAK"],
])("redacts leaked credential from %s", (input, leaked) => {
  const output = redactText(input);
  expect(output).toContain("[redacted]");
  expect(output).not.toContain(leaked);
});

it.each([
  "https://user@example.com/a/b.git",
  "stripe sk_live_preview",
  "google AIza-short",
  "npm install",
  "SG status report",
  '{"api_key_description": "used by local fixtures"}',
])("does not overmatch ordinary text: %s", (input) => {
  expect(redactText(input)).toBe(input);
});
```

- [ ] **Step 2: Run the redactor test and verify failure**

Run:

```bash
pnpm --filter @alfred/schema test -- redactor.test.ts
```

Expected: the new leak matrix fails on at least the formats named in finding 16; existing tests remain green.

- [ ] **Step 3: Implement the smallest shared pattern extension**

Add dedicated patterns before the generic assignment/header replacements:

```ts
const URI_USERINFO_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi;
const JSON_SECRET_ASSIGNMENT_PATTERN =
  /(["'](?:api[_-]?key|token|secret|password)["']\s*:\s*)(["'])([^"']+)\2/gi;
const COOKIE_HEADER_PATTERN =
  /\b(cookie)(\s*:\s*)([^"'`\r\n]+)/gi;
const STRIPE_LIVE_KEY_PATTERN = /\bsk_live_[A-Za-z0-9]{8,}\b/g;
const GOOGLE_API_KEY_PATTERN = /\bAIza[A-Za-z0-9_-]{20,}\b/g;
const GITLAB_TOKEN_PATTERN = /\bglpat-[A-Za-z0-9_-]{8,}\b/g;
const NPM_TOKEN_PATTERN = /\bnpm_[A-Za-z0-9]{8,}\b/g;
const SENDGRID_KEY_PATTERN = /\bSG\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
```

Apply them in `redactSecretText` while retaining surrounding non-secret context:

```ts
const withoutStructuredSecrets = value
  .replace(URI_USERINFO_PATTERN, (_match, scheme) => `${scheme}${REDACTED}@`)
  .replace(JSON_SECRET_ASSIGNMENT_PATTERN, (_match, prefix, quote) => `${prefix}${quote}${REDACTED}${quote}`)
  .replace(COOKIE_HEADER_PATTERN, (_match, header, separator) => `${header}${separator}${REDACTED}`)
  // existing quoted header, header, assignment, and CLI replacements remain here
```

Add the five vendor patterns to `SECRET_TEXT_PATTERNS`. Do not add a generic entropy detector.

- [ ] **Step 4: Run schema tests and typecheck**

Run:

```bash
pnpm --filter @alfred/schema test
pnpm --filter @alfred/schema typecheck
```

Expected: all schema tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit the redactor boundary**

```bash
git add packages/schema/src/redactor.ts packages/schema/test/redactor.test.ts
git commit -m "fix: redact common credential formats"
```

---

### Task 2: Define and migrate privacy-safe terminal snapshots

**Files:**
- Modify: `apps/desktop/src/shared/terminal-ipc.ts`
- Modify: `apps/desktop/src/main/git-worktree.ts`
- Test: `apps/desktop/src/main/git-worktree.test.ts`
- Modify: `apps/desktop/src/main/persisted-desktop-state.ts`
- Test: `apps/desktop/src/main/persisted-desktop-state.test.ts`
- Modify: `apps/desktop/src/renderer/session-state.ts`
- Test: `apps/desktop/src/renderer/session-state.test.ts`

**Interfaces:**
- Consumes: `redactText`, existing desktop privacy settings, and existing atomic `writeDesktopStateFile`.
- Produces:

```ts
export function workspaceRootFingerprint(rootPath: string): string;
export function isAlfredManagedBranchName(value: string): boolean;
export function sanitizePersistedTerminalSession(
  session: PersistedTerminalSessionSnapshot,
  privacySettings: DesktopPrivacySettings,
  clearLaunchData?: boolean,
): PersistedTerminalSessionSnapshot | null;
```

- [ ] **Step 1: Write failing fingerprint and sanitizer tests**

Add Git-worktree tests:

```ts
it("creates a stable opaque workspace root fingerprint", () => {
  expect(workspaceRootFingerprint("/repo")).toMatch(/^[a-f0-9]{16}$/);
  expect(workspaceRootFingerprint("/repo")).toBe(workspaceRootFingerprint("/repo/."));
  expect(workspaceRootFingerprint("/repo")).not.toBe(workspaceRootFingerprint("/other"));
});

it.each([
  ["alfred-codex-session-20260729120000-abcd1234", true],
  ["feature/customer-secret", false],
  ["../alfred-codex-session", false],
])("validates Alfred-managed recovery branch %s", (branchName, expected) => {
  expect(isAlfredManagedBranchName(branchName)).toBe(expected);
});
```

Add persisted-state tests that construct:

```ts
const isolated = {
  clientId: "codex-1",
  title: "Codex /Users/patryk/Client",
  source: "alfred" as const,
  agentKind: "codex" as const,
  workspaceId: "A",
  isolation: "worktree" as const,
  branchName: "alfred-codex-codex-1-20260729120000-abcd1234",
  baseCwd: "/Users/patryk/Client",
  cwd: "/private/worktrees/client/codex-1",
  shell: "/bin/zsh",
  command: "codex",
  args: ["secret customer prompt"],
  resumeTarget: {
    agentKind: "codex" as const,
    sessionId: "session-secret",
    source: "codex-session-index" as const,
  },
  buffer: "Authorization: Bearer abc.def.ghi",
  lastActivityAt: 10,
  lastOutputAt: 11,
};
```

Assert that retention Off returns a record with
`workspaceId`, `workspaceRootFingerprint`, `branchName`, and isolation, but no
`cwd`, `baseCwd`, `shell`, `command`, `args`, `resumeTarget`, `buffer`, or
activity timestamps. Assert that the same policy returns `null` for a shared
record.

- [ ] **Step 2: Verify the new tests fail**

Run:

```bash
pnpm --filter @alfred/desktop test -- git-worktree.test.ts persisted-desktop-state.test.ts session-state.test.ts
```

Expected: failures for missing fingerprint/branch helpers, required persisted launch fields, and missing sanitizer.

- [ ] **Step 3: Make persisted launch fields optional**

Replace the `Omit<TerminalSessionSnapshot, "id">` alias with an explicit
persisted type:

```ts
export type PersistedTerminalSessionSnapshot = {
  clientId: string;
  title: string;
  source: TerminalSessionSource;
  agentKind?: AgentKind;
  workspaceId?: string;
  workspaceRootFingerprint?: string;
  isolation?: TerminalSessionIsolation;
  branchName?: string;
  createdAt?: number;
  cwd?: string;
  baseCwd?: string;
  shell?: string;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
  buffer?: string;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  lastOutputAt?: number;
};
```

Add `workspaceRootFingerprint?: string` to `TerminalCreateResult`, so live
snapshots can carry the opaque recovery identity. Keep the other live
`TerminalSessionSnapshot` requirements unchanged.

- [ ] **Step 4: Implement fingerprint and managed-branch validation**

In `git-worktree.ts`, reuse the already imported `createHash` and `path`:

```ts
export function workspaceRootFingerprint(rootPath: string): string {
  return createHash("sha256")
    .update(path.resolve(rootPath))
    .digest("hex")
    .slice(0, 16);
}

export function isAlfredManagedBranchName(value: string): boolean {
  try {
    return value.startsWith("alfred-") && safeCleanupBranchName(value) === value;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Implement the canonical sanitizer**

Export `sanitizePersistedTerminalSession` from
`persisted-desktop-state.ts`. Build the redacted retained form once, derive a
fingerprint from legacy `baseCwd` when necessary, and return `null` for
non-recoverable cleared records:

```ts
export function sanitizePersistedTerminalSession(
  session: PersistedTerminalSessionSnapshot,
  privacySettings: DesktopPrivacySettings,
  clearLaunchData = false,
): PersistedTerminalSessionSnapshot | null {
  const launchDataCleared =
    clearLaunchData || privacySettings.terminalScrollbackRetention === "off";
  const fingerprint = session.workspaceRootFingerprint
    ?? (session.baseCwd ? workspaceRootFingerprint(session.baseCwd) : undefined);
  const safeIdentity =
    session.isolation === "worktree"
    && Boolean(session.workspaceId?.trim())
    && Boolean(fingerprint)
    && Boolean(session.branchName && isAlfredManagedBranchName(session.branchName));

  const identity = {
    clientId: session.clientId.trim(),
    title: redactText(session.title),
    source: session.source,
    ...(session.agentKind === undefined ? {} : { agentKind: session.agentKind }),
    ...(session.workspaceId === undefined ? {} : { workspaceId: session.workspaceId }),
    ...(fingerprint === undefined ? {} : { workspaceRootFingerprint: fingerprint }),
    ...(session.isolation === undefined ? {} : { isolation: session.isolation }),
    ...(session.branchName === undefined ? {} : { branchName: session.branchName }),
    ...(session.createdAt === undefined ? {} : { createdAt: session.createdAt }),
  };

  if (launchDataCleared) {
    return safeIdentity ? identity : null;
  }

  return {
    ...identity,
    ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    ...(session.baseCwd === undefined ? {} : { baseCwd: session.baseCwd }),
    ...(session.shell === undefined ? {} : { shell: session.shell }),
    ...(session.command === undefined || redactText(session.command) !== session.command
      ? {}
      : { command: session.command }),
    ...(session.args === undefined ? {} : { args: session.args.map(redactText) }),
    ...(session.resumeTarget === undefined ? {} : { resumeTarget: { ...session.resumeTarget } }),
    ...(session.buffer === undefined
      ? {}
      : { buffer: redactText(tailText(session.buffer, MAX_PERSISTED_TERMINAL_SCROLLBACK_LENGTH)) }),
    ...(session.activityEvents === undefined
      ? {}
      : { activityEvents: redactActivityEvents(session.activityEvents) }),
    ...(session.lastActivityAt === undefined ? {} : { lastActivityAt: session.lastActivityAt }),
    ...(session.lastOutputAt === undefined ? {} : { lastOutputAt: session.lastOutputAt }),
  };
}
```

Update `normalizeRestoredTerminalSessions` to parse optional launch fields,
then `flatMap` through this sanitizer. Do not keep a second privacy
implementation.

- [ ] **Step 6: Rewrite changed valid state during hydration**

Change the file reader to return a result:

```ts
type DesktopStateReadResult = {
  state: DesktopStateSnapshot;
  rewrite: boolean;
};
```

For a valid parsed file, compare:

```ts
const normalized = normalizeDesktopState(parsed);
const normalizedFile = { version: DESKTOP_STATE_VERSION, ...normalized };
return {
  state: normalized,
  rewrite: JSON.stringify(parsed) !== JSON.stringify(normalizedFile),
};
```

Missing, quarantined-corrupt, and unsupported files return defaults with
`rewrite: false`. During `hydrate`, route a changed valid state through the
existing `persistState(result.state)` path before exposing it:

```ts
const result = await readDesktopStateFile(filePath, options.onWarning);
if (result.rewrite) {
  await persistState(result.state);
  return;
}
cachedState = result.state;
hydrated = true;
```

This preserves atomic rename, warning, failed-state, and save-status behavior.

Add a migration regression that:

1. writes a valid legacy file containing both the isolated fixture and a shared
   fixture under retention Off;
2. calls `getState()`;
3. reads `desktop-state.json` and verifies only the safe isolated record remains;
4. verifies the directory contains no migration backup;
5. creates a second store, reads again, and verifies the file contents remain
   byte-for-byte identical.

- [ ] **Step 7: Hydrate recovery-only records without synthetic launch data**

Add `workspaceRootFingerprint?: string` to `SessionTile`. In
`hydratePersistedTerminalSessions`, use:

```ts
cwd: snapshot.cwd ?? "",
...(snapshot.workspaceRootFingerprint === undefined
  ? {}
  : { workspaceRootFingerprint: snapshot.workspaceRootFingerprint }),
initialBuffer: snapshot.buffer ?? "",
```

Do not invent a default command, args, resume target, `baseCwd`, or shell.
Add a session-state test asserting those fields remain absent.

- [ ] **Step 8: Run focused persistence and hydration checks**

Run:

```bash
pnpm --filter @alfred/desktop test -- git-worktree.test.ts persisted-desktop-state.test.ts session-state.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: focused tests pass and optional persisted fields introduce no type errors.

- [ ] **Step 9: Commit the persisted data contract**

```bash
git add apps/desktop/src/shared/terminal-ipc.ts apps/desktop/src/main/git-worktree.ts apps/desktop/src/main/git-worktree.test.ts apps/desktop/src/main/persisted-desktop-state.ts apps/desktop/src/main/persisted-desktop-state.test.ts apps/desktop/src/renderer/session-state.ts apps/desktop/src/renderer/session-state.test.ts
git commit -m "fix: sanitize persisted terminal recovery data"
```

---

### Task 3: Apply Off and Clear immediately in memory and on disk

**Files:**
- Modify: `apps/desktop/src/main/terminal-manager.ts`
- Test: `apps/desktop/src/main/terminal-manager.test.ts`
- Modify: `apps/desktop/src/main/desktop-state-ipc.ts`
- Test: `apps/desktop/src/main/desktop-state-ipc.test.ts`

**Interfaces:**
- Consumes: `sanitizePersistedTerminalSession(...)` from Task 2.
- Produces:

```ts
export function applyTerminalPrivacyPolicyInMemory(
  privacySettings: DesktopPrivacySettings,
  clearLaunchData?: boolean,
): number;
```

- [ ] **Step 1: Add failing immediate-policy tests**

In `terminal-manager.test.ts`, hydrate one shared restored record, one isolated
restored record, and one live session. Call:

```ts
const cleared = applyTerminalPrivacyPolicyInMemory(
  {
    terminalScrollbackRetention: "off",
    externalSessionIndexingEnabled: false,
  },
);
```

Assert:

- the shared restored record disappears;
- the isolated restored record remains without launch/transcript fields;
- the live session's next persisted snapshot does not restore its command,
  args, paths, resume target, old buffer, or old activity;
- a newly created session after the policy returns to `redactedTail` may persist
  new launch data;
- `cleared` counts affected client IDs once.

In `desktop-state-ipc.test.ts`, change the update-settings and Clear fixtures to
include `command`, `args`, `cwd`, `baseCwd`, `shell`, `resumeTarget`, buffer,
and activity. Assert both paths remove all of them and retain only the isolated
safe identity.

- [ ] **Step 2: Run the focused IPC tests and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- terminal-manager.test.ts desktop-state-ipc.test.ts
```

Expected: current code keeps launch fields and shared records, so the new assertions fail.

- [ ] **Step 3: Add a per-runtime persistence latch**

Add this internal field to `TerminalSession`:

```ts
persistLaunchData: boolean;
workspaceRootFingerprint?: string;
```

Initialize `persistLaunchData` to `true`. When an isolated launch returns
`baseCwd`, compute `workspaceRootFingerprint(baseCwd)` and store it on the live
session and every snapshot/result projection. When Off or Clear touches an
existing live session, set the latch permanently to `false` for that runtime,
clear its replay buffer and activity fields, and leave the running PTY itself
untouched.

In `toPersistedSnapshot`, omit launch/path fields when the latch is false while
still emitting the safe isolated recovery identity.

- [ ] **Step 4: Replace duplicate in-memory clearing with the shared sanitizer**

Implement:

```ts
export function applyTerminalPrivacyPolicyInMemory(
  privacySettings: DesktopPrivacySettings,
  clearLaunchData = false,
): number {
  const changed = new Set<string>();

  for (const [clientId, snapshot] of restoredSessionSnapshots) {
    const sanitized = sanitizePersistedTerminalSession(snapshot, privacySettings, clearLaunchData);
    if (JSON.stringify(snapshot) !== JSON.stringify(sanitized)) changed.add(clientId);
    if (sanitized) restoredSessionSnapshots.set(clientId, sanitized);
    else restoredSessionSnapshots.delete(clientId);
  }

  if (clearLaunchData || privacySettings.terminalScrollbackRetention === "off") {
    for (const session of sessions.values()) {
      if (!session.clientId) continue;
      session.persistLaunchData = false;
      session.buffer = "";
      delete session.activityEvents;
      delete session.lastActivityAt;
      delete session.lastOutputAt;
      changed.add(session.clientId);
    }
  }

  scheduleTerminalPersistence();
  return changed.size;
}
```

Remove `preparePersistedSessionForPrivacy` and make
`persistTerminalSnapshots` call the Task 2 sanitizer directly.

- [ ] **Step 5: Make settings update and Clear use the same policy**

In the privacy-setting handler:

```ts
const privacySettings = normalizeDesktopPrivacySettings(request);
applyTerminalPrivacyPolicyInMemory(privacySettings);
const state = await store.updateState((current) => ({
  ...current,
  privacySettings,
  restoredTerminalSessions: current.restoredTerminalSessions.flatMap((session) => {
    const sanitized = sanitizePersistedTerminalSession(session, privacySettings);
    return sanitized ? [sanitized] : [];
  }),
}));
```

In Clear:

```ts
const current = await store.getState();
const clearedInMemory = applyTerminalPrivacyPolicyInMemory(current.privacySettings, true);
const state = await store.updateState((latest) => ({
  ...latest,
  restoredTerminalSessions: latest.restoredTerminalSessions.flatMap((session) => {
    const sanitized = sanitizePersistedTerminalSession(session, latest.privacySettings, true);
    return sanitized ? [sanitized] : [];
  }),
}));
```

Keep the existing `{ ok, clearedSessions }` response contract.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @alfred/desktop test -- terminal-manager.test.ts desktop-state-ipc.test.ts persisted-desktop-state.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: Off/Clear tests pass without changing a running PTY.

- [ ] **Step 7: Commit immediate privacy enforcement**

```bash
git add apps/desktop/src/main/terminal-manager.ts apps/desktop/src/main/terminal-manager.test.ts apps/desktop/src/main/desktop-state-ipc.ts apps/desktop/src/main/desktop-state-ipc.test.ts
git commit -m "fix: enforce terminal privacy controls immediately"
```

---

### Task 4: Retain live Close and make Discard transactional

**Files:**
- Modify: `apps/desktop/src/shared/terminal-ipc.ts`
- Modify: `apps/desktop/src/main/preload.cts`
- Modify: `apps/desktop/src/main/main.ts`
- Test: `apps/desktop/src/main/main.test.ts`
- Modify: `apps/desktop/src/main/terminal-manager.ts`
- Test: `apps/desktop/src/main/terminal-manager.test.ts`
- Modify: `apps/desktop/src/renderer/app.tsx`
- Test: `apps/desktop/src/renderer/app.test.tsx`

**Interfaces:**
- Consumes: fingerprint helpers and optional persisted fields from Task 2.
- Produces:

```ts
export type TerminalForgetResult =
  | { ok: true }
  | { ok: false; error: string };

type TerminalIpcOptions = {
  // existing options
  resolveWorkspaceRoot?: (workspaceId: string) => Promise<string | undefined>;
};
```

`TerminalApi.forget(request)` becomes `Promise<TerminalForgetResult>`.

- [ ] **Step 1: Add failing lifecycle and resolver tests**

Add main-process tests for:

1. `kill({id})` on a live isolated session stops the PTY, retains a persisted
   record, and never calls cleanup.
2. Recovery remains listed after a fresh terminal-manager hydration.
3. A sanitized record resolves worktree diff through
   `resolveWorkspaceRoot("A")`, verifies its fingerprint, and calls inspection
   with the resolved root and branch.
4. A missing workspace or fingerprint mismatch returns `{ok:false}` without
   inspect/apply/cleanup.
5. Forget with successful cleanup removes the snapshot.
6. Forget with rejected cleanup returns `{ok:false}` and leaves the snapshot
   listed.

Use a resolver:

```ts
const resolveWorkspaceRoot = vi.fn(async (workspaceId: string) =>
  workspaceId === "A" ? "/repo" : undefined,
);
```

Add a renderer test where `forgetTerminal` resolves
`{ok:false,error:"Unable to remove isolated Git worktree."}` and assert the
recovery tile remains with that warning.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- terminal-manager.test.ts app.test.tsx main.test.ts
```

Expected: live Close currently forgets metadata; Forget is fire-and-forget and forgets before cleanup.

- [ ] **Step 3: Remove destructive cleanup from Kill**

Delete `cleanupWorktree` from `TerminalKillRequest`. Make `killSession` accept a
reason rather than cleanup options:

```ts
function killSession(id: TerminalSessionId, reason: "close" | "quit"): void
```

Both reasons retain the latest snapshot before killing the PTY. Record
`"Closed by user"` for close and keep `"Stopped on quit"` for quit. Only Forget
may perform destructive cleanup.

- [ ] **Step 4: Resolve sanitized worktree requests safely**

Extend `WorktreeOperationSession` with `workspaceId` and
`workspaceRootFingerprint`. Resolve `baseCwd` as follows:

```ts
const baseCwd = session.workspaceId && session.workspaceRootFingerprint
  ? await options.resolveWorkspaceRoot?.(session.workspaceId)
  : session.baseCwd;

if (!baseCwd) {
  return { ok: false, error: "Reattach the original project before managing this checkout." };
}
if (
  session.workspaceRootFingerprint
  && workspaceRootFingerprint(baseCwd) !== session.workspaceRootFingerprint
) {
  return { ok: false, error: "This workspace points to a different project. Reattach the original project first." };
}
```

Then pass the resolved root and branch through the existing safe cleanup
guard. Never use a renderer-supplied root.

- [ ] **Step 5: Make Forget an awaited cleanup transaction**

Change `terminalChannels.forget` from `ipcMain.on` to `ipcMain.handle` and
return `TerminalForgetResult`.

For `cleanupWorktree: true` on an isolated record:

1. reject live sessions;
2. resolve and validate the worktree request;
3. `await cleanupAgentWorktree(...)`;
4. only then call `forgetPersistedSession(clientId)`;
5. `await flushTerminalPersistence()`;
6. return `{ok:true}`.

Catch cleanup/resolution errors and return `{ok:false,error}` without forgetting
the snapshot.

For a shared record without valid worktree identity, skip cleanup and forget
only the recovery record. Do not require workspace-root resolution for that
non-destructive case.

- [ ] **Step 6: Wire the existing workspace store into terminal IPC**

In `main.ts`:

```ts
resolveWorkspaceRoot: async (workspaceId) => {
  const state = await workspaceStore.getWorkspaceState();
  return state.workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath;
},
```

Add a `main.test.ts` expectation that `registerTerminalIpc` receives a
`resolveWorkspaceRoot` function and that it returns the authoritative stored
root for workspace `A`.

- [ ] **Step 7: Convert the preload and renderer to Promise-based Forget**

In `preload.cts`:

```ts
forget: (request) =>
  ipcRenderer.invoke(terminalChannels.forget, request) as ReturnType<TerminalApi["forget"]>,
```

In `closeSessionNow`, read the target from
`terminalSessionsRef.current` outside the React updater. For a restored/exited
session, await Forget before removing the tile:

```ts
const result = await terminalApi.forget({ clientId: session.id, cleanupWorktree: true });
if (!result.ok) {
  setTerminalSessions((current) =>
    appendSessionActivity(current, session.id, {
      kind: "warning",
      title: "Discard checkout blocked",
      detail: result.error,
    }),
  );
  return;
}
setTerminalSessions((current) => closeSession(current, session.id));
```

Live Close sends only `kill({id})` and removes the live tile. This moves only
the destructive side effect required by S4 out of the state updater; the
broader finding 17 cleanup remains routed to S5.

Change the renderer bridge test default to:

```ts
const forgetTerminal = vi.fn(async (): Promise<TerminalForgetResult> => ({ ok: true }));
```

so unrelated existing discard tests retain their successful default.

- [ ] **Step 8: Run lifecycle and bridge tests**

Run:

```bash
pnpm --filter @alfred/desktop test -- terminal-manager.test.ts app.test.tsx main.test.ts
pnpm --filter @alfred/desktop typecheck
```

Expected: all new Close, resolver, cleanup-failure, and renderer-retention tests pass.

- [ ] **Step 9: Commit the lifecycle transaction**

```bash
git add apps/desktop/src/shared/terminal-ipc.ts apps/desktop/src/main/preload.cts apps/desktop/src/main/main.ts apps/desktop/src/main/main.test.ts apps/desktop/src/main/terminal-manager.ts apps/desktop/src/main/terminal-manager.test.ts apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx
git commit -m "fix: retain live worktrees until explicit discard"
```

---

### Task 5: Present recovery-only sessions truthfully

**Files:**
- Modify: `apps/desktop/src/renderer/session-state.ts`
- Test: `apps/desktop/src/renderer/session-state.test.ts`
- Modify: `apps/desktop/src/renderer/components/TerminalDesk.tsx`
- Modify: `apps/desktop/src/renderer/app.tsx`
- Test: `apps/desktop/src/renderer/app.test.tsx`

**Interfaces:**
- Consumes: optional launch fields and `workspaceRootFingerprint` from Task 2.
- Produces:

```ts
export function canRelaunchRestoredSession(
  session: Pick<
    SessionTile,
    "agentKind" | "command" | "cwd" | "runtimeStatus" | "source"
  >,
): boolean;
```

- [ ] **Step 1: Add failing recovery-only UI tests**

Create a persisted isolated record containing identity fields only:

```ts
const recoveryOnly: PersistedTerminalSessionSnapshot = {
  clientId: "codex-private",
  title: "Codex recovery",
  source: "alfred",
  agentKind: "codex",
  workspaceId: "A",
  workspaceRootFingerprint: "0123456789abcdef",
  isolation: "worktree",
  branchName: "alfred-codex-private-20260729120000-abcd1234",
  createdAt: 1,
};
```

Assert:

- hydration leaves `cwd`, command, args, resume target, base root, and buffer absent/empty;
- `relaunchRestoredSession` is a no-op;
- the tile has no Resume/Continue/Relaunch button;
- it shows
  `Launch details were cleared for privacy. Your isolated checkout is still available.`;
- it still exposes Review/Apply through the existing worktree flow and
  `Discard checkout`;
- a recovery item with a missing/rebound workspace shows the worktree-operation
  error and remains present.

- [ ] **Step 2: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @alfred/desktop test -- session-state.test.ts app.test.tsx
```

Expected: the current Codex fallback invents Resume latest and worktree review requires `baseCwd`.

- [ ] **Step 3: Add one relaunch-capability helper**

Implement:

```ts
export function canRelaunchRestoredSession(
  session: Pick<SessionTile, "agentKind" | "command" | "cwd" | "runtimeStatus" | "source">,
): boolean {
  if (session.runtimeStatus !== "restored" || !session.cwd) return false;
  if (session.agentKind === "codex" || session.agentKind === "claude") {
    return session.command === session.agentKind;
  }
  if (session.source === "manual" && !session.agentKind) return true;
  return Boolean(session.command);
}
```

Guard `relaunchRestoredSession` with this helper before deriving Codex/Claude
resume arguments.

- [ ] **Step 4: Recognize safe recovery identity without `baseCwd`**

Update renderer-only reviewability:

```ts
function hasIsolatedCheckoutMetadata(session: {
  baseCwd?: string;
  branchName?: string;
  workspaceId?: string;
  workspaceRootFingerprint?: string;
}): boolean {
  return Boolean(
    session.branchName
    && (
      session.baseCwd
      || (session.workspaceId && session.workspaceRootFingerprint)
    ),
  );
}
```

Keep the main process as the authority that validates the fingerprint and root.
Apply the same predicate in `app.tsx:isReviewableWorktreeSession` and pass
`workspaceId` plus `workspaceRootFingerprint` into the existing TerminalDesk
checkout helpers. Do not change the Agent Timeline classification, which
already treats explicit `isolation: "worktree"` as isolated.

- [ ] **Step 5: Hide Resume and reuse the existing action strip for privacy copy**

Compute:

```ts
const relaunchCapable = canRelaunchRestoredSession({
  agentKind,
  command,
  cwd,
  runtimeStatus,
  source,
});
const recoveryOnly = tileStatus === "restored" && worktreeRecoverySession && !relaunchCapable;
```

Render the existing Resume button only when `relaunchCapable`. For
`recoveryOnly`, render a `terminal-action-strip` with `role="note"` and the
accepted copy. Do not modify `styles.css`.

- [ ] **Step 6: Run renderer and accessibility-focused assertions**

Run:

```bash
pnpm --filter @alfred/desktop test -- session-state.test.ts app.test.tsx
pnpm --filter @alfred/desktop typecheck
```

Expected: recovery-only records have no launch action, retain worktree actions,
and expose the privacy note by role/text.

- [ ] **Step 7: Commit truthful Recovery behavior**

```bash
git add apps/desktop/src/renderer/session-state.ts apps/desktop/src/renderer/session-state.test.ts apps/desktop/src/renderer/components/TerminalDesk.tsx apps/desktop/src/renderer/app.tsx apps/desktop/src/renderer/app.test.tsx
git commit -m "fix: show privacy-safe worktree recovery"
```

---

### Task 6: Verify S4 and close the phase

**Files:**
- Modify after successful gates: `docs/superpowers/specs/2026-07-29-phase-s4-privacy-worktree-lifecycle.md`
- Modify after successful gates: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: all Task 1–5 behavior.
- Produces: fresh automated evidence, real macOS observation, focused review, and canonical S4 closeout.

- [ ] **Step 1: Run every focused package gate**

```bash
pnpm --filter @alfred/schema test
pnpm --filter @alfred/schema typecheck
pnpm --filter @alfred/schema build
pnpm --filter @alfred/desktop test
pnpm --filter @alfred/desktop typecheck
pnpm --filter @alfred/desktop build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the full project gates**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm verify
```

Expected: lint, all package tests/typechecks/builds, and Electron smoke pass.

- [ ] **Step 3: Perform the macOS worktree recovery observation**

Use a temporary Git repository and temporary Alfred user-data path:

1. launch an isolated agent fixture;
2. create one tracked modification and one untracked file;
3. Close the live session;
4. restart Alfred;
5. confirm Recovery lists it and Review shows both files;
6. apply it in one run;
7. recreate it and confirm permanent Discard in another run;
8. repeat after retention Off or Clear;
9. inspect the temporary `desktop-state.json` and verify none of
   `cwd`, `baseCwd`, `shell`, `command`, `args`, `resumeTarget`, `buffer`,
   `activityEvents`, `lastActivityAt`, or `lastOutputAt` remain in the
   recovery-only record.

Record the temporary paths and observed results, but never run against the real
runner home.

- [ ] **Step 4: Perform focused diff review**

Run:

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- apps/desktop/src packages/schema/src packages/schema/test
git diff --check
```

Verify:

- no API, database, runner, dependency, lockfile, or broad visual change;
- no duplicate sanitizer remains;
- no worktree cleanup forgets metadata before cleanup succeeds;
- no raw cleared launch field can be repersisted by an already-live session;
- finding 17 remains explicitly routed to S5 except for the single destructive
  updater path required by S4.

- [ ] **Step 5: Update canonical closeout documents**

In the S4 spec, set `Status: Complete` and append:

- implementation commit hashes;
- focused and full gate totals/results;
- macOS observation evidence;
- focused review result.

In the roadmap:

- set S4 to Complete;
- mark findings 13, 15, and 16 Closed with commit hashes;
- add an S4 closeout section;
- set **Next phase** to S5;
- keep S5 unplanned until a new convergence workflow begins.

- [ ] **Step 6: Commit the closeout**

```bash
git add docs/superpowers/specs/2026-07-29-phase-s4-privacy-worktree-lifecycle.md docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: close S4 privacy and worktree lifecycle"
```

- [ ] **Step 7: Confirm clean tracked state**

```bash
git status --short --branch
```

Expected: only pre-existing user-owned untracked directories may remain; no S4
tracked changes are uncommitted. Do not push unless Patryk explicitly asks.
