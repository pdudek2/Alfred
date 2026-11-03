import { createReadStream } from "node:fs";
import path from "node:path";
import type { TerminalChangeStats } from "../shared/terminal-ipc.js";
import { isRecord, parseJsonRecord } from "./transcript-files.js";

export type ChangeTally = TerminalChangeStats & {
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

/**
 * Adds the edits a transcript gained since `previous`, which is why a transcript of hundreds of megabytes costs one
 * full read. A different transcript starts over; a line still being written waits for the next read.
 */
export async function tallyTranscriptChanges(transcriptPath: string, previous?: ChangeTally): Promise<ChangeTally> {
  const tally = previous?.transcriptPath === transcriptPath
    ? { ...previous }
    : { transcriptPath, offset: 0, additions: 0, deletions: 0 };
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
    if (claudeEdit.type === "create") tally.additions += lineCount(claudeEdit.content);
    for (const hunk of claudeEdit.structuredPatch) {
      if (isRecord(hunk) && Array.isArray(hunk.lines)) addDiffLines(tally, hunk.lines);
    }
    return;
  }
  const event = isRecord(record?.payload) ? record.payload : undefined;
  const item = event?.type === "item_completed" && isRecord(event.item) ? event.item : undefined;
  if (item?.type !== "FileChange" || item.status !== "completed" || !isRecord(item.changes)) return;
  for (const [file, change] of Object.entries(item.changes)) {
    if (path.isAbsolute(file)) tally.changedIn = path.dirname(file);
    if (!isRecord(change)) continue;
    if (change.type === "add") tally.additions += lineCount(change.content);
    if (change.type === "delete") tally.deletions += lineCount(change.content);
    if (change.type === "update" && typeof change.unified_diff === "string") addDiffLines(tally, change.unified_diff.split("\n"));
  }
}

function addDiffLines(tally: ChangeTally, lines: unknown[]): void {
  for (const line of lines) {
    if (typeof line !== "string") continue;
    if (line.startsWith("+")) tally.additions += 1;
    if (line.startsWith("-")) tally.deletions += 1;
  }
}

function lineCount(content: unknown): number {
  if (typeof content !== "string" || !content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}
