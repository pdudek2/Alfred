import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { openNewTerminalSheet, treeRow } from "./support/work-layout";

test.use({
  fixtureOptions: {
    activeWorkspaceId: "A",
    projectShell: true,
  },
});

test("uses one visible keyboard focus ring across Work controls", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  // Initial xterm startup claims focus asynchronously; begin after that handoff.
  await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
  // A narrow focus column folds Close into the overflow menu; either way one tile control takes the ring.
  const tileUtility = page.locator('[data-testid="terminal-tile"]:visible')
    .getByRole("button", { name: /^(Close|More actions for) zsh/ }).first();
  // A second terminal takes the focus; the first one waits in the rail's tree.
  await openNewTerminalSheet(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  // Like the first one, the new terminal claims focus once it starts; let that settle first.
  await expect(page.locator('[data-testid="terminal-tile"][data-session-id="manual-2"]').getByRole("textbox", { name: "Terminal input" }))
    .toBeFocused();
  const treeCard = treeRow(page, "manual-1");
  await expect(treeCard).toBeVisible();

  const controls = [
    {
      control: page.getByRole("navigation", { name: "Projects and Free Chats" })
        .getByRole("button", { name: "Fixture Alpha project" }),
      offset: "-2px",
    },
    {
      control: page.getByTestId("workbench-header").getByRole("button", { name: "New", exact: true }),
      offset: "2px",
    },
    {
      control: tileUtility,
      offset: "-2px",
    },
    {
      control: treeCard,
      offset: "-2px",
    },
  ];

  for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
    await setWindowSize(app, page, width, height);
    for (const [index, { control, offset }] of controls.entries()) {
      if (index === 2) await page.locator('[data-testid="terminal-tile"]:visible').focus();
      await focusFromKeyboard(page, control);
      await expect(control).toHaveCSS("outline-style", "solid");
      await expect(control).toHaveCSS("outline-width", "2px");
      // The grey of --text-secondary: focus is not a signal, so it carries no colour.
      await expect(control).toHaveCSS("outline-color", "rgb(202, 202, 207)");
      await expect(control).toHaveCSS("outline-offset", offset);
      await page.screenshot({
        path: testInfo.outputPath(`focus-${width}x${height}-${index + 1}.png`),
      });
    }
  }

});

async function focusFromKeyboard(page: Page, control: Locator): Promise<void> {
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
}

async function setWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width,
    height,
  });
}
