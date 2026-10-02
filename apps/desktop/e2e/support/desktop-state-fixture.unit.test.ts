import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopFixture } from "./desktop-state-fixture";

describe("desktop state fixture", () => {
  it("provides hermetic agent commands for POSIX and Windows lookup", async () => {
    const { paths } = await createDesktopFixture();

    try {
      for (const agent of ["codex", "claude"]) {
        const posixPath = path.join(paths.home, "bin", agent);
        expect((await stat(posixPath)).mode & 0o111).not.toBe(0);
        const posixCommand = await readFile(posixPath, "utf8");
        expect(posixCommand).toContain(`${agent} fixture ready`);
        expect(posixCommand).toContain("exec /usr/bin/tail -f");
        expect(await readFile(`${posixPath}.cmd`, "utf8")).toContain(`${agent} fixture ready`);
      }
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

  it("groups odd and even drafts into their own project plans without changing fixture semantics", async () => {
    const { paths, state } = await createDesktopFixture({
      inboxItems: 4,
      blockedInboxItem: 3,
      waitingInboxItem: 2,
    });

    try {
      expect(Object.keys(state.stagedPlans)).toEqual(["A", "B"]);
      expect(state.stagedPlans.A).toMatchObject({ id: "fixture-plan:A", workspaceId: "A" });
      expect(state.stagedPlans.B).toMatchObject({ id: "fixture-plan:B", workspaceId: "B" });
      expect(state.stagedPlans.A?.sessions.map((session) => session.id)).toEqual([
        "fixture-item-1", "fixture-item-3",
      ]);
      expect(state.stagedPlans.B?.sessions.map((session) => session.id)).toEqual([
        "fixture-item-2", "fixture-item-4",
      ]);
      for (const plan of Object.values(state.stagedPlans)) {
        expect(plan.sessions.every((session) => session.workspaceId === plan.workspaceId)).toBe(true);
      }
      expect(state.stagedPlans.A?.sessions[1]?.launchPreflight?.status).toBe("blocked");
      expect(state.stagedPlans.B?.sessions[0]).toMatchObject({
        command: "/bin/sh",
        args: ["-c", "/bin/echo 'Approval required: allow deterministic fixture?'; exec /bin/cat"],
      });
    } finally {
      await rm(paths.root, { recursive: true, force: true });
    }
  });

});
