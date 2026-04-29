import type { RunListItem } from "./api-client";
import { buildRunCardVM, type RunCardVM } from "./run-view-model";

export type BriefingVoice = "morning" | "afternoon" | "evening" | "error" | "empty";

export type BriefingPiece =
  | { kind: "text"; value: string }
  | { kind: "highlight"; value: string; runId: string };

export type BriefingVM = {
  voice: BriefingVoice;
  pieces: BriefingPiece[];
};

export function buildBriefingVM(runs: RunListItem[], now: Date, error?: unknown): BriefingVM {
  if (error) {
    return text("error", "I can't reach the runner right now. Mind checking it?");
  }

  if (runs.length === 0) {
    return text("empty", "Quiet here. No agent has reported in yet.");
  }

  const cards = runs.map((run) => buildRunCardVM(run, now)).sort(compareCardUpdatedDesc);
  const voice = greetingVoice(now);

  const waiting = cards.find((card) => card.status === "waiting");
  if (waiting) {
    const elapsed = elapsedLabel(waiting.updatedAt || waiting.startedAt, now, "a moment");
    return compose(voice, [
      sourceLabel(waiting),
      txt(" is waiting on you for "),
      hi(waiting.intent, waiting.id),
      txt(" on "),
      hi(waiting.projectLabel, waiting.id),
      txt(". It's been "),
      hi(elapsed, waiting.id),
      txt("."),
    ]);
  }

  const failedToday = cards.filter((card) => card.status === "failed" && happenedToday(card, now, "activity"));
  if (failedToday.length > 0) {
    const failed = failedToday[0]!;
    return compose(voice, [
      hi(failed.projectLabel, failed.id),
      txt("'s "),
      hi(failed.intent, failed.id),
      txt(" stopped. I'd take a look before retrying."),
    ]);
  }

  const live = cards.find((card) => card.isLive);
  if (live) {
    const elapsed = elapsedLabel(live.startedAt || live.updatedAt, now, "just started");
    return compose(voice, [
      sourceLabel(live),
      txt(" is on "),
      hi(live.projectLabel, live.id),
      txt(" right now - "),
      hi(elapsed, live.id),
      txt(" in."),
    ]);
  }

  const closedToday = cards.filter((card) => card.isDone && happenedToday(card, now, "closed")).length;
  if (closedToday > 0) {
    return compose(voice, [
      txt(quietGreeting(voice)),
      txt(`. ${closedToday} ${closedToday === 1 ? "session" : "sessions"} closed today; nothing else needs you.`),
    ]);
  }

  return compose(voice, [txt("Nothing has happened yet today. The cave is quiet.")]);
}

function txt(value: string): BriefingPiece {
  return { kind: "text", value };
}

function hi(value: string, runId: string): BriefingPiece {
  return { kind: "highlight", value, runId };
}

function sourceLabel(card: RunCardVM): BriefingPiece {
  const source = card.sourceLabel.toLowerCase();
  if (source.includes("codex")) return txt("Codex");
  if (source.includes("claude")) return txt("Claude");
  return txt(card.sourceLabel);
}

function compose(voice: BriefingVoice, pieces: BriefingPiece[]): BriefingVM {
  return { voice, pieces };
}

function text(voice: BriefingVoice, value: string): BriefingVM {
  return { voice, pieces: [txt(value)] };
}

type TodayReferenceMode = "activity" | "closed";

function happenedToday(card: RunCardVM, now: Date, mode: TodayReferenceMode): boolean {
  const reference = todayReference(card, mode);
  if (!reference) return false;

  const referenceDate = new Date(reference);
  return (
    referenceDate.getFullYear() === now.getFullYear() &&
    referenceDate.getMonth() === now.getMonth() &&
    referenceDate.getDate() === now.getDate()
  );
}

function todayReference(card: RunCardVM, mode: TodayReferenceMode): string | null {
  if (mode === "closed") return card.completedAt || card.updatedAt || card.startedAt;
  return card.updatedAt || card.completedAt || card.startedAt;
}

function greetingVoice(now: Date): BriefingVoice {
  const hour = now.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function quietGreeting(voice: BriefingVoice): string {
  if (voice === "afternoon") return "Quiet afternoon";
  if (voice === "evening") return "Quiet evening";
  return "Quiet morning";
}

function compareCardUpdatedDesc(left: RunCardVM, right: RunCardVM): number {
  return timestampMs(right.updatedAt) - timestampMs(left.updatedAt) || left.id.localeCompare(right.id);
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function elapsedLabel(value: string | null, now: Date, fallback: string): string {
  if (!value) return fallback;

  const elapsedMs = now.getTime() - timestampMs(value);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return fallback;

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
