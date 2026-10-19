import { appendFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexImageIndex, sentMessageFrom } from "./codex-images.js";

// One sent message as Codex 0.163 writes it to its rollout.
function sentLine(text: string, images: string[]): string {
  const content = images.flatMap((image, index) => [
    { type: "input_text", text: `<image name=[Image #${index + 1}] path="${image}">` },
    { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=", detail: "high" },
    { type: "input_text", text: "</image>" },
  ]);
  content.push({ type: "input_text", text });
  return `${JSON.stringify({ timestamp: "2026-10-19T08:43:06.586Z", type: "response_item", payload: { type: "message", role: "user", content } })}\n`;
}

describe("Codex image index", () => {
  it("finds the images of the sent message the terminal shows", async () => {
    const rollout = path.join(mkdtempSync(path.join(tmpdir(), "alfred-codex-images-")), "rollout.jsonl");
    await writeFile(
      rollout,
      `${JSON.stringify({ type: "session_meta", payload: { id: "s" } })}\n`
        + sentLine("[Image #1] [Image #2] look", ["/shots/first one.png", "/shots/second.png"])
        + sentLine("[Image #1] look", ["/shots/third.png"])
        + sentLine("[Image #1] first line\nsecond line", ["/shots/fourth.png"]),
    );
    const index = createCodexImageIndex();

    // Every message numbers its images from #1, so the message decides which file [Image #1] is.
    expect(await index.imagesFor(rollout, "[Image #1] [Image #2] look")).toEqual({
      "[Image #1]": "/shots/first one.png",
      "[Image #2]": "/shots/second.png",
    });
    expect(await index.imagesFor(rollout, "[Image #1] look")).toEqual({ "[Image #1]": "/shots/third.png" });
    // The terminal breaks long and multi-line messages over indented rows.
    expect(await index.imagesFor(rollout, "[Image #1] first\n  line second line")).toEqual({ "[Image #1]": "/shots/fourth.png" });
    // A message that was not sent, such as a draft in Codex's composer.
    expect(await index.imagesFor(rollout, "[Image #1] not sent")).toEqual({});

    // Messages added later are read too, including one whose line was still being written.
    const later = sentLine("[Image #1] again", ["/shots/fifth.png"]);
    await appendFile(rollout, later.slice(0, 40));
    expect(await index.imagesFor(rollout, "[Image #1] again")).toEqual({});
    await appendFile(rollout, later.slice(40));
    expect(await index.imagesFor(rollout, "[Image #1] again")).toEqual({ "[Image #1]": "/shots/fifth.png" });

    // The same words sent twice with different screenshots: neither is shown rather than the wrong one.
    await appendFile(rollout, sentLine("[Image #1] look", ["/shots/sixth.png"]));
    expect(await index.imagesFor(rollout, "[Image #1] look")).toEqual({});
  });

  it("reads a message whose embedded screenshot is larger than one read", async () => {
    const rollout = path.join(mkdtempSync(path.join(tmpdir(), "alfred-codex-images-")), "rollout.jsonl");
    const large = sentLine("[Image #1] zażółć", ["/shots/large.png"]).replace("iVBORw0KGgo=", "A".repeat(9 * 1024 * 1024));
    await writeFile(rollout, large + sentLine("[Image #1] next", ["/shots/next.png"]));
    const index = createCodexImageIndex();

    expect(await index.imagesFor(rollout, "[Image #1] zażółć")).toEqual({ "[Image #1]": "/shots/large.png" });
    expect(await index.imagesFor(rollout, "[Image #1] next")).toEqual({ "[Image #1]": "/shots/next.png" });
  });

  it("finds nothing in a missing rollout or in lines it does not understand", async () => {
    expect(await createCodexImageIndex().imagesFor("/nonexistent/rollout.jsonl", "[Image #1]")).toEqual({});
    expect(sentMessageFrom("not json <image name=")).toBeNull();
    expect(sentMessageFrom(sentLine("plain", []))).toBeNull();
    const assistant = sentLine("[Image #1]", ["/a.png"]).replace('"role":"user"', '"role":"assistant"');
    expect(sentMessageFrom(assistant)).toBeNull();
  });
});
