import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { openNewSession } from "./support/work-layout";

// A page an agent wrote. Once every way out to the test's local listeners has settled it paints `colour`, or blue if
// any of them got through; then it tries to navigate itself to a listener.
const chartPage = (colour: string, port: number, udpPort: number) => `<!doctype html>
<script>
  const local = "http://127.0.0.1:${port}/";
  const failed = (promise) => promise.then(() => false, () => true);
  const loads = (tag, attribute) => new Promise((resolve) => {
    const element = document.createElement(tag);
    element.addEventListener("error", () => resolve(true), { once: true });
    element.addEventListener("load", () => resolve(false), { once: true });
    element.addEventListener("loadeddata", () => resolve(false), { once: true });
    element[attribute] = local + tag;
    document.documentElement.append(element);
    setTimeout(() => resolve(true), 2000);
  });
  const ice = new Promise((resolve) => {
    try {
      const connection = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }] });
      connection.createDataChannel("probe");
      connection.onicegatheringstatechange = () => connection.iceGatheringState === "complete" && resolve(true);
      connection.createOffer().then((offer) => connection.setLocalDescription(offer)).catch(() => resolve(true));
      setTimeout(() => resolve(true), 3000);
    } catch {
      resolve(true);
    }
  });
  alert("drawn");
  print();
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["x"])), download: "x.txt" });
  document.documentElement.append(link);
  link.click();
  const embed = document.createElement("embed");
  embed.src = local + "embed";
  document.documentElement.append(embed);
  Promise.all([
    failed(fetch(local + "fetch", { mode: "no-cors" })),
    failed(fetch("http://localhost:${port}/localhost", { mode: "no-cors" })),
    loads("img", "src"),
    loads("video", "src"),
    ice,
    Promise.resolve(typeof Notification === "undefined" ? "denied" : Notification.requestPermission()).then((answer) => answer !== "granted"),
  ]).then((results) => {
    document.documentElement.style.background = results.every(Boolean) ? ${JSON.stringify(colour)} : "rgb(0, 0, 255)";
    const refresh = Object.assign(document.createElement("meta"), { httpEquiv: "refresh", content: "0;url=" + local + "refresh" });
    document.head.append(refresh);
    location.href = local + "navigate";
  });
</script>`;

// A page that takes the keyboard whenever it can, then paints itself.
const focusPage = (colour: string) => `<!doctype html><input autofocus><script>
  focus();
  setTimeout(() => { focus(); document.querySelector("input").focus(); document.documentElement.style.background = ${JSON.stringify(colour)}; }, 300);
</script>`;

// A page whose script never ends.
const loopPage = `<!doctype html><script>while (true) {}</script>`;

test("shows a page an agent writes live beside its terminal, away from local services and the keyboard", async ({ harness }) => {
  const { app, page, paths } = harness;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);

  const hits: string[] = [];
  const localServer = http.createServer((request, response) => {
    hits.push(`http ${request.url}`);
    response.end("reached");
  });
  await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  const port = (localServer.address() as net.AddressInfo).port;
  const udp = dgram.createSocket("udp4");
  udp.on("message", () => hits.push("udp"));
  await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
  const udpPort = udp.address().port;
  await app.evaluate(({ session }) => {
    const counter = globalThis as { pageDownloads?: number };
    counter.pageDownloads = 0;
    session.defaultSession.on("will-download", () => { counter.pageDownloads! += 1; });
  });
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });

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
  const transcript = path.join(paths.root, "conversation.jsonl");
  const record = (result: Record<string, unknown>) => appendFile(transcript, `${JSON.stringify({ toolUseResult: result })}\n`);
  const writePage = async (name: string, text: string) => {
    const file = path.join(project, "out", name);
    await writeFile(file, text);
    await record({ type: "create", filePath: file, content: text, structuredPatch: [] });
    await hook("PostToolUse", { tool_name: "Write", tool_input: { file_path: file }, transcript_path: transcript });
  };
  const details = page.getByTestId("context-column");
  const panel = (name: string) => page.getByRole("region", { name: `Page ${name}`, exact: true });
  const anyPanel = page.locator(".page-panel");

  // A turn that changed only code shows no page.
  await writeFile(transcript, "");
  await record({ filePath: path.join(project, "src", "app.ts"), structuredPatch: [{ lines: ["-a", "+b"] }] });
  await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: path.join(project, "src", "app.ts") }, transcript_path: transcript });
  await expect(details.getByRole("region", { name: "Changed files" })).toContainText("app.ts");
  await expect(details.getByRole("region", { name: "Pages" })).toHaveCount(0);
  await expect(anyPanel).toHaveCount(0);
  // The user hides Details; closing the page panel later must still leave a way back to it.
  await page.keyboard.press("ControlOrMeta+i");
  await expect(details).toHaveClass(/closed/);

  // The agent writes a page and keeps working: the page opens beside the terminal and runs.
  await writePage("chart.html", chartPage("rgb(255, 0, 0)", port, udpPort));
  await expect(panel("chart.html")).toBeVisible();
  await expect(details).toHaveClass(/closed/);
  await expect.poll(() => pageColour(page, panel("chart.html"))).toBe("red");
  const panelBox = (await panel("chart.html").boundingBox())!;
  const terminalBox = (await tile.boundingBox())!;
  expect(panelBox.x).toBeGreaterThan(terminalBox.x + terminalBox.width - 1);
  expect(panelBox.width).toBeCloseTo(600, -1);

  // It edits the page; the panel shows the new version without a click.
  const chart = path.join(project, "out", "chart.html");
  await writeFile(chart, chartPage("rgb(0, 160, 0)", port, udpPort));
  await record({ filePath: chart, structuredPatch: [{ lines: ["-red", "+green"] }] });
  await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: chart }, transcript_path: transcript });
  await expect.poll(() => pageColour(page, panel("chart.html"))).toBe("green");

  // A page that grabs the keyboard on load does not keep it while the pointer is elsewhere.
  await tile.getByTestId("xterm-host").click();
  await writePage("focus.html", focusPage("rgb(0, 160, 0)"));
  await expect(panel("focus.html")).toBeVisible();
  await expect(panel("focus.html").getByRole("tab", { name: "focus.html" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => pageColour(page, panel("focus.html"))).toBe("green");
  await page.keyboard.type("kept");
  await expect(tile).toContainText("kept");
  // Nor while the user types somewhere else: the keyboard goes back to that field.
  await openNewSession(page);
  const draft = page.getByRole("form", { name: "New session", exact: true }).getByRole("textbox");
  await draft.click();
  const focus = path.join(project, "out", "focus.html");
  await writeFile(focus, focusPage("rgb(0, 0, 255)"));
  await record({ filePath: focus, structuredPatch: [{ lines: ["-green", "+blue"] }] });
  await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: focus }, transcript_path: transcript });
  await expect.poll(() => pageColour(page, panel("focus.html"))).toBe("blue");
  await page.keyboard.type("draft");
  await expect(draft).toHaveValue(/draft/);
  await page.keyboard.press("Escape");

  // Close brings Details back with the pages; a new page does not reopen the panel; a row does.
  await panel("focus.html").getByRole("button", { name: "Close page" }).click();
  await expect(anyPanel).toHaveCount(0);
  await expect(details).toHaveClass(/open/);
  const rows = details.getByRole("region", { name: "Pages" });
  await expect(rows.getByRole("button")).toHaveText(["focus.html", "chart.html"]);
  await record({ type: "create", filePath: path.join(project, "out", "gone.html"), content: "<p>gone</p>", structuredPatch: [] });
  await hook("PostToolUse", { tool_name: "Bash", tool_input: { command: "rm out/gone.html" }, transcript_path: transcript });
  await expect(rows.getByRole("button", { name: "gone.html" })).toBeVisible();
  await expect(anyPanel).toHaveCount(0);
  await rows.getByRole("button", { name: "chart.html" }).click();
  await expect(panel("chart.html")).toBeVisible();
  await expect(details).toHaveClass(/closed/);
  // An edit of another page moves the panel to it.
  await record({ filePath: focus, structuredPatch: [{ lines: ["+again"] }] });
  await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: focus }, transcript_path: transcript });
  await expect(panel("focus.html")).toBeVisible();
  // ⌘I swaps the panel for Details, with the keyboard in Alfred.
  await tile.getByTestId("xterm-host").click();
  await page.keyboard.press("ControlOrMeta+i");
  await expect(anyPanel).toHaveCount(0);
  await expect(details).toHaveClass(/open/);

  // A page that is gone keeps its name.
  await rows.getByRole("button", { name: "gone.html" }).click();
  await expect(panel("gone.html")).toContainText("This page is no longer there");
  // Details from the command palette swaps the panel for Details too.
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: /^Details/ }).click();
  await expect(anyPanel).toHaveCount(0);
  await expect(details).toHaveClass(/open/);

  // A page whose script never ends stalls only its own frame.
  await writePage("loop.html", loopPage);
  // The panel stays shut for a new page; its row opens it.
  await expect(anyPanel).toHaveCount(0);
  await rows.getByRole("button", { name: "loop.html" }).click();
  await expect(panel("loop.html")).toBeVisible();
  // Its frame answers nothing (Playwright's own calls into it would hang, so the main process asks).
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const frame = BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.frames.find((child) => child.origin === "null");
    if (!frame) return Promise.resolve("no frame");
    return Promise.race([frame.executeJavaScript("1").then(() => "answers"), new Promise((resolve) => setTimeout(() => resolve("stuck"), 1000))]);
  })).toBe("stuck");
  await tile.getByTestId("xterm-host").click();
  await page.keyboard.type("alive");
  await expect(tile).toContainText("alive");
  // Playwright's debugger waits on the stuck frame when it closes the app; Alfred alone quits past it.
  await panel("loop.html").getByRole("button", { name: "Close page" }).click();
  await expect(anyPanel).toHaveCount(0);

  expect(hits).toEqual([]);
  expect(dialogs).toBe(0);
  expect(await app.evaluate(() => (globalThis as { pageDownloads?: number }).pageDownloads)).toBe(0);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
  await new Promise((resolve) => localServer.close(resolve));
  udp.close();
});

/** The colour at the middle of a panel's page on screen, as one name: red, green, blue or other. */
async function pageColour(page: Page, panel: Locator): Promise<string> {
  const frame = panel.locator("iframe");
  if (!(await frame.isVisible())) return "none";
  const picture = (await frame.screenshot()).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const [red = 0, green = 0, blue = 0] = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    if (red > 200 && green < 70 && blue < 70) return "red";
    if (green > 120 && red < 70 && blue < 70) return "green";
    if (blue > 200 && red < 70 && green < 70) return "blue";
    return "other";
  }, picture);
}
