# Alfred — Product Brief

Status: approved 2026-05-08
Author: Patryk + Claude (brainstorming session)
Purpose: 1-page guardrail document. Filters out proposals (mockups, designs, features) that miss the product. NOT a generator of new ideas — a constraint document.

## 1. What Alfred is

A desktop terminal client for orchestrating multiple parallel `claude` and `codex` sessions, organized by workspace, with structured agent activity displayed alongside raw stdout.

## 2. For whom

Patryk and a small group of dev friends running AI coding agents in CLI. Not SaaS. No tiers, no billing, no teams. Personal-grade — opinionated for the author's taste, polished enough that a friend can install it without burning.

## 3. DNA — three pillars

Without these, Alfred is just a skin on `claude`:

- **Persistent sessions.** A session has identity (id, state, history, metadata) and outlives the window. Close Alfred, return tomorrow to the same session with full scrollback and agent activity timeline intact.
- **Workspace binding.** Every session belongs to a workspace. A workspace knows its `cwd`, branch, env, MCP servers. There is no "loose" session — sessions live inside projects.
- **Structured agent output.** Alfred parses what `claude`/`codex` produces — tool calls, file edits, plans, errors — and shows them as discrete, navigable objects on a timeline panel adjacent to raw terminal.

## 4. The 90% workflow

1. Open Alfred → land on the last active workspace.
2. See 3–4 live sessions in a grid. Each shows its state (running / idle / awaiting / done) at a glance.
3. Click or keyboard a session → that cell expands; agent timeline panel slides in from the right showing recent tool calls / file edits / plan progress.
4. Type a prompt or accept an approval; collapse back to grid; check the next session.
5. Close Alfred at end of day. Tomorrow: same workspaces, same sessions, same state.

## 5. Hero screen

Three layers, dark navy background (never pure black):

- **Workspace rail (left, narrow)** — glass-pill list of workspaces with session counts. Switching workspace replaces the grid.
- **Session grid (center)** — 2×2 or 3-column glass cards. Each card: thin glass border (1 px @ ~7% white), dark opaque inner viewport for terminal stdout (legibility-first), small status badge top-right (dot + word), tiny meta strip bottom (model, tokens used, cost). On hover: subtle 2 px lift + soft shadow.
- **Focus mode** — clicking/keyboarding a card scales it spring-physics to ~70% width; agent timeline glass-panel slides in from right (~30% width), scrollable, time-ordered. Esc collapses back to grid.
- **Top-right: Alfred 3D sigil** — small 3D-rendered mark reflecting aggregate state (idle / activity / awaiting approval / error). Brand anchor.

## 6. Voice and visual direction

- **Aesthetic family:** Revolut-grade glassmorphism, dark, layered, depth-aware. Big-number Revolut style for stats that answer real questions (cost, % context used, session age, queue length). Spring/physics motion. One brand accent color (NOT generic AI-tool purple — candidates: deep cyan, electric mint, warm copper, deep coral — TBD after first colored prototype).
- **Voice in copy:** plain English, terse, full words. No emoji. No CAPS. No `_underscore_codes_`. A session is called "session", a workspace "workspace", agent activity "activity". Status messages are present-tense and quiet.
- **Glass for chrome (cards, rails, panels). Opaque for high-density content (terminal stdout, agent timeline body text).**
- **Reference visual language:** Revolut (chrome + big numbers + premium feel), Arc browser (sidebar, motion), Linear 2024+ (object list ergonomics), Things 3 (personal-grade richness), Ghostty (terminal typography density inside cells), Cursor agent panel (timeline structure — NOT visual style).

## 7. What Alfred is NOT (hard bans)

These exist to filter future proposals — from designers, AI tools, or future-self drift.

- **No sci-fi LARP language.** Banned: "Mission Control", "Workspace Orchestrator", "ALFRED_OS", "NEURAL LINK", "SYS_*", "kernel", "v4.2 protocol", "initialize_node". Sessions are sessions, not "neural execution streams".
- **No pricing tiers.** Banned: "Premium", "Ultimate", "Artisan", "Pro", upgrade prompts, locked features, edition labels. Every feature is available or doesn't exist.
- **No generic AI dashboard template.** The Stitch template was: abstract-menu sidebar (`Dashboard / Agents / Deployments / Security / Settings / Docs`) + 3 status cards + big primary CTA + footer metrics. Banned as a *combo*, not as individual pieces. Alfred has a sidebar — the workspace rail (Section 5) — but it lists real, clickable workspaces, not abstract menu sections. **Sidebar element: allowed and prescribed. Sidebar-as-fake-SaaS-nav: banned.** Layout is built around the session grid, not around cards-with-icons-and-status.
- **No flat / Linear-style restraint as primary direction.** Linear is referenced for object-list ergonomics, not for chrome austerity. Glass and depth are required.
- **No generic-purple-AI-tool palette.** Color is chosen deliberately, not borrowed from the current AI-dev-tool common pool.
- **No fake telemetry.** Numbers appear only when they answer a real user question. CPU%, MEM, "active agents 7", "neural latency 24ms" — banned. Cost-per-session, % context used, session age, tokens spent — welcome.

## 8. Open decisions (resolved during execution, not here)

- Brand accent color — picked after the first colored prototype change in v1.
- Alfred 3D sigil — geometry, material, motion vocabulary. May require an external designer or a strong reference (Spline scene, Vercel-grade icon).
- Mission graph — keep / fold into focus mode / remove. Leaning fold. Decision deferred until after the first 5 incremental changes to v1.

## 9. Success criterion

A friend you sent the app to opens it, runs `claude` for 30 minutes, and says: "this looks like a real product I'd actually use." Not "wow AI". Not "looks like Revolut". Just "real product". That is the bar.

## 10. How this brief is used

- It does NOT generate features or designs. It REJECTS proposals that contradict any rule above.
- Implementation strategy: do NOT build v2 from scratch. Apply 5 incremental changes to the existing `apps/desktop/src/renderer` based on this brief, one every 1–2 days, live with each before the next. Decision on whether v2-from-scratch is needed is deferred until after those 5 changes are in and have been used for a week.
- Plan for those 5 changes is captured in a separate document via `superpowers:writing-plans`.
