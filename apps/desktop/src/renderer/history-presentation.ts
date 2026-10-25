import type { ExternalSessionSource, SessionSummary } from "../shared/sessions-ipc";
import type { SessionDisplayStatus, SessionStateKind } from "./session-status";
import { sessionAgeWords } from "./session-time";

/** A transcript Alfred did not run, named after the tool that ran it. */
export const EXTERNAL_SOURCE_LABELS: Record<ExternalSessionSource, string> = {
  "external-codex": "Codex CLI",
  "external-claude": "Claude Code",
};

/** Contract vocabulary for a session's kind. */
export function historyKindLabel(summary: Pick<SessionSummary, "kind" | "source">): string {
  if (summary.source !== "managed") return EXTERNAL_SOURCE_LABELS[summary.source];
  return summary.kind === "codex" ? "Codex" : summary.kind === "claude" ? "Claude" : "Terminal";
}

/** What the top bar shows after "History": the selected session and its state glyph. */
export type HistorySelection = { title: string; status: SessionDisplayStatus };

export type HistorySummarySentence = { before: string; where: string; after: string };

/**
 * The reader's lead sentence, as on the canvas: who worked where, and what became of the session.
 * `where` is returned apart so the reader can set it in a stronger color.
 */
export function historySummarySentence(
  summary: Pick<SessionSummary, "branch" | "kind" | "locationLabel" | "project" | "source" | "updatedAt">,
  state: SessionStateKind,
  now = Date.now(),
): HistorySummarySentence {
  const age = sessionAgeWords(summary.updatedAt, now);
  const ago = age ? `${age} ago` : "just now";
  if (summary.source !== "managed") {
    return {
      before: `${EXTERNAL_SOURCE_LABELS[summary.source]} session in `,
      where: summary.project.id ? summary.project.label : summary.locationLabel,
      after: `. Last active ${ago}.`,
    };
  }
  const kind = historyKindLabel(summary);
  const outcome = state === "asleep" ? (age ? `Asleep for ${age}.` : "Asleep.")
    : state === "done" ? `Ended ${ago}.`
    : state === "failed" ? `Failed ${ago}.`
    : state === "unavailable" ? "Unavailable."
    : "Live in the deck.";
  return {
    before: kind === "Terminal" ? "Terminal session in " : `${kind} worked in `,
    where: summary.branch ?? summary.project.label,
    after: `. ${outcome}`,
  };
}
