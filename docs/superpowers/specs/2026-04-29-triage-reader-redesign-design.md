# Alfred Triage Reader Redesign — Design

- Date: 2026-04-29
- Branch: web-triage-reader (continued; per `AGENTS.md` we stay on the assigned branch)
- Status: draft, awaiting user review
- Author: brainstormed jointly with Patryk
- Scope of code: `apps/web` only (no API / runner / schema changes)

## 1. Summary

The current triage reader looks and feels like a diagnostic console: stacked
log-like rows, a generic UUID-dominated detail header, repeating uppercase
labels, no visual hierarchy, no narrative. It violates the product brief in
`docs/ALFRED_REFOUNDATION.md` — Alfred is meant to feel like a butler /
chief-of-staff, not `journalctl`.

This redesign rebuilds the web reader around three locked decisions:

1. **Two co-equal modes inside one shell**: a Reader (default) and an
   Observatory (constellation). They are not nav tabs; one swaps in for the
   other through a window-open transition triggered by `⌘O`.
2. **Drawer-focus master/detail**: clicking a run dims the feed (blur + brightness)
   and opens a focused reader drawer for that run. Same grammar of attention
   as the mode switch.
3. **A warm-dark visual language with serif headlines and a butler voice**.
   Discipline before decoration: no glow except where something genuinely
   pulses; word choice carries soul, not pronouns.

The change is strictly in the web app. The view model and API stay intact.

## 2. Goals

- Make the reader feel personal, calm, and read-worthy — closer to a private
  journal than a control room.
- Establish a visual language that scales to future modes (Missions,
  Memory, Orchestrator) without rework.
- Replace the uppercase / chip-heavy diagnostic surface with butler-voiced
  English copy and serif typography.
- Introduce a first Observatory (constellation) view as a peer mode, not a
  separate page.
- Keep the existing data layer (`run-view-model.ts`, `api-client.ts`) intact.
- Preserve test coverage and CI green.

## 3. Non-goals

- No changes to API, runner, schema, or shared packages.
- No LLM / AI summarization. Run-story paragraphs are deterministic synthesis.
- No Missions, Memory, Field Reports, Orchestration, or per-event approvals.
- No search beyond the existing inline filter.
- No mobile-first redesign in this pass. Existing mobile master/detail is left
  in a working baseline; full mobile pass is MVP1.
- No backend `parent_run_id` population. Observatory draws edges only when the
  field is present; otherwise nodes stand alone.

## 4. Locked decisions (from brainstorming)

| Decision | Value |
|---|---|
| Scope | Reader redesign + new Observatory mode in same shell |
| Mood | Hybrid A+D, light C in Observatory |
| Master/detail | Layout 3 — drawer focus |
| Mode switch | Single `⌘O` switch with window-open transition |
| App language | English UI strings (overrides default `AGENTS.md` Polish for product copy; user-facing summaries from agents stay Polish) |
| Voice register | C (quiet briefing) with sprinkles of B (first-person Alfred) in briefing, failure, empty states |
| Animation library | None — CSS transitions and SVG/CSS animations only |
| State management | React `useState` in `AppShell` + custom keyboard hook; no global store |

## 5. Architecture

### 5.1 Component map

New components (`apps/web/src/components/`):

- `app-shell.tsx` — top-level layout: header, mode toggle, Reader↔Observatory transition, global keyboard shortcuts.
- `sigil.tsx` — small "A" monogram with amber border. Single-purpose, decorative.
- `briefing.tsx` — one- to two-sentence morning briefing line; reads runs, computes voice via `lib/briefing.ts`.
- `reader.tsx` — wraps the reader-mode UI: filters, feed, and the drawer overlay.
- `feed-section.tsx` — sectioned feed wrapper with italic serif section labels (`Now`, `Today`, `Earlier this week`, `Older`).
- `run-row.tsx` — single row: state dot, serif `project · intent` title, sans subtitle, mono duration, one-word state label.
- `run-reader.tsx` — drawer content: title, story paragraph, activity list, raw payload (collapsed).
- `run-story.tsx` — renders a `RunStoryVM` (paragraph + clickable highlights).
- `observatory.tsx` — full-screen SVG constellation with project clusters, nodes, halos, edges.

Rewritten:

- `filter-bar.tsx` — replaced by soft pills (no caps, no chips), driven by the same view-model.
- `event-payload.tsx` — kept; used inside `run-reader.tsx` when a highlight or "raw payload" is expanded.

Deleted at end of implementation:

- `run-list.tsx` (replaced by `reader.tsx` + `feed-section.tsx` + `run-row.tsx`)
- `run-detail.tsx` (replaced by `run-reader.tsx`)
- `run-activity.tsx` (folded into `run-reader.tsx`; activity list is plain text)
- `status-overview.tsx`, `status-strip.tsx`, `status-pill.tsx` (replaced by `briefing.tsx`)
- `observatory-mockup.tsx` (Codex experiment — removed once real Observatory ships)

### 5.2 File structure (`apps/web/src/`)

```
components/
  app-shell.tsx           NEW
  sigil.tsx               NEW
  briefing.tsx            NEW
  reader.tsx              NEW
  feed-section.tsx        NEW
  run-row.tsx             NEW
  run-reader.tsx          NEW
  run-story.tsx           NEW
  observatory.tsx         NEW
  filter-bar.tsx          REWRITTEN
  event-payload.tsx       KEPT

lib/
  api-client.ts           KEPT
  run-view-model.ts       EXTENDED (time-grouping + RunCardVM.intent derivation; useRuns hook stays in app.tsx, consumed by AppShell)
  time.ts                 KEPT
  briefing.ts             NEW
  run-story.ts            NEW
  observatory-layout.ts   NEW
  use-keyboard-shortcut.ts NEW

styles/
  tokens.css              NEW (colors, fonts, spacing, motion)
  base.css                NEW (element-level baseline)
  app-shell.css           NEW
  reader.css              NEW
  observatory.css         NEW
  drawer.css              NEW

styles.css                THIN (imports from styles/)

test/
  app.test.tsx            REWRITTEN
  run-view-model.test.ts  EXTENDED
  briefing.test.ts        NEW
  run-story.test.ts       NEW
  reader.test.tsx         NEW
  observatory.test.tsx    NEW
```

### 5.3 Data flow

```
api-client.ts
   |
   v
useRuns() hook (existing, in app.tsx)
   |
   v
run-view-model.ts            <-- single source of truth for derived state
   |
   +--> briefing.ts           --> Briefing component
   +--> run-story.ts          --> RunReader component
   +--> observatory-layout.ts --> Observatory component
   |
   v
AppShell (mode + drawerRunId state)
   |
   +--> Reader  (filters, feed, drawer)
   +--> Observatory (canvas, drawer)
```

Key principle: the view-model layer is the only place that knows about the
shape of run data. Components consume `*VM` types and never reach into raw
`RunListItem` or `RunDetail`.

### 5.4 Top-level state in AppShell

```ts
type ViewMode = "reader" | "observatory";
type AppShellState = {
  viewMode: ViewMode;
  drawerRunId: string | null;
  selectedRunId: string | null; // for keyboard nav, may equal drawerRunId
};
```

URL is the source of truth for shareable state:
- `/` — Reader, no drawer
- `/?run=<id>` — Reader, drawer open for `<id>`
- `/?view=observatory` — Observatory
- `/?view=observatory&run=<id>` — Observatory with drawer

We use `URLSearchParams` directly (no router lib).

## 6. Reader spec

### 6.1 Layout (default, drawer closed)

- Centered column, `max-width: 720px`. Surrounding gutters use `--bg`.
- Header (rendered by `AppShell`):
  - Sigil + "Alfred" wordmark in serif
  - Day/time line on the right, italic serif (`Wednesday 11.42`)
  - No counters, no buttons.
- Briefing (`briefing.tsx`):
  - 1–2 sentences serif, `font-size: 16.5px`, `line-height: 1.55`, `max-width: 56ch`.
  - Key nouns rendered as warm-amber underlined spans (clickable → focuses
    the related run in the feed; opens drawer if there's exactly one match).
- Filter bar (`filter-bar.tsx`):
  - Four soft pills: `All`, `Live`, `Needs you`, `Done`. Active pill has
    surface-2 background.
  - Search appears inline as `›  search project or topic` placeholder.
- Feed (`reader.tsx` + `feed-section.tsx` + `run-row.tsx`):
  - Sections in this order, each with italic serif label and small mono total:
    1. `Now` (`live` + `waiting`)
    2. `Today` (started today, terminal)
    3. `Earlier this week` (started within last 7 days)
    4. `Older` (everything else, collapsed by default with `Show N older` link)
  - Empty sections are omitted entirely.

### 6.2 RunRow

```
[ • ]  alfred-runner — ingest retry pipeline                3m 04s
       Codex CLI · 12 commands, 9 ok, 3 over a minute       running
```

- Dot: 8 px circle. Color = state. Live and needs-you have a `box-shadow: 0 0 0 3px <color>/0.18` halo (no animation in row).
- Title: `Iowan Old Style`, 15 px, `project · intent`. Intent comes from `RunCardVM` (we extend it to derive a one-line intent: today's title field if present, else the longest tool/file changed).
- Subtitle: Inter, 12.5 px, dim. Comes from `lib/run-story.ts → buildRowSubtitle()` — a one-line summary, not the full paragraph.
- Right column: mono duration, then sans state label in lowercase (`running`, `needs you`, `ok`, `failed`, `stale`).
- Hover: `background: rgba(212, 166, 74, 0.025)` (warm tint, ~2.5% amber over bg). No border change.
- Selected (keyboard nav): left amber bar 2 px, `background: rgba(212, 166, 74, 0.04)`.

### 6.3 Drawer (focus mode)

- Triggered by: click on row, Enter on selected row, navigation to `?run=<id>`.
- Behind-the-drawer state: `<reader-feed>` gets `filter: blur(3px) brightness(0.45)` and `pointer-events: none`. Transition `220ms cubic-bezier(0.4, 0, 0.2, 1)`.
- Drawer wrapper:
  - Centered, max width 720 px, full height, padded 28 px.
  - Background: `--surface`, soft warm shadow (`box-shadow: 0 30px 100px -40px rgba(0,0,0,0.7)`).
  - Animation: `translateX(20px) → 0`, `opacity: 0 → 1`, same curve as blur.
- Drawer header:
  - Serif title 20 px (`project — intent`).
  - Sans subtitle 13 px dim (`Codex CLI · running · 1m 04s`).
  - Right side: state pill (sage / amber / coral / graphite) + `esc` mono hint.
- Story paragraph (`run-story.tsx`):
  - Serif 15 px, line-height 1.6, max width 56ch.
  - Highlights (file paths, commands, durations) are rendered as clickable spans that expand `event-payload.tsx` inline below.
- Activity list:
  - Plain mono timestamps + sans descriptions, one event per line.
  - No chips, no borders. 1 px dotted separator.
  - Default 12 visible; "Show N older" if more.
- Raw events (collapsed):
  - `‹ raw events` link in mono, click expands `event-payload.tsx` with full JSON.

### 6.4 Keyboard

- `↑` / `↓` — move selection in feed (drawer follows when open).
- `Enter` — open drawer for selected run.
- `Esc` — close drawer.
- `⌘O` / `Ctrl+O` — toggle Reader ↔ Observatory.
- `⌘K` / `Ctrl+K` / `/` — focus the search input (the inline filter input in `filter-bar.tsx`; functionality already exists, only the keybinding is new).

All routed through `lib/use-keyboard-shortcut.ts`.

### 6.5 Empty / loading / error states

- No runs at all (fresh install): Briefing reads "Quiet here. No agent has reported in yet." Feed shows a single italic serif line, centered, with a small ornament glyph.
- Loading: nothing — no spinners. Briefing line stays empty for a beat, then fades in.
- API error: `briefing.tsx` swaps to the error register: "I can't reach the runner right now. Mind checking it?" with a small `retry` link.

## 7. Observatory spec

### 7.1 Layout

- Full-screen SVG canvas. Viewport min 600 × 400. Background uses `--bg` with subtle radial warm tint at 50% / 40%.
- Three layers (`<g>` groups, painted in order):
  1. Cluster ellipses (project boundaries).
  2. Edges (parent/child run lines).
  3. Nodes (run circles with optional halo).
- Right-bottom: time-scope control as four mono pills: `today` · `7d` · `30d` · `all`. Default `7d`.
- Left-top: italic serif "Tonight's sky — N projects, M signals".

### 7.2 Layout algorithm (`observatory-layout.ts`)

Deterministic, no physics, stable across renders.

```
Inputs:
  - runs: RunCardVM[]
  - viewport: { width, height }
  - timeScope: "today" | "7d" | "30d" | "all"

Step 1: Filter runs by timeScope.
Step 2: Group by project (RunCardVM.projectLabel).
Step 3: For each project i of N (sorted by run count desc, then label asc):
  angle    = (i / N) * 2π + (hash(projectLabel) % 360 / 360) * 0.3
  radiusR  = max(min(viewport.width, viewport.height) / 3, 120)
  center   = (viewport.cx + cos(angle) * radiusR, viewport.cy + sin(angle) * radiusR)
  cluster.center = center
Step 4: For each run in cluster:
  nodeAngle  = (hash(run.id) % 360 / 360) * 2π
  nodeRadius = clusterRadius * (0.4 + (hash(run.id + "r") % 100) / 100 * 0.5)
  position   = clusterCenter + (cos(nodeAngle), sin(nodeAngle)) * nodeRadius
Step 5: For each parent_run_id present, draw 1 px line between parent and child positions.
```

Hash: simple FNV-1a or similar deterministic 32-bit hash. No external dep.

### 7.3 Node rendering

- Default: 2.5 px circle, stroke-less, fill = state color.
- Stale: graphite `#5a5247`, 2 px, 0.6 opacity.
- Live: 3.2 px sage, plus halo `<circle r=9 fill=url(#liveGlow)>` with `liveGlow` radial gradient sage 0.55 → 0. Halo animates 2.6 s ease-in-out.
- Needs-you: 3.6 px amber, plus halo r=11 amber 0.6 → 0, animating 1.8 s.
- Failed: coral, no halo.

### 7.4 Cluster ellipses

- Stroke `#2e2820` 1 px dashed `2 5`.
- Fill: none.
- Italic serif label above (or below if cluster is in upper half) the ellipse, opacity 0.7.

### 7.5 Edges

- 0.7 px stroke `#3a3228`.
- Cross-cluster edges: stroke-dasharray `1 3`.
- No animation.

### 7.6 Interactions

- Hover on node: tooltip — single sans line `<project> · <duration> · <state>`. No background, just floating text 11 px.
- Click on node: opens the same drawer as in Reader. List → canvas blur + dim treatment is identical.
- Esc: close drawer.
- `⌘O`: return to Reader (window-close transition).

### 7.7 Window-open transition (Reader ↔ Observatory)

- Phase 1 (out): outgoing view scales to `1.04` and fades to `opacity: 0` over 280 ms `cubic-bezier(0.32, 0.72, 0, 1)`.
- Phase 2 (in): incoming view starts at `scale(0.96), opacity: 0`, transitions to `scale(1), opacity: 1` with 60 ms delay.
- `prefers-reduced-motion: reduce` → both phases collapse to a 200 ms opacity cross-fade.

### 7.8 Performance

- SVG is fine up to ~500 visible nodes. Past that, rendering and animation budget tightens, but readability falls off first.
- If we ever need >500: switch nodes layer to Canvas (keep clusters and labels in SVG). Out of scope for MVP.

## 8. Voice and copy register

Locked: 95 % Layout C (quiet briefing through word choice), 5 % Layout B (first-person Alfred). The B sprinkles are confined to high-charge moments.

| Surface | Register | Example |
|---|---|---|
| Briefing — quiet day | B | *"Quiet morning. Codex closed the runner work; nothing else needs you."* |
| Briefing — needs you | B | *"Claude is waiting on you for the App Router migration. It's been three minutes."* |
| Briefing — failure | B | *"alfred-web's first build stopped on a type error. I'd take a look before retrying."* |
| Briefing — empty | B | *"Quiet here. No agent has reported in yet."* |
| Briefing — API error | B | *"I can't reach the runner right now. Mind checking it?"* |
| Run row title | C | *"alfred-runner — ingest retry pipeline"* |
| Run row subtitle | C | *"Codex CLI · 12 commands, 9 ok, 3 over a minute"* |
| Run-story (drawer) | C | *"Codex finished the runner — 47 minutes, three files, clean. Longest command: `pnpm test runner` at 0:42."* |
| Stale subtitle | C | *"Last seen 5 hours ago — left without closing"* |
| State label | C single word | `running`, `waiting`, `ok`, `failed`, `stale`, `needs you` |
| Section label | C italic serif | `Now`, `Today`, `Earlier this week`, `Older` |

Rules of thumb:
- No uppercase outside the sigil and the mono pills (`today · 7d · 30d`).
- No `status:` / `type:` / `kind:` prefixes.
- Numbers in serif body get unit spelled out (`47 minutes`, not `47m`).
- Mono is reserved for: durations in feed (`3m 04s`), timestamps in activity (`06:24`), file paths and commands in inline snippets.
- Each B-line should sound like one human sentence. Never two stitched together by Alfred.

## 9. Tokens

Defined once in `styles/tokens.css`, consumed everywhere in the redesign as `var(--reader-…)`.
The `reader` prefix is intentional: legacy Alfred CSS still owns generic variables like
`--bg`, `--text`, and `--amber` until the Task 21 cleanup.

```css
:root {
  /* Surfaces */
  --reader-bg: #14110d;
  --reader-surface: #1d1814;
  --reader-surface-2: #251f19;
  --reader-border: #2e2820;
  --reader-border-soft: #221d17;

  /* Text */
  --reader-text: #ede5d2;
  --reader-text-dim: #a89c83;
  --reader-text-faint: #6e6452;
  --reader-text-quiet: #4a4337;

  /* States */
  --reader-sage: #88a87a;       /* ok / live */
  --reader-amber: #d4a64a;      /* needs you */
  --reader-coral: #c97a6b;      /* failed */
  --reader-graphite: #5a5247;   /* stale */

  /* Typography */
  --reader-serif: 'Iowan Old Style', 'Source Serif 4', 'Source Serif Pro', 'Newsreader', Charter, Georgia, serif;
  --reader-sans: Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --reader-mono: 'Berkeley Mono', 'IBM Plex Mono', 'iA Writer Mono', ui-monospace, Menlo, monospace;

  /* Motion */
  --reader-ease-out: cubic-bezier(0.4, 0, 0.2, 1);
  --reader-ease-window: cubic-bezier(0.32, 0.72, 0, 1);
  --reader-t-drawer: 220ms;
  --reader-t-mode: 280ms;
  --reader-halo-live-dur: 2.6s;
  --reader-halo-needs-dur: 1.8s;

  /* Spacing rhythm */
  --reader-gap: 18px;
  --reader-gap-lg: 28px;
  --reader-col: 720px;
}
```

Self-hosted webfonts: only **Source Serif 4** (open-source, reliable across systems). Sans relies on Inter system-stack and is fine without self-hosting. Mono falls back to `ui-monospace` cleanly.

## 10. Briefing synthesis (`lib/briefing.ts`)

Deterministic. Pure function.

```ts
export type BriefingPiece =
  | { kind: "text"; value: string }
  | { kind: "highlight"; value: string; runId: string };

export type BriefingVM = {
  voice: "morning" | "afternoon" | "evening" | "error" | "empty";
  pieces: BriefingPiece[];
};

export function buildBriefingVM(runs: RunListItem[], now: Date, error?: ApiError): BriefingVM
```

Decision tree (in order, first match wins):
1. `error` → "I can't reach the runner right now. Mind checking it?"
2. `runs.length === 0` → "Quiet here. No agent has reported in yet."
3. needsAttention > 0 → lead with the most recent waiting run, "{Source} is waiting on you for {intent} on {project}. It's been {duration}."
4. failedToday > 0 → "{Project}'s {failedRun.intent} stopped. I'd take a look before retrying."
5. live > 0 → "{Source} is on {project} right now. {liveDuration} in."
6. completedToday > 0 → "{Greeting}. {N} sessions closed today; nothing else needs you."
7. fallback → "Nothing has happened yet today. The cave is quiet."

Greeting by hour: `< 12:00 → "Quiet morning"`, `< 18:00 → "Quiet afternoon"`, `else → "Quiet evening"`.

Today checks use local dates. Failed-today uses activity recency (`updatedAt || completedAt || startedAt`) so a failure that closed yesterday but reported today still surfaces. Completed-today uses actual close time (`completedAt || updatedAt || startedAt`) so a run completed yesterday but updated today does not count as closed today.

Highlights: project names, intents, durations are emitted as `highlight` pieces with the `runId` they belong to so the component can wire up clicks.

Task 6 v0 does not have failure reason data. Future run-story enrichment can add reason-aware failure copy once failure events are available.

Tested with fixture scenarios in `briefing.test.ts`.

## 11. Run-story synthesis (`lib/run-story.ts`)

Deterministic. Pure function.

```ts
export type StoryHighlight = {
  start: number; // index in paragraph
  end: number;
  kind: "file" | "command" | "duration" | "count";
  payload: { eventId?: string; filePath?: string; command?: string };
};

export type RunStoryVM = {
  paragraph: string;
  highlights: StoryHighlight[];
};

export function buildRunStoryVM(run: RunDetail, now: Date): RunStoryVM
```

Computed inputs:
- `duration` from `started_at` and `completed_at` (or `now` if running).
- `fileCount`: unique `file_path` values across tool-call payloads.
- `commandCount`: count of events where `payload.tool_name === "exec_command"`.
- `longestCommand`: command with max `duration_ms`.
- `failureReason` (failed only): from the most recent `error` / `failed` event payload.
- `lastSeenAgo` (stale only): humanized diff.

Templates by triage state:
- completed: `"{Source} finished {project} — {duration}, {fileCount} files, clean. Longest command: {cmd} at {durationMmSs}."`
- failed: `"{Source} stopped on {failureReason}. Touched {fileCount} files in {duration} before that."`
- waiting: `"{Source} is waiting for your {action}. {fileCount} files touched in {duration} so far."`
- running: `"{Source} has been working on {project} for {duration}. {fileCount} files touched, {commandCount} commands so far."`
- stale: `"{Source} stopped reporting {lastSeenAgo} ago. Touched {fileCount} files before that."`
- other / empty: `"Nothing to read yet — Alfred is still listening."`

Highlights array contains slice ranges so `run-story.tsx` renders clickable spans; clicking expands the relevant `event-payload` inline beneath the paragraph.

Tested in `run-story.test.ts` against fixture runs covering all six branches.

## 12. Performance and accessibility

### 12.1 Performance

- React: no expensive re-renders. Reader feed memoized per VM identity.
- Observatory: SVG up to 500 nodes is fine. No virtualization needed in MVP.
- Drawer blur: GPU-cheap on Mac/iOS; for `prefers-reduced-motion` we drop the blur and only fade.
- Webfonts: `font-display: swap`, only Source Serif 4 self-hosted (~30 KB woff2 subset).

### 12.2 Accessibility

- Color is never the only signal: every state has both color and a one-word label.
- Focus rings: 2 px amber, visible on all interactive elements.
- Drawer: `role="dialog"`, `aria-modal="true"`, focus trapped; Esc closes.
- Keyboard parity with mouse for: open drawer, navigate runs, switch mode.
- Reduced motion respected for all transitions.
- `aria-live="polite"` on briefing line so screen-readers announce changes.

## 13. Risks

1. **Fonts missing.** Berkeley/iA Mono are paid; many users won't have them.
   Fallback chain ends at `ui-monospace`/`Menlo` which is acceptable. Source
   Serif 4 self-hosted as the only commitment.
2. **Drawer blur on slow GPUs.** Low risk on Mac. `prefers-reduced-motion`
   path drops blur — covers Linux/older displays.
3. **Run-story scope creep.** Tempting to make it richer with LLMs. Spec
   commits to deterministic templates. LLM summaries are a future MVP1 win
   from the cloud worker, not from the web app.
4. **Codex parallel work.** A separate Codex session shipped
   `observatory-mockup.tsx` + 700 lines of CSS via `?mockup=1` while we
   brainstormed. We keep that file untouched as reference until our real
   Observatory ships, then delete it in the cleanup step. No live merge
   conflicts because we own the new file paths (`reader.tsx`, `observatory.tsx`,
   etc.) and the `?mockup=1` query is route-only.
5. **AGENTS.md language rule.** Spec explicitly overrides for product strings;
   user-facing summaries from agents stay Polish. We will note this in
   `AGENTS.md` after merge so future agents don't trip on it.
6. **Scope discipline.** Spec excludes Missions, Memory, Field Reports,
   Orchestrator, search-by-AI, and run grouping by case. The shell is
   future-ready (`viewMode` enum can grow) but no surface for them ships now.

## 14. Implementation sequencing

Granular plan belongs to `writing-plans`; here is the sequence the spec implies:

1. **Foundation**: tokens, base styles, `app-shell`, `sigil`, briefing skeleton (static text). One PR-sized vertical slice; no functional regression because both modes still render existing reader as a placeholder.
2. **Reader feed**: `feed-section`, `run-row`, time-grouping helpers in VM, soft-pill `filter-bar`. Reader visually swaps over.
3. **Run-story + drawer**: `lib/run-story.ts` + tests; `run-reader.tsx` + drawer transitions; `?run=<id>` URL state.
4. **Observatory**: `observatory-layout.ts` + `observatory.tsx`; window-open transition; time-scope pills; same drawer.
5. **Polish**: briefing copy table per Section 8; empty/error states; Source Serif 4 self-hosted with `font-display: swap`; reduced-motion path.
6. **Cleanup**: delete `run-list.tsx`, `run-detail.tsx`, `run-activity.tsx`, `status-*` components, `observatory-mockup.tsx`; remove `?mockup=1` route.
7. **Validation**: `pnpm --filter @alfred/web test / typecheck / build`; full `pnpm test / typecheck / build`; manual visual pass on `http://127.0.0.1:4300`; record findings in `WORKING_CONTEXT.md`.

## 15. Testing strategy

- `briefing.test.ts` — eight scenarios covering each branch in the decision tree.
- `run-story.test.ts` — six scenarios for the six template branches; verifies highlight ranges line up with paragraph indices.
- `observatory-layout.test.ts` — determinism: same runs in same order produce same positions; cluster centers stable as runs are added; node positions stable when an unrelated cluster grows.
- `reader.test.tsx` — keyboard nav (↑↓), Enter opens drawer, Esc closes drawer, drawer follows ↑↓ when open.
- `observatory.test.tsx` — node click opens drawer; tooltip shows on hover; `prefers-reduced-motion` switches transitions to fade-only.
- `app.test.tsx` — rewritten: top-level smoke test for shell + briefing + feed.
- Existing `run-view-model.test.ts` extended to cover new time-grouping helpers.
- All tests run via Vitest jsdom (existing setup; no new tooling).

## 16. Open questions (resolved during implementation)

- Exact briefing strings — tuned during the visual pass with the real run dataset, not during spec.
- `?run=<id>` URL-state implementation: locked to `URLSearchParams` directly per Section 5.4. Whether to extract a tiny `lib/routing.ts` helper is a refactor judgment call during the drawer step.
- Time-scope label wording on Observatory — `today / 7d / 30d / all` vs `today / week / month / all`. Pick during Observatory step.
- Stale threshold (currently 2 h hardcoded in VM) — keep hardcoded for MVP; configurable in MVP1.

## 17. Future work

- Real `parent_run_id` population in runner so Observatory edges populate.
- Run-story LLM enrichment via cloud worker (MVP1).
- Mobile-first pass (drawer becomes full-screen takeover).
- Full-text search over run-story content.
- Missions, Memory, Field Reports, Orchestrator views.

---

## Notes for spec users

- This file lives under `docs/superpowers/specs/`. The repo's `.gitignore`
  marks `docs/` as local-only ("local notes only, ignored by git"). The spec
  is intentionally not committed to git.
- `WORKING_CONTEXT.md` will be updated to point to this spec once the
  user signs off.
- Implementation plan is produced separately by `superpowers:writing-plans`
  after user approval of this design.
