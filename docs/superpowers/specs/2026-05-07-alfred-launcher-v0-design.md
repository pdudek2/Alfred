# Alfred Launcher v0 — Design

- **Date:** 2026-05-07
- **Status:** draft (pending user review)
- **Scope:** `apps/desktop` only — main process, renderer, IPC. No backend, runner, web, schema, db, or packaging changes.
- **Predecessor docs:** `.superpowers/local-notes/2026-05-06-alfred-agent-space-ui-design.md` (Instrument Glass UI direction); `docs/superpowers/specs/2026-05-06-alfred-agent-space-design.md` (Agent Space spec).
- **Substrate PRs (already shipped):** #29 desktop shell, #30 manual terminal, #31 session launcher foundation, #32 terminal-first shell, #33 polish balance, #34 quiet decorations.

## 1. Goal

Let the user prompt Alfred from inside the Agent Space desktop app to **prepare** a workspace of multiple terminal sessions, review the proposed plan as staged tiles in the grid, and approve per-tile or all-at-once before any command runs. Manual terminals stay 100% independent — they can be opened, used, and closed regardless of Alfred's state.

This is the smallest slice that turns the cockpit from "manual-only" into "Alfred can prepare squads, you approve". It deliberately ships a real LLM call (not a stub) so the product has end-to-end value from v0.

## 2. Substrate already in place

What this spec **builds on** (not redesigns):

- Electron + xterm.js + node-pty multi-session foundation.
- Pure `apps/desktop/src/renderer/session-state.ts` with `addManualSession`, `closeSession`, `createInitialSessions`.
- Typed IPC contract `apps/desktop/src/shared/terminal-ipc.ts` with `create | write | resize | kill | data | exit`.
- Main process owns PTY lifecycle (`apps/desktop/src/main/terminal-manager.ts`).
- Renderer is declarative: `App` renders sessions from state, `ManualTerminalTile` owns its xterm + IPC binding.
- Three-region workspace layout: `WorkspaceRail | TerminalGrid (with header) | AlfredDock`.
- AlfredDock is currently an idle status surface ("Alfred / quiet" + paragraph + footer). It has the slot for orchestration UI.

## 3. Decisions (captured during brainstorm 2026-05-07)

| # | Fork | Choice | Rationale |
|---|---|---|---|
| 1 | Alfred intelligence | Real LLM call via **OpenRouter** | Unified API across providers, model fallbacks, easy v1 model swap; main process owns API key |
| 2 | Prompt input | **Composer bar at bottom**, full-width | Always-visible; matches Instrument Glass §4.5 |
| 3 | Plan render | **Staged tiles in grid + SquadPlanSummary in dock** | Cockpit metaphor (tiles on the runway); per-tile + plan-level controls coexist |
| 4 | Tile elasticity (drag/resize) | **Next slice**, not v0 | Keeps launcher PR focused; current `auto-fit` grid is non-blocking for future mosaic/splits |
| 5 | Plan output schema | **Hybrid**: typed `kind` + generic command/args | LLM constrained but flexible; per-kind visual differentiation; `shell` is generic fallback |

### Defaults declared (no fork worth a separate question)

- **API key location:** `OPENROUTER_API_KEY` in repo-root `.env`. Loaded by main process at startup. Settings UI deferred to packaged-app slice.
- **Persistence:** none in v0. Plan is in-memory; PTYs die when main process exits; restart = blank state.
- **Concurrency:** single in-flight plan request. Composer Send button disabled while `alfredStatus === "thinking"`.
- **Errors:** rendered in AlfredDock as a banner (replaces SquadPlanSummary slot). Non-fatal; composer remains usable; manual terminals untouched.
- **Approval semantics:** every staged tile is **default-pending**. User must click `[Approve]` per-tile, or `[Approve All]` plan-level, to spawn anything. `[X]` per-tile and `[Reject All]` plan-level remove without spawning.
- **Concurrent manual + Alfred:** manual flow is fully independent. User can open `+ New terminal` while a plan is in-flight, while staged tiles wait, etc. No global lock.

## 4. Architecture

Three layers:

```
┌─ Renderer ────────────────────────────────────────────┐
│  ComposerBar  →  alfred-state (pendingPlan, status)   │
│                          │                            │
│  TerminalGrid (manual + staged + live tiles)          │
│  AlfredDock (idle | SquadPlanSummary | ErrorBanner)   │
└──────────────────┬────────────────────────────────────┘
                   │ IPC (typed)
                   ▼
┌─ Main process ───────────────────────────────────────┐
│  AlfredOrchestrator (OpenRouter client, in-flight    │
│    guard, JSON schema validation)                    │
│  TerminalManager (existing, extended for command)    │
└──────────────────────────────────────────────────────┘
```

### Data flow: prompt → plan → approval → live

```
1. USER types in ComposerBar, hits ⌘⏎ or Send.
2. Renderer dispatches IPC: alfred:plan:request { prompt }.
3. AlfredOrchestrator (main):
   - rejects if inFlight === true → returns { ok: false, code: "in_flight" }
   - reads OPENROUTER_API_KEY (errors if missing)
   - POST https://openrouter.ai/api/v1/chat/completions
       body: { model, messages, response_format: { type: "json_schema", schema } }
   - parses response, validates against AlfredPlanSchema
   - returns { ok: true, plan } or { ok: false, error }
4. Renderer plan handler:
   - on ok: dispatch addStagedSessions(plan); set pendingPlan
   - on error: set alfredStatus = "error" with error.message
5. Grid renders new tiles with status="staged" (dashed brass border, body shows
   command preview, [Approve] [X] buttons).
6. Dock renders SquadPlanSummary with plan.name + count + [Approve All] [Reject All].
7. USER clicks [Approve] on a tile → dispatch approveStaged(tileId):
   - tile.status: "staged" → "live"
   - existing tile useEffect picks up status change, calls
     terminalApi.create({ command, args, cwd, cols, rows })
   - PTY spawns; xterm renders output exactly like a manual tile.
8. Dock SquadPlanSummary updates count; once empty, returns to idle paragraph.
```

## 5. State model

### Renderer types (`apps/desktop/src/renderer/session-state.ts`, extended)

```ts
export type AgentKind = "codex" | "claude" | "dev-server" | "shell";

export type SessionTile = {
  id: string;
  title: string;
  cwd: string;
  source: "manual" | "alfred";   // who created this
  status: "staged" | "live";     // lifecycle stage
  command?: string;              // undefined → defaults to user shell (manual flow)
  args?: string[];
  agentKind?: AgentKind;         // visual differentiation; required when source === "alfred"
};
```

Quadrants:

| source × status | live | staged |
|---|---|---|
| manual | existing tile, shell PTY | (impossible — manual is always live) |
| alfred | approved tile, command PTY | proposed by Alfred, no PTY yet |

### New helpers (same file)

```ts
addStagedSessions(sessions, planSessions: AlfredPlanSession[], defaultCwd: string): SessionTile[]
approveStaged(sessions, tileId: string): SessionTile[]
rejectStaged(sessions, tileId: string): SessionTile[]
approveAllStaged(sessions): SessionTile[]
rejectAllStaged(sessions): SessionTile[]
```

All pure, returning new arrays; covered by unit tests.

**`cwd` fallback:** when an `AlfredPlanSession` arrives with `cwd === undefined`, the renderer fills it from `defaultCwd` (the same value used by `createInitialSessions` and `addManualSession`, which is currently the empty string and ultimately resolved by `terminal-manager.resolveTerminalCwd` to `ALFRED_DESKTOP_WORKSPACE_CWD ?? INIT_CWD ?? repo root`). This means staged tiles default to the same workspace as manual tiles — Alfred can override per session by including `cwd` in its response.

### Alfred state (`apps/desktop/src/renderer/alfred-state.ts`, new)

```ts
export type AlfredStatus =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "error"; error: AlfredError };

export type SquadPlan = {
  id: string;            // plan-scoped uuid
  name?: string;         // optional human title from LLM
  prompt: string;        // what user typed
  sessionIds: string[];  // tile IDs in this plan, in order
};
```

Hooked in `App`:

```ts
const [alfredStatus, setAlfredStatus] = useState<AlfredStatus>({ kind: "idle" });
const [pendingPlan, setPendingPlan] = useState<SquadPlan | null>(null);
```

When `pendingPlan.sessionIds` becomes empty (all approved or rejected), `pendingPlan` is cleared and dock returns to idle.

## 6. IPC contract additions

### New file: `apps/desktop/src/shared/alfred-ipc.ts`

```ts
import type { AgentKind } from "../renderer/session-state";

export type AlfredPlanRequest = {
  prompt: string;
};

export type AlfredPlanSession = {
  kind: AgentKind;
  title: string;
  cwd?: string;
  command: string;
  args: string[];
};

export type AlfredPlan = {
  name?: string;
  sessions: AlfredPlanSession[];
};

export type AlfredErrorCode =
  | "no_api_key"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "malformed"
  | "in_flight";

export type AlfredError = {
  code: AlfredErrorCode;
  message: string;
};

export type AlfredPlanResponse =
  | { ok: true; plan: AlfredPlan }
  | { ok: false; error: AlfredError };

export type AlfredApi = {
  requestPlan(request: AlfredPlanRequest): Promise<AlfredPlanResponse>;
};

export const alfredChannels = {
  planRequest: "alfred:plan:request",
} as const;
```

(Note: response is via Promise return from `ipcRenderer.invoke`, not a separate channel — same pattern as `terminal:create`.)

### Modified: `apps/desktop/src/shared/terminal-ipc.ts`

```ts
export type TerminalCreateRequest = {
  cwd?: string;
  cols: number;
  rows: number;
  command?: string;   // NEW: if undefined, falls back to resolveShell()
  args?: string[];    // NEW
};
```

`terminal-manager.ts` `resolveShell()` is split into `resolveCommand(request)`:
- if `request.command` → `{ command: request.command, args: request.args ?? [] }`
- else → existing `resolveShell()` (login zsh / powershell)

## 7. UI surfaces

### ComposerBar — `apps/desktop/src/renderer/composer.tsx` (new)

- Bottom row of `.desktop-frame`. Grid changes from `46px 1fr` to `46px 1fr 60px`.
- Layout: `[brass A icon] [textarea (autosize 1-3 lines)] [Send button]`.
- Glass treatment: matches AlfredDock surface (Alfred-owned region).
- States:
  - idle: `placeholder="Ask Alfred to prepare a workspace…"`, Send enabled iff non-empty.
  - thinking: textarea read-only, Send shows spinner, "Alfred is thinking…" inline.
  - error: composer remains usable; error renders in dock, not composer.
- Keyboard: `⌘⏎` (Mac) / `Ctrl+⏎` submits. `Esc` clears input.

### Staged tile (variant of existing `.terminal-tile`)

- Border: `1px dashed rgba(217, 174, 70, 0.42)` (brass, dashed = "not yet alive").
- Tool-dot color per `agentKind`: codex=cyan, claude=violet (re-introduced for this purpose only), dev-server=green, shell=ink-soft.
- Body (replaces xterm-host): mono preview of `command args.join(" ")` and `cwd`, faint label "staged".
- Footer with two large buttons: `[Approve]` (brass-filled) and `[X]` (small icon-only).
- On Approve: tile re-renders as live (xterm-host appears, PTY spawn begins). Same component, different status branch.

### SquadPlanSummary (in `AlfredDock` when `pendingPlan` non-null)

Replaces the idle `<p>Manual work stays in front…</p>`:

```
A  Alfred
   plan: "<plan.name or 'Squad'>"
   ─────────────────
   3 staged · 0 live yet
   [Approve All]
   [Reject All]
   ─────────────────
   "<truncated original prompt>"
```

### ErrorBanner (in `AlfredDock` when `alfredStatus.kind === "error"`)

Coral-tinted card. Replaces SquadPlanSummary if both would show (error wins). Has `[Dismiss]` X.

## 8. LLM prompt design

### System prompt (initial draft, tunable in code without spec change)

```
You are Alfred, an agent orchestrator for a desktop coding cockpit.
The user will describe a workspace they want to prepare.
You return a JSON plan of terminal sessions to launch — but you do NOT launch
them. The user reviews and approves each session before it runs.

Each session has: kind, title, cwd, command, args.
- kind ∈ ["codex", "claude", "dev-server", "shell"]
- "codex" runs the codex CLI for AI coding assistance
- "claude" runs the claude (Claude Code) CLI
- "dev-server" runs a local dev server (e.g. pnpm dev, next dev)
- "shell" is a generic fallback for arbitrary commands (tail, docker logs, tests, etc.)

Title is a short human label (max 60 chars).
cwd is optional; if absent, current workspace cwd is used.
Keep plans focused: max 5 sessions.
Default to safe, idempotent commands. Never include destructive operations
(rm -rf, force-push, drop database). The user will run those manually.
```

### JSON schema (passed via OpenRouter `response_format: { type: "json_schema", schema: ... }`)

```json
{
  "type": "object",
  "required": ["sessions"],
  "additionalProperties": false,
  "properties": {
    "name": { "type": "string", "maxLength": 80 },
    "sessions": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["kind", "title", "command", "args"],
        "additionalProperties": false,
        "properties": {
          "kind": { "enum": ["codex", "claude", "dev-server", "shell"] },
          "title": { "type": "string", "maxLength": 60 },
          "cwd": { "type": "string" },
          "command": { "type": "string", "minLength": 1 },
          "args": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

### Default model

`anthropic/claude-haiku-4-5` (fast, cheap, structured-output capable).

Override via `ALFRED_LLM_MODEL` env var (no UI in v0).

## 9. File changes

### New files (5)

- `apps/desktop/src/main/alfred-orchestrator.ts` — OpenRouter client, IPC handler `alfredChannels.planRequest`, in-flight guard, JSON schema validation, error mapping.
- `apps/desktop/src/shared/alfred-ipc.ts` — typed channels, request/response/error types.
- `apps/desktop/src/renderer/composer.tsx` — ComposerBar component.
- `apps/desktop/src/renderer/alfred-state.ts` — `pendingPlan`, `alfredStatus`, pure reducers.
- `apps/desktop/src/renderer/alfred-state.test.ts` — Vitest coverage of reducers.

### Modified files (8)

- `apps/desktop/src/main/main.ts` — call `registerAlfredIpc()`; load `.env` early (via `dotenv` package or Node `--env-file`).
- `apps/desktop/src/main/preload.cts` — expose `window.alfredDesktop.alfred: AlfredApi`.
- `apps/desktop/src/main/terminal-manager.ts` — `resolveCommand(request)` helper; pass `command`+`args` to `nodePty.spawn` when present.
- `apps/desktop/src/shared/terminal-ipc.ts` — extend `TerminalCreateRequest` with optional `command`+`args`.
- `apps/desktop/src/renderer/desktop-api.ts` — add `getDesktopAlfredApi()`; widen `Window.alfredDesktop` type.
- `apps/desktop/src/renderer/session-state.ts` — extend `SessionTile` with `source`, `status`, `command`, `args`, `agentKind`; add `addStagedSessions`, `approveStaged`, `rejectStaged`, `approveAllStaged`, `rejectAllStaged`.
- `apps/desktop/src/renderer/session-state.test.ts` — extend coverage for new helpers (manual flow tests still pass unchanged).
- `apps/desktop/src/renderer/app.tsx` — render `Composer` at bottom, hook plan flow, render `SquadPlanSummary` in dock, render staged tile branch in `ManualTerminalTile` (or split into `TerminalTile` with internal branch on `status`).
- `apps/desktop/src/renderer/styles.css` — `.composer-bar`, `.terminal-tile.staged`, `.terminal-tile.staged .approve-button`, `.alfred-dock-plan`, `.alfred-dock-error`.

### Dependency

- `dotenv` (light, ~7KB, well-maintained). Or use Node 22+ `--env-file=.env` flag in `dev:electron` script — preferred if it works in packaged Electron context. Decided during impl.

## 10. Error handling matrix

| Error code | Trigger | Message shown in dock |
|---|---|---|
| `no_api_key` | `OPENROUTER_API_KEY` missing in `process.env` | "Set OPENROUTER_API_KEY in .env to use Alfred." |
| `auth` | OpenRouter HTTP 401 | "OpenRouter rejected the API key. Verify .env." |
| `rate_limit` | OpenRouter HTTP 429 | "Rate limited by OpenRouter. Try again in a moment." |
| `timeout` | `fetch` AbortController fires after 30s | "Alfred took too long. Try a clearer prompt or check connection." |
| `network` | `fetch` rejects (DNS, connection refused, offline) | "Can't reach OpenRouter. Check your connection." |
| `malformed` | JSON parse fails OR Ajv schema validation fails | "Alfred returned an invalid plan. Try a clearer prompt." |
| `in_flight` | User submits while previous request pending | (no banner — Send button disabled prevents this; defensive) |

All errors:
- Logged to main-process console (`console.error("[alfred-orchestrator] ...", error)`).
- Returned via IPC as `{ ok: false, error: { code, message } }`.
- Set `alfredStatus = { kind: "error", error }` in renderer.
- Composer remains enabled (user can refine prompt and try again).
- Manual terminals never affected.

## 11. Out of scope (deferred features)

These are intentionally **NOT** in v0. Each is a candidate for its own next slice, with its own brainstorm.

- **Tile elasticity** — drag-to-reorder, edge resize, tabs, splits, mosaic, detach to floating window. Next slice after launcher v0.
- **API key management UI** — settings panel, keychain integration, in-app paste-and-store. Packaged-app slice.
- **Plan persistence** across app restart.
- **PTY persistence** across app restart (re-spawn from saved command list).
- **Plan editability** before approval — user can only Approve or Reject in v0; no edit-then-approve.
- **Streaming LLM response** — v0 is one-shot. Streaming UX needs separate design.
- **Cancel-in-flight** plan request — v0 user just waits or kills app.
- **Multi-LLM model picker UI** — model is env var only.
- **Plan history / favorites / templates.**
- **Workspace-scoped session filtering** — `WorkspaceRail` switching is still cosmetic (deferred from terminal-first slice).

## 12. Open questions

None at design time.

If implementation surfaces ambiguity, fix inline and note in the implementation PR. Genuinely architectural questions during impl should pause work and re-enter brainstorm.

## 13. Self-review

- [x] **Placeholders:** no "TBD", "TODO", or "fill later". `dotenv` vs `--env-file` decision is explicitly named as impl-time.
- [x] **Internal consistency:** `SessionTile.source × status` quadrants enumerate all valid states; `SquadPlan.sessionIds` references existing tiles by id.
- [x] **Scope:** focused on launcher v0; out-of-scope list explicit; no creep into tile elasticity, persistence, packaging.
- [x] **Ambiguity:** approval semantics specified (default-pending, per-tile + plan-level); error UX specified per code; LLM schema specified; concurrency rule specified.
- [x] **Architecture matches feature description:** main owns API key + LLM call; renderer owns UI + state; IPC contract explicit.
- [x] **Existing code respected:** manual flow untouched, terminal-manager extended (not rewritten), session-state extended (not replaced), AlfredDock slot reused.
