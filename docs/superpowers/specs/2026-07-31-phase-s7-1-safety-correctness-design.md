# Phase S7.1 — Safety and Correctness

**Status:** Complete  
**Date:** 2026-07-31  
**Owner:** `main`  
**Parent:** `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

## Summary

S7.1 closes the three accepted safety and correctness findings from the S7A
residue audit. It reconciles a rolled-back terminal snapshot before a desktop
state retry can persist stale intent, prevents runner credentials from being
sent over non-local HTTP, and keeps destructive Discard failures recoverable
when the preload invocation itself rejects.

The phase changes no product surface, visual language, schema, dependency, or
runner authentication model. S7.2 retains the tooling and accessibility
cleanup that does not block this safety wave.

## Problem

Three adjacent failure boundaries currently disagree about what remains safe
after an error:

1. terminal Discard restores recovery metadata in memory after a failed flush,
   while the desktop store still retains the failed deletion as retry intent;
2. authenticated cloud smoke accepts an operator-provided plain HTTP endpoint
   and attaches the device Bearer token;
3. the renderer handles a resolved `{ ok: false }` Discard result but not a
   rejected preload invocation.

Together these gaps can make Retry persist a state the UI already rolled back,
send a credential over an unencrypted non-local connection, or leave a
recovery tile without the warning needed to understand why Discard failed.

## Goals

- Make the restored terminal snapshot authoritative before a failed-save retry
  can run.
- Require HTTPS for authenticated cloud smoke outside local loopback hosts.
- Convert rejected Discard transport calls into the existing retained-tile
  warning contract.
- Add focused regressions for every accepted failure path.
- Preserve the current desktop state format, device-auth contract, and UI copy
  hierarchy.

## Non-goals

- No S7.2 work: `dev-doctor`, stale agent launch helpers, navigator ARIA
  semantics, and Windows-junction coverage remain separate.
- No browser client, browser authentication, or new cloud route.
- No database, desktop-state schema, migration, dependency, or lockfile change.
- No redesign of recovery, Discard confirmation, save banners, or terminal
  layout.
- No general persistence abstraction or transaction framework.

## Product and technical decisions

### 1. Reconcile rollback at its source

When the post-cleanup flush rejects, `terminal-manager` restores the forgotten
snapshot and immediately calls the existing terminal snapshot persistence path
again. The reconciliation attempt may still fail, but it replaces the store's
failed deletion intent with a snapshot containing the restored recovery item.
The original Discard error remains the result returned to the renderer.

This keeps one authoritative producer for `restoredTerminalSessions` and avoids
adding a store-specific `clearFailedState` or callback API.

### 2. Protect credentials at the URL boundary

`runner-auth` smoke accepts:

- `https:` for every host;
- `http:` only for `localhost`, `127.0.0.1`, or `::1`.

Public smoke remains unchanged because it does not attach the runner device
token. Validation happens before the first request and errors never include the
token.

### 3. Reuse the retained-tile warning

A rejected `terminalApi.forget()` call is normalized to the same `{ ok: false,
error }` branch already used for structured cleanup failures. The session tile
remains visible, the closing-operation guard is released, and the tile shows a
fixed recovery-oriented message. No new error surface is introduced.

## Acceptance criteria

1. After `forgetPersistedSession()` fails to flush and the in-memory snapshot is
   restored, the next successful Retry persists that restored snapshot rather
   than the failed deletion.
2. The reconciliation attempt preserves the original Discard error returned to
   the caller and does not loop on repeated write failure.
3. Authenticated smoke rejects non-loopback `http:` before making a request.
4. Authenticated smoke continues to work against local HTTP fixtures and HTTPS
   deployment URLs.
5. Public smoke behavior is unchanged.
6. A rejected preload Discard promise retains the recovery tile, releases the
   close guard, and renders the existing `Discard checkout blocked` warning.
7. Focused tests, desktop typecheck/build, and full `pnpm verify` pass.

## Validation and rollout

- Unit/integration tests cover store retry intent, terminal rollback
  reconciliation, URL validation before fetch, and renderer rejection handling.
- Tests use temporary desktop-state paths and local HTTP fixtures only.
- The real runner, real device token, real cloud deployment, and `~/.codex` are
  not used.
- Rollout is the normal desktop/script release path; no migration or feature
  flag is required.

## Risks

- A second persistence attempt can fail for the same disk condition. This is
  expected: its purpose is also to replace `failedState` with authoritative
  rollback intent; it must not hide or replace the original Discard error.
- URL validation must not break local runner smoke. Loopback hosts are explicit
  and regression-tested.
- Renderer handling must not remove or remount the retained recovery tile.

## Success metrics

| Metric | Target | Measurement |
|---|---:|---|
| Accepted S7.1 regressions | 3/3 green | focused automated tests |
| Credentialed requests to non-local HTTP | 0 | negative cloud-smoke test |
| Recovery snapshot retained after rollback + retry | 100% in regression | persisted-state assertion |
| New schema/dependencies/visual changes | 0 | scoped diff review |

## Closeout

**Implementation commits:** `01652e8`, `0b4663e`, `48bd471`

All three accepted regressions are closed. Focused verification passed the
desktop main-process suite (116/116), scripts suite (35/35), and renderer
Discard regressions (2/2). The final full `pnpm verify` passed, including
desktop tests (1011/1011) and Electron smoke (17/17).

Focused review reported 0 Critical, 0 Important, and 0 Minor findings. Two
earlier full-gate attempts exposed unrelated Electron timing flakes; each exact
rerun passed, and the final complete gate passed without retries.

No schema, migration, dependency, lockfile, visual-language, browser-auth, or
device-auth contract changed. S7.2 is the next roadmap slice.
