import { mkdir, readdir, readFile, writeFile, appendFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { openNewSession } from "./support/work-layout";

// A page an agent wrote. It is painted `colour` only when it can reach neither the file next to it nor a local
// service, and blue when it can; it also tries a dialog, printing and a download, none of which may happen.
const chartPage = (colour: string, localService: string) => `<!doctype html>
<script>
  alert("drawn");
  print();
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["x"])), download: "x.txt" });
  document.documentElement.append(link);
  link.click();
  Promise.allSettled([fetch("secret.txt"), fetch(${JSON.stringify(localService)})]).then((results) => {
    document.documentElement.style.background = results.every((result) => result.status === "rejected") ? ${JSON.stringify(colour)} : "rgb(0, 0, 255)";
  });
</script>`;

test("draws the pages an agent writes in Details, away from local files and services", async ({ harness }, testInfo) => {
  const { app, page, paths } = harness;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);

  let localHits = 0;
  const localServer = http.createServer((_request, response) => {
    localHits += 1;
    response.end("reached");
  });
  await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  const localService = `http://127.0.0.1:${(localServer.address() as net.AddressInfo).port}/`;

  await openNewSession(page);
  const sheet = page.getByRole("form", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Claude/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(tile).toContainText("claude fixture ready");
  const files = await readdir(paths.root);
  const [socketPath, hookSessionId] = (await readFile(path.join(paths.root, files.find((name) => name.startsWith("alfred-claude-hook-"))!), "utf8"))
    .trim()
    .split("\n");
  const hook = (event: string, payload: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
    const message = JSON.stringify({ sessionId: hookSessionId, event, payload: JSON.stringify({ hook_event_name: event, ...payload }) });
    const socket = net.connect(socketPath!, () => socket.end(`${message}\n`));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });

  const project = path.join(paths.root, "pages-project");
  await mkdir(path.join(project, "out"), { recursive: true });
  const chart = path.join(project, "out", "chart.html");
  await writeFile(path.join(project, "out", "secret.txt"), "secret");
  const transcript = path.join(paths.root, "conversation.jsonl");
  const record = (result: Record<string, unknown>) => appendFile(transcript, `${JSON.stringify({ toolUseResult: result })}\n`);
  const details = page.getByRole("complementary", { name: "Details" });
  const pages = details.getByRole("region", { name: "Pages" });

  // A turn that changed only code shows no pages.
  await writeFile(transcript, "");
  await record({ filePath: path.join(project, "src", "app.ts"), structuredPatch: [{ lines: ["-a", "+b"] }] });
  await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: path.join(project, "src", "app.ts") }, transcript_path: transcript });
  await expect(details.getByRole("region", { name: "Changed files" })).toContainText("app.ts");
  await expect(pages).toHaveCount(0);

  // The agent writes a page and keeps working: the page shows before its turn ends.
  await writeFile(chart, chartPage("rgb(255, 0, 0)", localService));
  await record({ type: "create", filePath: chart, content: chartPage("", ""), structuredPatch: [] });
  await hook("PostToolUse", { tool_name: "Write", tool_input: { file_path: chart }, transcript_path: transcript });
  const card = pages.getByRole("button", { name: "chart.html" });
  await expect(card).toBeVisible();
  await expect.poll(() => centreColour(card)).toEqual("red");

  // It edits the page; at the turn's end the card shows the new version.
  await writeFile(chart, chartPage("rgb(0, 160, 0)", localService));
  await record({ filePath: chart, structuredPatch: [{ lines: ["-red", "+green"] }] });
  await hook("Stop", { last_assistant_message: "Drew the chart.", transcript_path: transcript });
  await expect.poll(() => centreColour(card)).toEqual("green");
  await page.screenshot({ path: testInfo.outputPath("details-pages-1440x900.png") });

  // A page that is gone keeps its name, without a picture.
  await record({ type: "create", filePath: path.join(project, "out", "gone.html"), content: "<p>gone</p>", structuredPatch: [] });
  await hook("PostToolUse", { tool_name: "Bash", tool_input: { command: "rm out/gone.html" }, transcript_path: transcript });
  const gone = pages.getByRole("button", { name: "gone.html" });
  await expect(gone).toBeVisible();
  await expect(pages.getByRole("listitem").first()).toContainText("gone.html");
  await expect(gone.locator("img")).toHaveCount(0);

  // A page that prints from a frame stops the process that draws it, which is not Alfred's.
  const frames = path.join(project, "out", "frames.html");
  await writeFile(frames, `<iframe></iframe><script>document.querySelector("iframe").contentWindow.print();</script>`);
  await record({ type: "create", filePath: frames, content: "<iframe>", structuredPatch: [] });
  await hook("PostToolUse", { tool_name: "Write", tool_input: { file_path: frames }, transcript_path: transcript });
  await expect(pages.getByRole("button", { name: "frames.html" })).toBeVisible();
  // Alfred kills the stuck process, and a new one draws the next page.
  const after = path.join(project, "out", "after.html");
  await writeFile(after, chartPage("rgb(255, 0, 0)", localService));
  await record({ type: "create", filePath: after, content: "<p>", structuredPatch: [] });
  await hook("PostToolUse", { tool_name: "Write", tool_input: { file_path: after }, transcript_path: transcript });
  await expect.poll(() => centreColour(pages.getByRole("button", { name: "after.html" }))).toEqual("red");
  await expect(pages.getByRole("button", { name: "frames.html" }).locator("img")).toHaveCount(0);

  expect(localHits).toBe(0);
  await expect.poll(() => readdir(path.join(paths.home, "Downloads")).catch(() => [])).toEqual([]);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
  await new Promise((resolve) => localServer.close(resolve));
});

/** The colour at the middle of a card's picture, as one name: red, green, blue or other. */
async function centreColour(card: Locator): Promise<string> {
  return card.locator("img").evaluate((image: HTMLImageElement) => {
    if (!image.complete || !image.naturalWidth) return "none";
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    // Colour management moves the channels a little off the page's values.
    const [red = 0, green = 0, blue = 0] = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    if (red > 200 && green < 70 && blue < 70) return "red";
    if (green > 120 && red < 70 && blue < 70) return "green";
    if (blue > 200 && red < 70 && green < 70) return "blue";
    return "other";
  }).catch(() => "none");
}
