import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preflightAlfredPlan } from "./alfred-launch-preflight.js";

describe("preflightAlfredPlan", () => {
  it("marks sessions ready when the command is available", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "shell", title: "Logs", command: "tail", args: ["-f", "app.log"] }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      { commandExists: async () => true },
    );

    expect(result.sessions[0]?.launchPreflight).toEqual({
      status: "ready",
      label: "Ready",
      detail: "Will launch in the selected project.",
    });
  });

  it("blocks staged sessions when the command is missing", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "codex", title: "Codex", command: "codex", args: [] }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      { commandExists: async () => false },
    );

    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "blocked",
      code: "command_missing",
      reason: 'Command "codex" is not available on PATH.',
    });
  });

  it("blocks a draft whose folder is not in the project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "preflight-"));
    await mkdir(path.join(root, "apps", "desktop"), { recursive: true });

    const result = await preflightAlfredPlan(
      {
        sessions: [
          { kind: "codex", title: "Web", command: "codex", args: [], cwd: "apps/web" },
          { kind: "codex", title: "Desktop", command: "codex", args: [], cwd: "apps/desktop" },
        ],
      },
      { id: "A", label: "Alfred", rootPath: root },
      { commandExists: async () => true },
    );

    expect(result.sessions.map((session) => session.launchPreflight)).toEqual([
      expect.objectContaining({ status: "blocked", code: "cwd_missing", label: "Folder missing" }),
      expect.objectContaining({ status: "ready", label: "Ready" }),
    ]);
    await rm(root, { force: true, recursive: true });
  });

  it("normalizes unsupported prompt flags before launch preflight", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [
          {
            kind: "codex",
            title: "Review",
            command: "codex",
            args: ["--model", "gpt-5.5", "--prompt", "Review the backend"],
            cwd: "/repo",
          },
          {
            kind: "claude",
            title: "UX",
            command: "claude",
            args: ["--prompt=Review the UI"],
            cwd: "/repo",
          },
        ],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      { commandExists: async () => true },
    );

    expect(result.sessions[0]?.args).toEqual(["--model", "gpt-5.5", "Review the backend"]);
    expect(result.sessions[1]?.args).toEqual(["Review the UI"]);
  });

  it("blocks coding agents that ask to launch outside the selected project", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "codex", title: "Codex", command: "codex", args: [], cwd: "/other/repo" }],
      },
      { id: "A", label: "Alfred", rootPath: "/repo" },
      { commandExists: async () => true },
    );

    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "blocked",
      code: "cwd_outside_workspace",
      reason: "This agent asked to launch outside the selected project. Bind the right folder or adjust the plan.",
    });
  });

  it("falls back to a scratch launch when no workspace folder is bound", async () => {
    const result = await preflightAlfredPlan(
      {
        sessions: [{ kind: "claude", title: "Review", command: "claude", args: [] }],
      },
      { id: "A", label: "Alfred" },
      { commandExists: async () => true },
    );

    expect(result.sessions[0]?.launchPreflight).toMatchObject({
      status: "ready",
      label: "Scratch project",
    });
  });
});
