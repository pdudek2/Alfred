import { readFile } from "node:fs/promises";

export async function readJsonlFile(path: string): Promise<unknown[]> {
  const content = await readFile(path, "utf8");
  const records: unknown[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      records.push(JSON.parse(trimmed) as unknown);
    } catch {
      // Codex session files are an external format. A corrupt line should not stop the runner.
    }
  }

  return records;
}
