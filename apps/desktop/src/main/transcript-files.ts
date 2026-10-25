import { createReadStream } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

/** Reading the JSONL transcripts agents keep: finding them, their first lines, their last lines, one record. */
export type SessionFile = { path: string; updatedAt: number; size: number };

export async function findJsonlFiles(root: string): Promise<SessionFile[]> { const files: SessionFile[] = []; async function visit(dir: string): Promise<void> { let handle: Awaited<ReturnType<typeof opendir>>; try { handle = await opendir(dir); } catch { return; } for await (const entry of handle) { const entryPath = path.join(dir, entry.name); if (entry.isDirectory()) await visit(entryPath); else if (entry.isFile() && entry.name.endsWith(".jsonl")) try { const details = await stat(entryPath); files.push({ path: entryPath, updatedAt: details.mtimeMs, size: details.size }); } catch { /* File changed while Codex was writing it. */ } } } await visit(root); return files; }
export async function readTranscriptPrefixLines(filePath: string, maxLines: number): Promise<string[]> { const stream = createReadStream(filePath, { encoding: "utf8" }); const reader = createInterface({ input: stream, crlfDelay: Infinity }); const lines: string[] = []; try { for await (const line of reader) { lines.push(line); if (lines.length >= maxLines) { reader.close(); stream.destroy(); break; } } } finally { reader.close(); stream.destroy(); } return lines; }
export function parseJsonRecord(line: string): Record<string, unknown> | null { try { const value = JSON.parse(line) as unknown; return isRecord(value) ? value : null; } catch { return null; } }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }

/** The complete lines in the last `maxBytes` of a file, oldest first; the first, partial line is dropped. */
export async function readTranscriptTailLines(filePath: string, maxBytes: number): Promise<string[]> {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    return (length < size ? lines.slice(1) : lines).filter(Boolean);
  } finally {
    await handle.close();
  }
}
