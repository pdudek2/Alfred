import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export async function readJsonlFile(path: string): Promise<unknown[]> {
  const records: unknown[] = [];

  for await (const record of readJsonlRecords(path)) {
    records.push(record);
  }

  return records;
}

export async function* readJsonlRecords(path: string): AsyncGenerator<unknown> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        yield JSON.parse(trimmed) as unknown;
      } catch {
        // Codex session files are an external format. A corrupt line should not stop the runner.
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}
