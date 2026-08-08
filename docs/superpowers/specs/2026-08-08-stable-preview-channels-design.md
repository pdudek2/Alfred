# Alfred Stable and Preview Channels

## Goal

Patryk can use Alfred for real terminal sessions while development continues in a visibly separate Preview app. Stable changes reach `main` only after Patryk approves deployment and closes Alfred.

## Channels

### Alfred (stable)

- Runs from `/Users/patryk/Desktop/Alfred` on `main`.
- Uses the existing desktop port `4310` and existing Electron user data.
- Keeps the current bundle name and identifier.
- Receives no merges or installer updates while the app is running.

### Alfred Preview

- Runs from the long-lived `/Users/patryk/Desktop/Alfred/.worktrees/alfred-preview` worktree on branch `alfred-preview`.
- Uses desktop port `4311`.
- Uses its own Electron user-data directory and therefore its own persisted desktop state, managed worktrees, PTYs, and single-instance lock.
- Installs as `/Users/patryk/Applications/Alfred Preview.app` with a distinct display name and bundle identifier.
- Starts only the desktop application. It does not start another runner or API service.

Both channels may point terminals at the same external project only when Patryk chooses to do so. Runtime isolation cannot prevent two intentional terminal sessions from editing the same files.

## Implementation

The existing macOS launcher installer remains the single owner of bundle generation. Its default behavior continues to install stable Alfred. A `preview` argument selects the Preview bundle metadata, port, and user-data directory.

`dev-electron.mjs` forwards an optional `ALFRED_DESKTOP_USER_DATA_DIR` as Electron's native `--user-data-dir` argument. Stable omits it and retains all existing data. Preview sets it explicitly. No new dependency or custom persistence layer is added.

## Promotion workflow

1. Feature work happens in isolated task worktrees.
2. Candidate commits are integrated into `alfred-preview`, never directly into a running stable `main`.
3. Patryk reviews the candidate in Alfred Preview.
4. Deployment waits until Patryk approves it and stable Alfred is fully closed.
5. Run full verification, merge `alfred-preview` into `main`, reinstall stable Alfred from `main`, and verify the installed bundle.

Tests and automated Electron runs continue to use hidden temporary profiles. They never use the stable or Preview profile.

## Failure handling

- The Preview installer fails before replacing a bundle if its icon source or pnpm executable is unavailable.
- Preview uses a strict dedicated port, so it cannot silently attach to stable Vite on `4310`.
- A failed Preview launch leaves stable Alfred untouched.
- Promotion stops on dirty tracked changes, a failed merge, failed verification, or a running stable Alfred process.

## Verification

- Installer integration tests verify stable and Preview bundle metadata, icon resources, launcher port, and Preview user-data argument.
- Script tests verify the optional Electron user-data argument is forwarded.
- A macOS runtime check launches Preview while stable Alfred is running and confirms distinct process arguments, ports, user-data paths, and application state.

This document is an active implementation contract only. Remove it during closeout after the workflow is implemented and verified.
