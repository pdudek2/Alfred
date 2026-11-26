import { writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { ElementHandle, Locator, Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";
import { openNewSession, treeRow } from "./support/work-layout";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test("keeps a shell's terminal mounted through Command B, tab switches and a typed agent's trip to the deck", async ({ harness }) => {
  const { page } = harness;
  const grid = page.getByTestId("terminal-grid");
  const shell = page.locator('.terminal-tile[data-session-id="manual-1"]');
  // A project with no agent: the empty deck above the drawer, which holds the first shell.
  await expect(shell).toHaveClass(/in-drawer/);
  await expect(page.getByRole("status", { name: "Empty project" })).toContainText("No agent is running");
  await expect(treeRow(page, "manual-1")).toHaveCount(0);
  const shellHost = await handle(shell.locator(".xterm-host"));
  await expect(shell.locator(".xterm-rows > div").filter({ hasText: /%\s*$/ }).first()).toBeVisible();

  // Command B from inside the terminal hides and shows the drawer, and the shell never receives it.
  await shell.locator(".xterm-host").click();
  await page.keyboard.type("cat -v");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+KeyB");
  await expect(grid).not.toHaveClass(/has-drawer/);
  await expect(shell).toHaveClass(/focus-hidden/);
  await page.keyboard.press("Meta+KeyB");
  await expect(grid).toHaveClass(/has-drawer/);
  await expect(shell.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
  await page.keyboard.type("after-toggle");
  await page.keyboard.press("Enter");
  await expect.poll(() => terminalBuffer(page, "manual-1")).toMatch(/after-toggle\r?\n.*after-toggle/s);
  expect(await terminalBuffer(page, "manual-1")).not.toMatch(/\^|bafter-toggle/);
  await page.keyboard.press("Control+C");
  await expectSameNode(shellHost, shell.locator(".xterm-host"));

  // + starts a second shell on its own tab; the tabs switch which shell shows, without remounting either.
  await page.getByRole("button", { name: "New shell" }).click();
  const second = page.locator('.terminal-tile[data-session-id="manual-2"]');
  await expect(second).toHaveClass(/in-drawer/);
  await expect(shell).toHaveClass(/focus-hidden/);
  await expect(page.getByRole("tab").and(page.locator('[data-session-id="manual-2"]'))).toHaveAttribute("aria-selected", "true");
  const secondHost = await handle(second.locator(".xterm-host"));
  await page.getByRole("tab").and(page.locator('[data-session-id="manual-1"]')).click();
  await expect(shell).toHaveClass(/in-drawer/);
  await expect(second).toHaveClass(/focus-hidden/);
  await expectSameNode(shellHost, shell.locator(".xterm-host"));
  await expectSameNode(secondHost, second.locator(".xterm-host"));

  // claude typed in the shell takes the deck and the rail tree while it runs, and goes back at the prompt.
  await expect(shell.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
  await page.keyboard.type("claude");
  await page.keyboard.press("Enter");
  await expect(shell).not.toHaveClass(/in-drawer/);
  await expect(shell).not.toHaveClass(/focus-hidden/);
  await expect(treeRow(page, "manual-1")).toBeVisible();
  await expect(second).toHaveClass(/in-drawer/);
  await expectSameNode(shellHost, shell.locator(".xterm-host"));
  await shell.getByRole("textbox", { name: "Terminal input" }).press("Control+C");
  await expect(shell).toHaveClass(/in-drawer/);
  await expect(treeRow(page, "manual-1")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Empty project" })).toBeVisible();
  await expectSameNode(shellHost, shell.locator(".xterm-host"));
  await expectSameNode(secondHost, second.locator(".xterm-host"));
});

test("starts a New session terminal in the drawer and leaves the agent focused on the deck", async ({ harness }) => {
  const { page } = harness;
  await openNewSession(page);
  await page.getByRole("radio", { name: /^Claude/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const agent = page.locator('[data-testid="terminal-tile"][data-session-id="claude-1"]');
  await expect(agent).not.toHaveClass(/focus-hidden/);
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText("Claude");
  const agentRows = agent.locator(".xterm-rows > div");
  await expect(agentRows.first()).toBeVisible();

  await openNewSession(page);
  await page.getByRole("radio", { name: /^Terminal/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  const shell = page.locator('.terminal-tile[data-session-id="manual-2"]');
  await expect(shell).toHaveClass(/in-drawer/);
  await expect(page.getByRole("tab").and(page.locator('[data-session-id="manual-2"]'))).toHaveAttribute("aria-selected", "true");
  await expect(agent).not.toHaveClass(/focus-hidden/);
  await expect(breadcrumb).toContainText("Claude");

  // Typing in the drawer leaves the deck's focus, the breadcrumb and Details on the agent.
  await shell.locator(".xterm-host").click();
  await page.keyboard.type("echo drawer-input");
  await page.keyboard.press("Enter");
  await expect.poll(() => terminalBuffer(page, "manual-2")).toContain("drawer-input");
  await expect(breadcrumb).toContainText("Claude");
  await expect(treeRow(page, "claude-1")).toHaveAttribute("aria-current", "true");

  // Hiding the drawer gives its rows to the agent's terminal, which fits once to the new size.
  const rowsWithDrawer = await agentRows.count();
  await page.keyboard.press("Meta+KeyB");
  await expect(shell).toHaveClass(/focus-hidden/);
  await expect.poll(() => agentRows.count()).toBeGreaterThan(rowsWithDrawer);
  await expect(agent.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
});

test("shows Preview and an opened file above the drawer in a project with no agent", async ({ harness }) => {
  const { page, paths } = harness;
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Drawer Preview Fixture</title><main>Drawer preview ready</main>");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const image = path.join(paths.workspaceA, "drawer-shot.png");
    await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const shell = page.locator('.terminal-tile[data-session-id="manual-1"]');
    const rows = shell.locator(".xterm-rows > div");
    await expect(rows.filter({ hasText: /%\s*$/ }).first()).toBeVisible();
    await shell.locator(".xterm-host").click();
    await page.keyboard.type(`printf 'Ready at ${url}\\n%s\\n' ${image}`);
    await page.keyboard.press("Enter");

    const drawerHead = page.getByRole("group", { name: "Shell drawer" });
    await page.getByRole("tab", { name: "Preview" }).click();
    const preview = page.locator(".terminal-deck-pane").getByLabel("Project preview");
    await expect(preview).toBeVisible();
    await expect(page.frameLocator(`iframe[title="Preview of ${url}"]`).getByText("Drawer preview ready")).toBeVisible();
    await expect(page.getByRole("form", { name: "New session", exact: true })).toHaveCount(0);
    await expectAbove(preview, drawerHead);
    await expect(shell).toHaveClass(/in-drawer/);

    // ⌘-click on the path the shell printed opens the file in the same place, in front of Preview.
    const row = rows.filter({ hasText: new RegExp(`^${image.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
    await commandClick(row, page);
    const file = page.locator(".terminal-deck-pane").getByRole("region", { name: "File drawer-shot.png" });
    await expect(file).toBeVisible();
    await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "false");
    await expectAbove(file, drawerHead);
    await expect(page.getByRole("complementary", { name: "Details" })).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function expectAbove(upper: Locator, lower: Locator): Promise<void> {
  const [upperBox, lowerBox] = [await upper.boundingBox(), await lower.boundingBox()];
  expect(upperBox && lowerBox && upperBox.y + upperBox.height <= lowerBox.y + 1).toBe(true);
}

async function commandClick(row: Locator, page: Page): Promise<void> {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected the terminal row on screen.");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.keyboard.down("Meta");
  await page.mouse.click(box.x + 12, box.y + box.height / 2);
  await page.keyboard.up("Meta");
}

async function handle(locator: Locator): Promise<ElementHandle<HTMLElement>> {
  const element = await locator.elementHandle();
  if (!element) throw new Error("Expected the xterm host to be attached.");
  return element as ElementHandle<HTMLElement>;
}

async function expectSameNode(before: ElementHandle<HTMLElement>, current: Locator): Promise<void> {
  const after = await handle(current);
  expect(await before.evaluate((node, next) => node.isSameNode(next) && node.isConnected, after)).toBe(true);
}

async function terminalBuffer(page: Page, clientId: string): Promise<string> {
  const result = await page.evaluate(() => (window as DesktopTerminalWindow).alfredDesktop!.terminal.list());
  return result.sessions.find((session) => session.clientId === clientId)?.buffer ?? "";
}
