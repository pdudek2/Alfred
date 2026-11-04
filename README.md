# Alfred

Alfred is a macOS desktop app for running several coding agents across projects. Each agent runs in its own terminal inside the window. Alfred shows which sessions are working, which ones wait for you, and where each agent makes its changes.

## What it does

- Lists your projects and their live sessions in one sidebar.
- Collects the sessions that need your answer in one place.
- Shows the folder and branch each session works in, and what it did recently.
- Keeps past sessions so you can read or resume them.
- Lets an agent start and follow worker sessions of its own.
- Can start an agent in its own git worktree, so two agents do not edit the same folder.

## Layout

- `apps/desktop`: the Electron app (main process, preload bridge and React renderer).
- `packages/schema`: contracts shared by the main process and the renderer.
