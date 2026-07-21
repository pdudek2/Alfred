import { describe, expect, it } from "vitest";
import type { TranscriptBlock, TranscriptPage } from "../shared/sessions-ipc";
import {
  appendTranscriptPage,
  createInitialSessionsViewState,
} from "./sessions-view-state";

function page(revision: string, start: number, count: number): TranscriptPage {
  return {
    sessionKey: "external-codex:test",
    blocks: Array.from({ length: count }, (_, index): TranscriptBlock => ({
      id: `block-${start + index}`,
      kind: "notice",
      text: `Block ${start + index}`,
    })),
    nextCursor: null,
    revision,
    partial: false,
  };
}

describe("SessionsViewState", () => {
  it("starts as window-lifetime navigation state without transcript content", () => {
    expect(createInitialSessionsViewState()).toEqual({
      query: "",
      selectedProjectId: "all",
      source: "all",
      timeRange: "any",
      pageIndex: 0,
      selectedSessionKey: null,
      navigatorScrollTop: 0,
      readerScrollTop: 0,
      focusTarget: "search",
      readerPages: [],
      readerMode: "conversation",
    });
  });

  it("retains at most 120 transcript blocks while appending pages", () => {
    let nextState = createInitialSessionsViewState();
    nextState = appendTranscriptPage(nextState, page("one", 0, 60));
    nextState = appendTranscriptPage(nextState, page("one", 60, 60));

    expect(nextState.readerPages.flatMap((item) => item.blocks)).toHaveLength(120);

    nextState = appendTranscriptPage(nextState, page("one", 120, 60));
    expect(nextState.readerPages.flatMap((item) => item.blocks)).toHaveLength(120);
    expect(nextState.readerPages[0]?.blocks[0]?.id).toBe("block-60");
  });

  it("drops pages from an older transcript revision before appending", () => {
    const initial = appendTranscriptPage(createInitialSessionsViewState(), page("old", 0, 40));
    const refreshed = appendTranscriptPage(initial, page("new", 40, 20));

    expect(refreshed.readerPages).toEqual([page("new", 40, 20)]);
  });
});
