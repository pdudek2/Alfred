import { describe, expect, it } from "vitest";

import type { RunListItem } from "../lib/api-client";
import { buildBriefingVM } from "../lib/briefing";

const baseRun: RunListItem = {
  id: "r1",
  workspace_id: "w1",
  project_id: "p1",
  project_key: "alfred-runner",
  project_name: "alfred-runner",
  source_id: "codex-cli",
  source_run_id: "src-1",
  status: "completed",
  title: "ingest retry",
  started_at: localIso(2026, 3, 29, 7),
  completed_at: localIso(2026, 3, 29, 7, 30),
  updated_at: localIso(2026, 3, 29, 7, 30),
  created_at: localIso(2026, 3, 29, 7),
};

const now = new Date(2026, 3, 29, 11);

function localIso(
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): string {
  return new Date(year, monthIndex, day, hour, minute, second, millisecond).toISOString();
}

function plainText(vm: { pieces: Array<{ value: string }> }): string {
  return vm.pieces.map((piece) => piece.value).join("");
}

describe("buildBriefingVM", () => {
  it("falls back to error voice when an error is provided", () => {
    const vm = buildBriefingVM([], now, new Error("boom"));
    expect(vm.voice).toBe("error");
    expect(plainText(vm)).toMatch(/I can't reach the runner/i);
  });

  it("uses the empty voice when there are no runs", () => {
    const vm = buildBriefingVM([], now);
    expect(vm.voice).toBe("empty");
    expect(plainText(vm)).toMatch(/no agent has reported in/i);
  });

  it("leads with the waiting run when something needs you", () => {
    const waiting = {
      ...baseRun,
      id: "r2",
      status: "waiting",
      title: "App Router migration",
      project_name: "alfred-web",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 30),
    };
    const vm = buildBriefingVM([waiting], now);

    expect(vm.voice).toBe("morning");
    expect(plainText(vm)).toBe("Codex needs you for App Router migration on alfred-web. Last activity 30m ago.");
    expect(plainText(vm)).toContain("alfred-web");
    expect(plainText(vm)).toContain("App Router migration");
    expect(plainText(vm)).not.toContain("open");
    expect(plainText(vm)).toContain("30m");
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "App Router migration", runId: "r2" });
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "alfred-web", runId: "r2" });
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "30m", runId: "r2" });
  });

  it("uses the most recently updated waiting run, not input order", () => {
    const older = {
      ...baseRun,
      id: "r-old-waiting",
      status: "waiting",
      title: "older approval",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10),
    };
    const newer = {
      ...baseRun,
      id: "r-new-waiting",
      status: "waiting",
      title: "newer approval",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 45),
    };

    const vm = buildBriefingVM([older, newer], now);

    expect(plainText(vm)).toContain("newer approval");
    expect(plainText(vm)).not.toContain("older approval");
    expect(plainText(vm)).toContain("15m");
  });

  it("lets waiting beat failed, live, and completed runs", () => {
    const waiting = {
      ...baseRun,
      id: "r-waiting-first",
      status: "waiting",
      title: "approve cleanup",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 15),
    };
    const failed = { ...baseRun, id: "r-failed-later", status: "failed", title: "broken build", updated_at: localIso(2026, 3, 29, 10, 50) };
    const live = { ...baseRun, id: "r-live-later", status: "running", title: "active run", completed_at: null, updated_at: localIso(2026, 3, 29, 10, 45) };
    const completed = { ...baseRun, id: "r-completed-later", title: "finished run", updated_at: localIso(2026, 3, 29, 10, 40) };

    const vm = buildBriefingVM([failed, live, completed, waiting], now);

    expect(plainText(vm)).toContain("Codex needs you for approve cleanup");
    expect(plainText(vm)).toContain("approve cleanup");
  });

  it("does not repeat generic waiting copy in the briefing", () => {
    const waiting = {
      ...baseRun,
      id: "r-generic-waiting",
      status: "waiting",
      title: null,
      source_run_id: "019dd5a8-9bb7-7691-a66b-1fa59eccdde3",
      project_name: "Alfred",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 58),
    };

    const vm = buildBriefingVM([waiting], now);

    expect(plainText(vm)).toBe("Codex needs you on Alfred. Last activity 2m ago.");
    expect(plainText(vm)).not.toContain("waiting on you for waiting on you");
  });

  it("floors waiting elapsed minutes below the hour threshold", () => {
    const waiting = {
      ...baseRun,
      id: "r-floor-waiting",
      status: "waiting",
      title: "almost hourly approval",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 0, 29),
    };

    const vm = buildBriefingVM([waiting], now);

    expect(plainText(vm)).toContain("59m");
    expect(plainText(vm)).not.toContain("1h");
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "59m", runId: "r-floor-waiting" });
  });

  it("switches waiting elapsed time to hours at exactly 60 minutes", () => {
    const waiting = {
      ...baseRun,
      id: "r-hour-waiting",
      status: "waiting",
      title: "hourly approval",
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10),
    };

    const vm = buildBriefingVM([waiting], now);

    expect(plainText(vm)).toContain("1h");
    expect(plainText(vm)).not.toContain("60m");
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "1h", runId: "r-hour-waiting" });
  });

  it("calls out a failed run from today", () => {
    const failed = { ...baseRun, id: "r3", status: "failed", title: "first build" };
    const vm = buildBriefingVM([failed], now);

    expect(plainText(vm)).toMatch(/stopped/i);
    expect(plainText(vm)).toMatch(/take a look/i);
    expect(plainText(vm)).toBe("alfred-runner's first build stopped. I'd take a look before retrying.");
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "alfred-runner", runId: "r3" });
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "first build", runId: "r3" });
  });

  it("counts a failed run as today when it completed yesterday but updated today", () => {
    const failed = {
      ...baseRun,
      id: "r-cross-midnight-failed",
      status: "failed",
      title: "overnight deploy",
      started_at: localIso(2026, 3, 28, 23, 40),
      completed_at: localIso(2026, 3, 28, 23, 55),
      updated_at: localIso(2026, 3, 29, 0, 15),
    };
    const vm = buildBriefingVM([failed], now);

    expect(plainText(vm)).toMatch(/stopped/i);
    expect(plainText(vm)).toContain("overnight deploy");
  });

  it("uses the most recently updated failure from today, not input order", () => {
    const older = {
      ...baseRun,
      id: "r-old-failed",
      status: "failed",
      title: "older failure",
      completed_at: localIso(2026, 3, 29, 8),
      updated_at: localIso(2026, 3, 29, 8),
    };
    const newer = {
      ...baseRun,
      id: "r-new-failed",
      status: "failed",
      title: "newer failure",
      completed_at: localIso(2026, 3, 29, 10),
      updated_at: localIso(2026, 3, 29, 10),
    };

    const vm = buildBriefingVM([older, newer], now);

    expect(plainText(vm)).toContain("newer failure");
    expect(plainText(vm)).not.toContain("older failure");
  });

  it("lets a failure from today beat live and completed runs", () => {
    const failed = { ...baseRun, id: "r-failed-first", status: "failed", title: "prod check", updated_at: localIso(2026, 3, 29, 9) };
    const live = { ...baseRun, id: "r-live-newer", status: "running", title: "active repair", completed_at: null, updated_at: localIso(2026, 3, 29, 10, 50) };
    const completed = { ...baseRun, id: "r-completed-newer", title: "finished repair", updated_at: localIso(2026, 3, 29, 10, 45) };

    const vm = buildBriefingVM([live, completed, failed], now);

    expect(plainText(vm)).toContain("prod check stopped");
    expect(plainText(vm)).not.toContain("active repair");
    expect(plainText(vm)).not.toContain("closed today");
  });

  it("describes a live run when something is running", () => {
    const live = {
      ...baseRun,
      id: "r4",
      status: "running",
      title: "ingest retry",
      started_at: localIso(2026, 3, 29, 8, 55),
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 50),
    };
    const vm = buildBriefingVM([live], now);

    expect(plainText(vm)).toMatch(/right now|on it/i);
    expect(plainText(vm)).toContain("alfred-runner");
    expect(plainText(vm)).not.toContain("open");
    expect(plainText(vm)).toContain("2h 5m");
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "alfred-runner", runId: "r4" });
    expect(vm.pieces).toContainEqual({ kind: "highlight", value: "2h 5m", runId: "r4" });
  });

  it("lets a live run beat completed runs", () => {
    const live = {
      ...baseRun,
      id: "r-live-first",
      status: "running",
      title: "active import",
      project_name: "alfred-live",
      started_at: localIso(2026, 3, 29, 10, 30),
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 10, 30),
    };
    const completed = {
      ...baseRun,
      id: "r-completed-newer",
      title: "finished import",
      project_name: "alfred-done",
      updated_at: localIso(2026, 3, 29, 10, 55),
    };

    const vm = buildBriefingVM([completed, live], now);

    expect(plainText(vm)).toContain("alfred-live");
    expect(plainText(vm)).toContain("right now");
    expect(plainText(vm)).not.toContain("closed today");
    expect(plainText(vm)).not.toContain("alfred-done");
  });

  it("uses the quiet fallback when only stale runs are present", () => {
    const stale = {
      ...baseRun,
      id: "r-stale",
      status: "running",
      title: "long migration",
      started_at: localIso(2026, 3, 29, 6),
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 8),
      project_name: "alfred-web",
    };
    const vm = buildBriefingVM([stale], now);

    expect(plainText(vm)).toBe("Nothing has happened yet today. The cave is quiet.");
    expect(plainText(vm)).not.toContain("gone quiet");
  });

  it("lets completedToday beat stale runs", () => {
    const stale = {
      ...baseRun,
      id: "r-stale",
      status: "running",
      title: "long migration",
      started_at: localIso(2026, 3, 29, 6),
      completed_at: null,
      updated_at: localIso(2026, 3, 29, 8),
    };

    const vm = buildBriefingVM([stale, baseRun], now);

    expect(plainText(vm)).toMatch(/quiet morning/i);
    expect(plainText(vm)).toMatch(/1 session closed today/i);
    expect(plainText(vm)).not.toContain("long migration");
  });

  it("congratulates a quiet morning when only completions are present", () => {
    const vm = buildBriefingVM([baseRun], now);

    expect(vm.voice).toBe("morning");
    expect(plainText(vm)).toMatch(/quiet morning/i);
    expect(plainText(vm)).toMatch(/closed today/i);
  });

  it("counts a completed run as today when it started yesterday but completed today", () => {
    const completed = {
      ...baseRun,
      id: "r-cross-midnight-completed",
      status: "completed",
      started_at: localIso(2026, 3, 28, 23, 40),
      completed_at: localIso(2026, 3, 29, 0, 5),
      updated_at: localIso(2026, 3, 29, 0, 5),
    };
    const vm = buildBriefingVM([completed], now);

    expect(plainText(vm)).toMatch(/quiet morning/i);
    expect(plainText(vm)).toMatch(/1 session closed today/i);
  });

  it("does not count a completed run as closed today when only its update happened today", () => {
    const completed = {
      ...baseRun,
      id: "r-updated-after-close",
      status: "completed",
      started_at: localIso(2026, 3, 28, 22),
      completed_at: localIso(2026, 3, 28, 22, 30),
      updated_at: localIso(2026, 3, 29, 9),
      created_at: localIso(2026, 3, 28, 22),
    };
    const vm = buildBriefingVM([completed], now);

    expect(plainText(vm)).toBe("Nothing has happened yet today. The cave is quiet.");
    expect(plainText(vm)).not.toContain("closed today");
  });

  it("uses the final quiet fallback when every run is older than today", () => {
    const oldCompleted = {
      ...baseRun,
      id: "r-old-completed",
      started_at: localIso(2026, 3, 28, 7),
      completed_at: localIso(2026, 3, 28, 7, 30),
      updated_at: localIso(2026, 3, 28, 7, 30),
      created_at: localIso(2026, 3, 28, 7),
    };

    const vm = buildBriefingVM([oldCompleted], now);

    expect(plainText(vm)).toBe("Nothing has happened yet today. The cave is quiet.");
  });

  it("uses afternoon greeting after noon", () => {
    const afternoon = new Date(2026, 3, 29, 13);
    const vm = buildBriefingVM([baseRun], afternoon);
    expect(vm.voice).toBe("afternoon");
    expect(plainText(vm)).toMatch(/quiet afternoon/i);
  });

  it("uses evening greeting after 18:00", () => {
    const evening = new Date(2026, 3, 29, 18);
    const vm = buildBriefingVM([baseRun], evening);
    expect(vm.voice).toBe("evening");
    expect(plainText(vm)).toMatch(/quiet evening/i);
  });
});
