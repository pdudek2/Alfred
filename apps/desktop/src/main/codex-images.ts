import { open } from "node:fs/promises";

/**
 * Codex shows a sent image as "[Image #1]" with no link, and numbers images again from #1 in every message.
 * Its rollout (the `transcript_path` its hooks send) records each sent message with the images' paths:
 * `<image name=[Image #1] path="…">`. Codex calls the format unstable, so anything unexpected finds nothing.
 */

type SentMessage = { text: string; images: Record<string, string> };
type Rollout = { offset: number; rest: Buffer; messages: SentMessage[]; reading: Promise<void> };

const IMAGE_TAG = /^<image name=(\[Image #\d+\]) path="(.*)">$/s;
const MAX_ROLLOUTS = 16;
const CHUNK_BYTES = 4 * 1024 * 1024;

export function createCodexImageIndex() {
  const rollouts = new Map<string, Rollout>();

  // Rollouts embed every image as base64 and grow while Codex works, so only the bytes added since the last read
  // are read, a chunk at a time, letting terminal output through between chunks.
  async function readNew(transcriptPath: string, rollout: Rollout): Promise<void> {
    const handle = await open(transcriptPath, "r");
    try {
      const { size } = await handle.stat();
      if (size < rollout.offset) Object.assign(rollout, { offset: 0, rest: Buffer.alloc(0), messages: [] });
      while (rollout.offset < size) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - rollout.offset));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, rollout.offset);
        if (bytesRead === 0) break;
        rollout.offset += bytesRead;
        const bytes = Buffer.concat([rollout.rest, chunk.subarray(0, bytesRead)]);
        const lastNewline = bytes.lastIndexOf(0x0a);
        rollout.rest = Buffer.from(bytes.subarray(lastNewline + 1));
        for (const line of bytes.subarray(0, lastNewline + 1).toString("utf8").split("\n")) {
          const message = sentMessageFrom(line);
          if (message) rollout.messages.push(message);
        }
      }
    } finally {
      await handle.close();
    }
  }

  return {
    /** The images of the one sent message whose text is `text`; none when no message or several match. */
    async imagesFor(transcriptPath: string, text: string): Promise<Record<string, string>> {
      let rollout = rollouts.get(transcriptPath);
      if (!rollout) {
        rollout = { offset: 0, rest: Buffer.alloc(0), messages: [], reading: Promise.resolve() };
        rollouts.set(transcriptPath, rollout);
        if (rollouts.size > MAX_ROLLOUTS) rollouts.delete(rollouts.keys().next().value!);
      }
      const current = rollout;
      current.reading = current.reading.then(() => readNew(transcriptPath, current)).catch(() => {});
      await current.reading;
      return imagesOfOnlyMatch(current.messages, text);
    },
  };
}

export function imagesOfOnlyMatch(messages: SentMessage[], text: string): Record<string, string> {
  const key = withoutWhitespace(text);
  const matches = messages.filter((message) => withoutWhitespace(message.text) === key);
  // A screenshot sent twice with the same words would otherwise show the wrong one; showing none is better.
  return matches.length === 1 ? matches[0]!.images : {};
}

/** A user message from one rollout line, when it carries images. */
export function sentMessageFrom(line: string): SentMessage | null {
  if (!line.includes("<image name=")) return null;
  try {
    const record = JSON.parse(line) as { type?: unknown; payload?: { type?: unknown; role?: unknown; content?: unknown } };
    const payload = record.payload;
    if (record.type !== "response_item" || payload?.type !== "message" || payload.role !== "user" || !Array.isArray(payload.content)) {
      return null;
    }
    const images: Record<string, string> = {};
    const text: string[] = [];
    for (const part of payload.content as Array<{ type?: unknown; text?: unknown }>) {
      if (part?.type !== "input_text" || typeof part.text !== "string") continue;
      const tag = IMAGE_TAG.exec(part.text);
      if (tag) images[tag[1]!] = tag[2]!;
      else if (part.text !== "</image>") text.push(part.text);
    }
    return Object.keys(images).length > 0 ? { text: text.join("\n"), images } : null;
  } catch {
    return null;
  }
}

// The terminal wraps a long message wherever it likes, so only the characters count.
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}
