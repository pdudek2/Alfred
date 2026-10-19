import { appendFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexImageIndex, readRecord } from "./codex-images.js";

// One sent message as Codex 0.163 writes it to its rollout: the user message with its images, then its UserMessage.
function sentLines(text: string, images: string[] = []): string {
  const content = images.flatMap((image, index) => [
    { type: "input_text", text: `<image name=[Image #${index + 1}] path="${image}">` },
    { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "high" },
    { type: "input_text", text: "</image>" },
  ]);
  content.push({ type: "input_text", text });
  const sent = { type: "response_item", payload: { type: "message", role: "user", content } };
  const item = {
    type: "UserMessage",
    content: [...images.map((image) => ({ type: "local_image", path: image })), { type: "text", text, text_elements: [] }],
  };
  return `${JSON.stringify(sent)}\n${JSON.stringify({ type: "event_msg", payload: { type: "item_completed", item } })}\n`;
}

function rolloutPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "alfred-codex-images-")), "rollout.jsonl");
}

describe("Codex image index", () => {
  it("finds the images of the sent message the terminal shows", async () => {
    const rollout = rolloutPath();
    // Codex also writes context it adds itself as user messages; only what was sent counts.
    const context = { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>" }] } };
    await writeFile(
      rollout,
      `${JSON.stringify(context)}\n`
        + sentLines("[Image #1] [Image #2] look", ["/shots/first one.png", "/shots/second.png"])
        + sentLines("[Image #1] look", ["/shots/third.png"])
        + sentLines("[Image #1] first line\nsecond line", ["/shots/fourth.png"]),
    );
    const index = createCodexImageIndex();

    // Every message numbers its images from #1, so the message decides which file [Image #1] is.
    expect(await index.imagesFor(rollout, ["[Image #1] [Image #2] look"], 0)).toEqual({
      "[Image #1]": "/shots/first one.png",
      "[Image #2]": "/shots/second.png",
    });
    expect(await index.imagesFor(rollout, ["[Image #1] look"], 0)).toEqual({ "[Image #1]": "/shots/third.png" });
    // The terminal breaks long and multi-line messages over indented rows.
    expect(await index.imagesFor(rollout, ["[Image #1] first\n  line second line"], 0)).toEqual({ "[Image #1]": "/shots/fourth.png" });
    // A message that was not sent, or a run of messages that is not how they were sent.
    expect(await index.imagesFor(rollout, ["[Image #1] not sent"], 0)).toEqual({});
    expect(await index.imagesFor(rollout, ["[Image #1] look", "[Image #1] [Image #2] look"], 0)).toEqual({});

    // Messages added later are read too, including one whose line was still being written.
    const later = sentLines("[Image #1] again", ["/shots/fifth.png"]);
    await appendFile(rollout, later.slice(0, 40));
    expect(await index.imagesFor(rollout, ["[Image #1] again"], 0)).toEqual({});
    await appendFile(rollout, later.slice(40));
    expect(await index.imagesFor(rollout, ["[Image #1] again"], 0)).toEqual({ "[Image #1]": "/shots/fifth.png" });
  });

  it("tells screenshots sent on their own apart by the messages around them", async () => {
    const rollout = rolloutPath();
    await writeFile(
      rollout,
      sentLines("[Image #1]", ["/shots/a.png"])
        + sentLines("kontynuuj")
        + sentLines("[Image #1]", ["/shots/b.png"])
        + sentLines("[Image #1]", ["/shots/c.png"]),
    );
    const index = createCodexImageIndex();

    expect(await index.imagesFor(rollout, ["kontynuuj", "[Image #1]", "[Image #1]"], 1)).toEqual({ "[Image #1]": "/shots/b.png" });
    expect(await index.imagesFor(rollout, ["kontynuuj", "[Image #1]", "[Image #1]"], 2)).toEqual({ "[Image #1]": "/shots/c.png" });
    // Scrolled up: the first screenshot and the message after it.
    expect(await index.imagesFor(rollout, ["[Image #1]", "kontynuuj"], 0)).toEqual({ "[Image #1]": "/shots/a.png" });
    // Two screenshots alone on screen fit after "kontynuuj" only, so they are pinned too.
    expect(await index.imagesFor(rollout, ["[Image #1]", "[Image #1]"], 0)).toEqual({ "[Image #1]": "/shots/b.png" });
    // One screenshot alone fits three places with three files: no picture rather than a wrong one.
    expect(await index.imagesFor(rollout, ["[Image #1]"], 0)).toEqual({});
  });

  it("reads a message whose embedded screenshot is larger than one read", async () => {
    const rollout = rolloutPath();
    const large = sentLines("[Image #1] zażółć", ["/shots/large.png"]).replace("iVBORw0KGgo=", "A".repeat(9 * 1024 * 1024));
    await writeFile(rollout, large + sentLines("[Image #1] next", ["/shots/next.png"]));
    const index = createCodexImageIndex();

    expect(await index.imagesFor(rollout, ["[Image #1] zażółć"], 0)).toEqual({ "[Image #1]": "/shots/large.png" });
    expect(await index.imagesFor(rollout, ["[Image #1] next"], 0)).toEqual({ "[Image #1]": "/shots/next.png" });
  });

  it("finds nothing in a missing rollout or in lines it does not understand", async () => {
    expect(await createCodexImageIndex().imagesFor("/nonexistent/rollout.jsonl", ["[Image #1]"], 0)).toEqual({});
    const state = { messages: [], pending: null };
    readRecord(state, 'not json "role":"user"');
    readRecord(state, sentLines("[Image #1]", ["/a.png"]).split("\n")[0]!.replace('"role":"user"', '"role":"assistant"'));
    expect(state).toEqual({ messages: [], pending: null });
    // Without its UserMessage record a user message is not counted as sent.
    readRecord(state, sentLines("[Image #1]", ["/a.png"]).split("\n")[0]!);
    expect(state.messages).toEqual([]);
    // A UserMessage whose text differs from the images' message gets no images.
    const [, item] = sentLines("[Image #1] other", ["/b.png"]).split("\n");
    readRecord(state, sentLines("[Image #1]", ["/a.png"]).split("\n")[0]!);
    readRecord(state, item!);
    expect(state.messages).toEqual([{ key: "[Image#1]other", images: {} }]);
  });
});
