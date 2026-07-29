import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

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
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        yield JSON.parse(trimmed) as unknown;
      } catch {
        onInvalidLine?.(lineNumber);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}
