import type { IngestEvent } from "@alfred/schema";

export type SourceAdapter = {
  sourceId: string;
  collect(): Promise<IngestEvent[]>;
};
