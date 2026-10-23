import { readFile } from "node:fs/promises";
import type { ElectronApplication, ElementHandle, Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { resolveDesktopStateFilePath } from "../src/main/persisted-desktop-state";
import { expect, test } from "./support/electron-app";
import { neutralScreenshotPointer } from "./support/privacy-safe-screenshot";
import { sessionTree, surfaceButton, treeRow } from "./support/work-layout";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult>; rename(request: { clientId: string; title: string }): Promise<unknown> } };
};

test("starts workers from their parent's row and keeps them under the parent across a restart", async ({ harness }, testInfo) => {
  let { app, page } = harness;
  const { paths } = harness;
  await setWindowSize(app, page, 1440, 900);

  await startSession(page, /^Codex/);
  const parentRow = sessionTree(page).locator(".session-tree-row:has(.kind-codex)");
  await expect(parentRow).toHaveCount(1);
  const parentId = (await parentRow.getAttribute("data-session-id"))!;
  const parentTitle = (await parentRow.locator(".session-tree-title").textContent())!;
  // Codex workers join the tree below, so the parent is found by its id from here on.
  const parent = treeRow(page, parentId);

  // New worker sits on the parent's row and opens the usual sheet, which says whose worker it starts.
  await parent.hover();
  await page.getByRole("button", { name: `New worker for ${parentTitle}` }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await expect(sheet.getByText(`Worker of ${parentTitle}`)).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /^Plan with Alfred/ })).toHaveCount(0);
  await sheet.getByRole("radio", { name: /^Terminal/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  await expect(sheet).toHaveCount(0);

  const workers = page.getByRole("list", { name: `Workers of ${parentTitle}` });
  const workerRow = workers.locator(".session-tree-row").first();
  await expect(workers.locator(".session-tree-row")).toHaveCount(1);
  const workerId = (await workerRow.getAttribute("data-session-id"))!;
  await expect(workerRow).toHaveAccessibleDescription(`Worker of ${parentTitle}`);
  // An agent worker goes through the agent launch path and carries its parent the same way.
  await parent.hover();
  await page.getByRole("button", { name: `New worker for ${parentTitle}` }).click();
  await sheet.getByRole("radio", { name: /^Codex/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(workers.locator(".session-tree-row")).toHaveCount(2);
  const codexWorkerId = (await workers.locator(".session-tree-row:has(.kind-codex)").getAttribute("data-session-id"))!;
  await expect.poll(() => page.evaluate(async (id) => {
    const listed = await (window as DesktopTerminalWindow).alfredDesktop!.terminal.list();
    return listed.sessions.find((session) => session.clientId === id)?.parentClientId;
  }, codexWorkerId)).toBe(parentId);

  const parentIcon = await parent.locator(".session-tree-kind").boundingBox();
  const workerIcon = await workerRow.locator(".session-tree-kind").boundingBox();
  expect(workerIcon!.x - parentIcon!.x).toBe(22);

  // Over the native window material too, the project row above its tree has no fill; the focused session has it.
  const projectRow = page.getByTestId("project-navigator").locator(".project-row.has-tree");
  await expect(page.locator("html")).toHaveAttribute("data-alfred-window-material", "native");
  await expect(projectRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  // The rail keeps its width at both window sizes; the right column is Details, with no Sessions tab left.
  await expect(page.getByTestId("project-navigator")).toHaveCSS("width", "264px");
  await expect(page.getByRole("tab", { name: "Sessions" })).toHaveCount(0);
  const details = page.getByTestId("context-column");
  await expect(details).toHaveClass(/(^| )open( |$)/);
  await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
  await page.screenshot({ path: testInfo.outputPath("rail-tree-1440x900.png") });
  await setWindowSize(app, page, 1120, 720);
  await expect(page.getByTestId("project-navigator")).toHaveCSS("width", "264px");
  await page.screenshot({ path: testInfo.outputPath("rail-tree-1120x720.png") });
  await setWindowSize(app, page, 1440, 900);

  // ⌘I hides and shows Details; the column is not a drawer, so Escape leaves it alone.
  await page.keyboard.press("ControlOrMeta+i");
  await expect(details).toHaveClass(/(^| )closed( |$)/);
  await page.keyboard.press("ControlOrMeta+i");
  await expect(details).toHaveClass(/(^| )open( |$)/);
  await page.getByTestId("project-navigator").getByRole("button", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(details).toHaveClass(/(^| )open( |$)/);

  // Picking a row moves the focus without remounting either terminal.
  const hosts = await captureHosts(page);
  await treeRow(page, parentId).click();
  await expect(page.locator(`[data-testid="terminal-tile"][data-session-id="${parentId}"]`)).not.toHaveAttribute("aria-hidden", "true");
  await treeRow(page, workerId).click();
  await expect(page.locator(`[data-testid="terminal-tile"][data-session-id="${workerId}"]`)).not.toHaveAttribute("aria-hidden", "true");
  await expect(treeRow(page, workerId)).toHaveAttribute("aria-current", "true");
  for (const host of hosts) expect(await host.evaluate((node) => node.isConnected)).toBe(true);

  // The link is saved with the session, and a reloaded window hangs the worker under its parent again.
  const stateFile = resolveDesktopStateFilePath({ userDataPath: paths.userData });
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { restoredTerminalSessions?: { clientId: string; parentClientId?: string }[] };
    return saved.restoredTerminalSessions?.find((session) => session.clientId === workerId)?.parentClientId;
  }).toBe(parentId);
  await page.reload();
  await expect(page.getByRole("list", { name: `Workers of ${parentTitle}` }).locator(`[data-session-id="${workerId}"]`)).toBeVisible();

  // After a restart the sessions come back asleep with their link; resumed, the workers hang under the parent again.
  // Unique names tell the asleep sessions apart in History, where generated titles lose their numbers.
  const names: Record<string, string> = { [parentId]: "Lead agent", [workerId]: "Shell worker", [codexWorkerId]: "Codex worker" };
  await page.evaluate(async (entries) => {
    for (const [clientId, title] of entries) await (window as DesktopTerminalWindow).alfredDesktop!.terminal.rename({ clientId, title });
  }, Object.entries(names));
  await expect.poll(async () => {
    const saved = JSON.parse(await readFile(stateFile, "utf8")) as { restoredTerminalSessions?: { clientId: string; title: string }[] };
    return Object.keys(names).every((id) => saved.restoredTerminalSessions?.find((session) => session.clientId === id)?.title === names[id]);
  }).toBe(true);
  ({ app, page } = await harness.restart());
  await setWindowSize(app, page, 1440, 900);
  await page.getByRole("region", { name: "Asleep sessions" }).locator(`li[data-session-id="${parentId}"]`).getByRole("button").click();
  await expect(treeRow(page, parentId)).toBeVisible();
  // The empty project's list goes once something runs, so the workers are resumed from History.
  for (const id of [workerId, codexWorkerId]) {
    await surfaceButton(page, "History").click();
    const history = page.getByRole("region", { name: "History" });
    await history.getByRole("option", { name: new RegExp(names[id]!) }).click();
    await history.getByRole("button", { name: /^(Resume|Restart)/ }).first().click();
    if (await page.getByTestId("desk-runtime-surface").isHidden()) await surfaceButton(page, "Work").click();
    await expect(treeRow(page, id)).toBeVisible();
  }
  const restoredWorkers = sessionTree(page).getByRole("list", { name: "Workers of Lead agent" });
  await expect(restoredWorkers.locator(`.session-tree-row[data-session-id="${workerId}"]`)).toBeVisible();
  await expect(restoredWorkers.locator(`.session-tree-row[data-session-id="${codexWorkerId}"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("rail-tree-after-restart.png") });
});

async function startSession(page: Page, kind: RegExp): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: kind }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function captureHosts(page: Page): Promise<ElementHandle<HTMLElement>[]> {
  const hosts = page.getByTestId("xterm-host");
  const count = await hosts.count();
  const handles: ElementHandle<HTMLElement>[] = [];
  for (let index = 0; index < count; index += 1) {
    handles.push((await hosts.nth(index).elementHandle()) as ElementHandle<HTMLElement>);
  }
  return handles;
}

async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
}
