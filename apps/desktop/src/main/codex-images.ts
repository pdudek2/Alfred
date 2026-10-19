import { open } from "node:fs/promises";

/**
 * Codex shows a sent image as "[Image #1]" with no link, and numbers images again from #1 in every message.
 * Its rollout (the `transcript_path` its hooks send) records each sent message in order as an `item_completed`
 * UserMessage, just after the user message that carries the images' paths: `<image name=[Image #1] path="…">`.
 * Codex calls the format unstable, so anything unexpected finds nothing.
 */

/** A sent message by its text without whitespace, which is all the matching needs, and its images by placeholder. */
type SentMessage = { key: string; images: Record<string, string> };
type Rollout = {
  offset: number;
  rest: Buffer;
  messages: SentMessage[];
  /** The images of the user message waiting for its UserMessage record. */
  pending: SentMessage | null;
  reading: Promise<void>;
};

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
      if (size < rollout.offset) Object.assign(rollout, { offset: 0, rest: Buffer.alloc(0), messages: [], pending: null });
      while (rollout.offset < size) {
        const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - rollout.offset));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, rollout.offset);
        if (bytesRead === 0) break;
        rollout.offset += bytesRead;
        const bytes = Buffer.concat([rollout.rest, chunk.subarray(0, bytesRead)]);
        const lastNewline = bytes.lastIndexOf(0x0a);
        rollout.rest = Buffer.from(bytes.subarray(lastNewline + 1));
        for (const line of bytes.subarray(0, lastNewline + 1).toString("utf8").split("\n")) readRecord(rollout, line);
      }
    } finally {
      await handle.close();
    }
  }

  return {
    /**
     * The images of `visible[index]`, where `visible` is the run of sent messages the terminal shows, top to bottom.
     * None when the run does not fit the rollout, or fits in places that disagree.
     */
    async imagesFor(transcriptPath: string, visible: string[], index: number): Promise<Record<string, string>> {
      let rollout = rollouts.get(transcriptPath);
      if (!rollout) {
        rollout = { offset: 0, rest: Buffer.alloc(0), messages: [], pending: null, reading: Promise.resolve() };
        rollouts.set(transcriptPath, rollout);
        if (rollouts.size > MAX_ROLLOUTS) rollouts.delete(rollouts.keys().next().value!);
      }
      const current = rollout;
      current.reading = current.reading.then(() => readNew(transcriptPath, current)).catch(() => {});
      await current.reading;
      return imagesAt(current.messages, visible, index);
    },
  };
}

/**
 * A screenshot sent on its own is just "[Image #1]", so the text alone does not say which file it is. The messages
 * around it on screen do: the visible run sits somewhere in the sent messages, and every place it fits must agree.
 * ponytail: a run of identical messages stays ambiguous, and a message the terminal draws differently from what was
 * sent (such as Codex's "[Pasted Content N chars]") fits nowhere; the agent's reply under each message could anchor both.
 */
export function imagesAt(messages: SentMessage[], visible: string[], index: number): Record<string, string> {
  const run = visible.map(withoutWhitespace);
  let answer: Record<string, string> | null = null;
  for (let start = 0; start + run.length <= messages.length; start += 1) {
    if (!run.every((key, offset) => messages[start + offset]!.key === key)) continue;
    const images = messages[start + index]!.images;
    if (answer && !sameImages(answer, images)) return {};
    answer = images;
  }
  return answer ?? {};
}

/** Adds what one rollout line says about sent messages; other lines change nothing. */
export function readRecord(rollout: Pick<Rollout, "messages" | "pending">, line: string): void {
  if (!line.includes('"role":"user"') && !line.includes('"UserMessage"')) return;
  let record: { type?: unknown; payload?: { type?: unknown; role?: unknown; content?: unknown; item?: { type?: unknown; content?: unknown } } };
  try {
    record = JSON.parse(line) as typeof record;
  } catch {
    return;
  }
  const payload = record.payload;
  if (record.type === "response_item" && payload?.type === "message" && payload.role === "user" && Array.isArray(payload.content)) {
    rollout.pending = taggedMessage(payload.content as Array<{ type?: unknown; text?: unknown }>);
    return;
  }
  const item = payload?.item;
  if (record.type === "event_msg" && payload?.type === "item_completed" && item?.type === "UserMessage" && Array.isArray(item.content)) {
    const key = withoutWhitespace(
      (item.content as Array<{ type?: unknown; text?: unknown }>)
        .flatMap((part) => (part?.type === "text" && typeof part.text === "string" ? [part.text] : []))
        .join("\n"),
    );
    rollout.messages.push({ key, images: rollout.pending?.key === key ? rollout.pending.images : {} });
    rollout.pending = null;
  }
}

function taggedMessage(content: Array<{ type?: unknown; text?: unknown }>): SentMessage {
  const images: Record<string, string> = {};
  const text: string[] = [];
  for (const part of content) {
    if (part?.type !== "input_text" || typeof part.text !== "string") continue;
    const tag = IMAGE_TAG.exec(part.text);
    if (tag) images[tag[1]!] = tag[2]!;
    else if (part.text !== "</image>") text.push(part.text);
  }
  return { key: withoutWhitespace(text.join("\n")), images };
}

function sameImages(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

// The terminal wraps a long message wherever it likes, so only the characters count.
function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}
