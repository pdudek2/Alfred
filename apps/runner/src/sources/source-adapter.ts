import type { IngestEvent } from "@alfred/schema";

export type SourceCursorUpdate = { key: string; value: string };
export type SourceCollection = {
  events: IngestEvent[];
  cursorUpdates: SourceCursorUpdate[];
};

export type SourceAdapter = {
  sourceId: string;
  collect(): Promise<SourceCollection>;
};
