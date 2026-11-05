import { createReadStream } from "node:fs";
import path from "node:path";
import type { TerminalChangeStats, TerminalFileChange } from "../shared/terminal-ipc.js";
import { isRecord, parseJsonRecord } from "./transcript-files.js";

export type ChangeTally = TerminalChangeStats & {
  /** The same counts per file, in the order the files were first edited. */
  files: Map<string, TerminalChangeStats>;
  transcriptPath: string;
  offset: number;
  /** The folder of the latest record: Claude Code's cwd, which follows its `cd`, or a Codex turn's start folder. */
  cwd?: string;
  /** The folder of Codex's latest completed file change. */
  changedIn?: string;
};

/** Where the agent last worked. Claude's `gitBranch` lags behind its cwd, so only folders are read. */
export function workingFolder(tally: ChangeTally): string | undefined {
  return tally.changedIn ?? tally.cwd;
}

export function changedFiles(tally: ChangeTally): TerminalFileChange[] {
  return [...tally.files].map(([file, counts]) => ({ path: file, ...counts }));
}

/**
 * Adds the edits a transcript gained since `previous`, which is why a transcript of hundreds of megabytes costs one
 * full read. A different transcript starts over; a line still being written waits for the next read.
 */
export async function tallyTranscriptChanges(transcriptPath: string, previous?: ChangeTally): Promise<ChangeTally> {
  const tally: ChangeTally = previous?.transcriptPath === transcriptPath
    ? { ...previous, files: new Map([...previous.files].map(([file, counts]) => [file, { ...counts }])) }
    : { transcriptPath, offset: 0, additions: 0, deletions: 0, files: new Map() };
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(transcriptPath, { start: tally.offset }) as AsyncIterable<Buffer>) {
    const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    const end = data.lastIndexOf(0x0a) + 1;
    carry = data.subarray(end);
    if (end === 0) continue;
    tally.offset += end;
    const lines = data.toString("utf8", 0, end).split("\n");
    for (const line of lines) {
      if (line.includes("structuredPatch") || line.includes('"FileChange"')) addRecordedEdits(tally, parseJsonRecord(line));
    }
    // Parsing every line would cost a full JSON pass, so only a chunk's last records with a cwd are parsed.
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const cwd = lines[index]!.includes('"cwd":') ? recordFolder(parseJsonRecord(lines[index]!)) : undefined;
      if (cwd) {
        tally.cwd = cwd;
        break;
      }
    }
  }
  return tally;
}

function recordFolder(record: Record<string, unknown> | null): string | undefined {
  if (typeof record?.cwd === "string" && record.isSidechain !== true) return record.cwd;
  const payload = record?.type === "turn_context" || record?.type === "session_meta" ? record.payload : undefined;
  return isRecord(payload) && typeof payload.cwd === "string" ? payload.cwd : undefined;
}

function addRecordedEdits(tally: ChangeTally, record: Record<string, unknown> | null): void {
  const claudeEdit = record?.toolUseResult;
  if (isRecord(claudeEdit) && Array.isArray(claudeEdit.structuredPatch)) {
    const file = typeof claudeEdit.filePath === "string" ? claudeEdit.filePath : undefined;
    if (claudeEdit.type === "create") addLines(tally, file, lineCount(claudeEdit.content), 0);
    for (const hunk of claudeEdit.structuredPatch) {
      if (isRecord(hunk) && Array.isArray(hunk.lines)) addDiffLines(tally, file, hunk.lines);
    }
    return;
  }
  const event = isRecord(record?.payload) ? record.payload : undefined;
  const item = event?.type === "item_completed" && isRecord(event.item) ? event.item : undefined;
  if (item?.type !== "FileChange" || item.status !== "completed" || !isRecord(item.changes)) return;
  for (const [file, change] of Object.entries(item.changes)) {
    if (path.isAbsolute(file)) tally.changedIn = path.dirname(file);
    if (!isRecord(change)) continue;
    if (change.type === "add") addLines(tally, file, lineCount(change.content), 0);
    if (change.type === "delete") addLines(tally, file, 0, lineCount(change.content));
    if (change.type === "update" && typeof change.unified_diff === "string") addDiffLines(tally, file, change.unified_diff.split("\n"));
  }
}

function addDiffLines(tally: ChangeTally, file: string | undefined, lines: unknown[]): void {
  const added = lines.filter((line) => typeof line === "string" && line.startsWith("+")).length;
  const removed = lines.filter((line) => typeof line === "string" && line.startsWith("-")).length;
  addLines(tally, file, added, removed);
}

function addLines(tally: ChangeTally, file: string | undefined, additions: number, deletions: number): void {
  tally.additions += additions;
  tally.deletions += deletions;
  if (!file || additions + deletions === 0) return;
  const counts = tally.files.get(file) ?? { additions: 0, deletions: 0 };
  counts.additions += additions;
  counts.deletions += deletions;
  tally.files.set(file, counts);
}

function lineCount(content: unknown): number {
  if (typeof content !== "string" || !content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}
