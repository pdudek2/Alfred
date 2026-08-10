import type { TranscriptPage } from "../shared/sessions-ipc";

export type SessionsViewState = {
  query: string;
  selectedProjectId: string;
  source: "all" | "managed" | "saved" | "external-codex";
  timeRange: "any" | "day" | "week" | "month";
  pageIndex: number;
  selectedSessionKey: string | null;
  navigatorScrollTop: number;
  readerScrollTop: number;
  readerMode: "conversation" | "raw";
  focusTarget: "search" | "results" | "reader";
  readerPages: TranscriptPage[];
};

export function createInitialSessionsViewState(): SessionsViewState {
  return {
    query: "",
    selectedProjectId: "all",
    source: "all",
    timeRange: "any",
    pageIndex: 0,
    selectedSessionKey: null,
    navigatorScrollTop: 0,
    readerScrollTop: 0,
    readerMode: "conversation",
    focusTarget: "search",
    readerPages: [],
  };
}

export function appendTranscriptPage(state: SessionsViewState, page: TranscriptPage): SessionsViewState {
  const pages = [...state.readerPages.filter((item) => item.revision === page.revision), page];
  while (pages.reduce((sum, item) => sum + item.blocks.length, 0) > 120) pages.shift();
  return { ...state, readerPages: pages };
}
