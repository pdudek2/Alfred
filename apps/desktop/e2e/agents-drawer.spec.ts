import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { neutralScreenshotPointer, privacySafeScreenshotStyle } from "./support/privacy-safe-screenshot";

const evidenceDir = path.resolve(import.meta.dirname, "../../../output/playwright/agents-drawer-production");

test.use({
  fixtureOptions: {
    inboxItems: 1,
    projectShell: true,
  },
});

test("keeps active agents and decisions visible without reflowing the terminal", async ({ harness }) => {
  const { app, page } = harness;
  await mkdir(evidenceDir, { recursive: true });
  await setWindowSize(app, 1440, 900);

  const navigator = page.getByRole("navigation", { name: "Projects and Free Chats" });
  await addSession(page, "New Codex session");
  await navigator.getByRole("button", { name: /Fixture Beta workspace/i }).click();
  await addSession(page, "New Claude session");
  await navigator.getByRole("button", { name: /Fixture Alpha workspace/i }).click();

  const trigger = page.getByRole("button", { name: "Agents, 2 active" });
  await expect(trigger).toBeVisible();
  const alphaProject = navigator.getByRole("button", { name: "Fixture Alpha workspace" });
  const betaProject = navigator.getByRole("button", { name: "Fixture Beta workspace" });
  await expect(alphaProject).toBeVisible();
  await expect(alphaProject).toHaveAccessibleDescription("1 decision needs review, 1 active agent");
  await expect(betaProject).toBeVisible();
  await expect(betaProject).toHaveAccessibleDescription("1 active agent");

  const grid = page.getByTestId("terminal-grid");
  const gridBefore = await grid.boundingBox();
  await trigger.click();

  const drawer = page.getByRole("complementary", { name: "Agents" });
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Agents" })).toBeFocused();
  await expect(drawer.getByRole("region", { name: "Needs a decision" })).toContainText("Fixture item 1");
  await expect(drawer.getByRole("region", { name: "In progress" })).toContainText("Codex · session 1");
  await expect(drawer.getByRole("region", { name: "In progress" })).toContainText("Claude · session 1");

  const gridAfter = await grid.boundingBox();
  const triggerBox = await trigger.boundingBox();
  const drawerBox = await drawer.boundingBox();
  if (!gridBefore || !gridAfter || !triggerBox || !drawerBox) throw new Error("Expected visible shell geometry.");
  expect(gridAfter.width).toBe(gridBefore.width);
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(drawerBox.x);
  expect(await navigator.evaluate((node) => node.getBoundingClientRect().width)).toBe(226);
  expect(await drawer.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(328, 1);
  expect(await documentOverflow(page)).toBe(0);

  await page.mouse.move(neutralScreenshotPointer.x, neutralScreenshotPointer.y);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-drawer-wide-1440x900.png"),
    style: privacySafeScreenshotStyle,
  });

  await setWindowSize(app, 1120, 720);
  await expect(drawer).toBeVisible();
  await expect(navigator).toHaveCSS("width", "46px");
  expect(await navigator.evaluate((node) => node.getBoundingClientRect().width)).toBe(46);
  expect(await drawer.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(300, 1);
  expect(await documentOverflow(page)).toBe(0);
  await page.screenshot({
    path: path.join(evidenceDir, "agents-drawer-narrow-1120x720.png"),
    style: privacySafeScreenshotStyle,
  });

  await drawer.getByRole("button", { name: "Open full Inbox queue" }).click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  harness.assertNoRuntimeErrors();
});

async function addSession(page: Page, name: "New Codex session" | "New Claude session"): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name }).click();
}

async function setWindowSize(
  app: import("@playwright/test").ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
}

async function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
