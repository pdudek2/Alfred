import type { ExternalSessionSource, TranscriptPage } from "../shared/sessions-ipc";

export type SessionsViewState = {
  query: string;
  selectedProjectId: string;
  /** The canvas tabs: All, From Alfred, then one per tool whose transcripts History reads. */
  source: "all" | "managed" | ExternalSessionSource;
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
  let trimmed = false;
  while (pages.reduce((sum, item) => sum + item.blocks.length, 0) > 120) {
    pages.shift();
    trimmed = true;
  }
  // The start is gone, so what the reader shows is incomplete.
  if (trimmed && pages[0]) pages[0] = { ...pages[0], partial: true };
  return { ...state, readerPages: pages };
}
