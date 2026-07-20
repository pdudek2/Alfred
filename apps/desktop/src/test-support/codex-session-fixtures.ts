import { mkdir, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_DATE = ["2026", "07", "20"] as const;
const FIXTURE_MTIME = Date.parse("2026-07-20T12:00:00.000Z");

export type MixedCodexSessionFixture = {
  id: string;
  title: string;
  cwd: string;
  malformed: boolean;
  transcriptBlocks: number;
};

export async function writeMixedCodexSessionFixtures(
  codexHome: string,
  options: { workspaceA: string; workspaceB: string; freeChatRoot: string },
): Promise<MixedCodexSessionFixture[]> {
  const sessionDir = await ensureSessionDirectory(codexHome);
  const fixtures = Array.from({ length: 12 }, (_, index): MixedCodexSessionFixture => {
    const number = index + 1;
    const suffix = String(number).padStart(2, "0");
    const freeChat = number % 4 === 0;
    return {
      id: `fixture-session-${suffix}`,
      title: number === 1
        ? "Mapped resumable session 01"
        : number === 2
          ? "Long transcript session 02"
          : freeChat
            ? `Free chat session ${suffix}`
            : `Mapped project session ${suffix}`,
      cwd: freeChat
        ? path.join(options.freeChatRoot, `free-chat-${suffix}`)
        : number % 2 === 0
          ? options.workspaceB
          : options.workspaceA,
      malformed: number === 1,
      transcriptBlocks: number === 2 ? 135 : 2,
    };
  });

  for (const [index, fixture] of fixtures.entries()) {
    const records: string[] = [sessionMeta(fixture.id, fixture.cwd)];
    if (fixture.transcriptBlocks === 2) {
      records.push(messageRecord("user", fixture.title));
      if (fixture.malformed) records.push("{ partial fixture record");
      records.push(messageRecord("assistant", `Deterministic answer for ${fixture.title}.`));
    } else {
      records.push(messageRecord("user", fixture.title));
      for (let block = 1; block < fixture.transcriptBlocks; block += 1) {
        records.push(messageRecord("assistant", `Long transcript block ${String(block).padStart(3, "0")}.`));
      }
    }
    const file = path.join(sessionDir, `rollout-${fixture.id}.jsonl`);
    await writeFile(file, records.join("\n"), "utf8");
    const updatedAt = new Date(FIXTURE_MTIME - index * 60_000);
    await utimes(file, updatedAt, updatedAt);
  }
  return fixtures;
}

export async function writeCodexSummaryFixtures(
  codexHome: string,
  count: number,
  cwd = "/fixture/project",
): Promise<void> {
  if (!Number.isInteger(count) || count < 0) throw new Error("Summary fixture count must be a non-negative integer.");
  const sessionDir = await ensureSessionDirectory(codexHome);
  const batchSize = 100;
  for (let offset = 0; offset < count; offset += batchSize) {
    await Promise.all(Array.from({ length: Math.min(batchSize, count - offset) }, async (_, batchIndex) => {
      const index = offset + batchIndex;
      const suffix = String(index).padStart(5, "0");
      const id = `summary-fixture-${suffix}`;
      await writeFile(
        path.join(sessionDir, `summary-${suffix}.jsonl`),
        sessionMeta(id, cwd),
        "utf8",
      );
    }));
  }
}

export async function writeLargeCodexTranscriptFixture(
  codexHome: string,
): Promise<{ file: string; lineCount: 100_000; size: number }> {
  const sessionDir = await ensureSessionDirectory(codexHome);
  const file = path.join(sessionDir, "resource-100k-lines.jsonl");
  const fixedRecord = messageRecord(
    "assistant",
    "Deterministic resource transcript payload repeated for streaming evidence.",
  );
  const lines = [
    sessionMeta("resource-100k-lines", "/fixture/project"),
    ...Array.from({ length: 99_999 }, () => fixedRecord),
  ];
  await writeFile(file, lines.join("\n"), "utf8");
  const size = (await stat(file)).size;
  return { file, lineCount: 100_000, size };
}

async function ensureSessionDirectory(codexHome: string): Promise<string> {
  const sessionDir = path.join(codexHome, "sessions", ...SESSION_DATE);
  await mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

function sessionMeta(id: string, cwd: string): string {
  return JSON.stringify({
    timestamp: "2026-07-20T10:00:00.000Z",
    type: "session_meta",
    payload: {
      id,
      cwd,
      timestamp: "2026-07-20T09:59:00.000Z",
      model: "gpt-5.5",
      originator: "Codex Desktop fixture",
    },
  });
}

function messageRecord(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }],
    },
  });
}
