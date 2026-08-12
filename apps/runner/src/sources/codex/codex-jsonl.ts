import { scanJsonlLines } from "../jsonl-file.js";

export async function readJsonlFile(
  path: string,
  onInvalidLine?: (lineNumber: number) => void,
): Promise<unknown[]> {
  const records: unknown[] = [];

  for await (const record of readJsonlRecords(path, onInvalidLine)) {
    records.push(record);
  }

  return records;
}

export async function* readJsonlRecords(
  path: string,
  onInvalidLine?: (lineNumber: number) => void,
): AsyncGenerator<unknown> {
  for await (const line of scanJsonlLines(path, onInvalidLine)) {
    if ("record" in line) {
      yield line.record;
    }
  }
}
