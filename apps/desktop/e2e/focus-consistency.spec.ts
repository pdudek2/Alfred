import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { openNewTerminalSheet } from "./support/work-layout";

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
  // A second terminal puts the first one in the stack.
  await openNewTerminalSheet(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  // Like the first one, the new terminal claims focus once it starts; let that settle first.
  await expect(page.locator('[data-testid="terminal-tile"][data-session-id="manual-2"]').getByRole("textbox", { name: "Terminal input" }))
    .toBeFocused();
  const stackCard = page.getByRole("complementary", { name: /^Other sessions in / })
    .getByRole("button", { name: /(?<!\/)zsh(?! \d)(?! ·)/ });
  await expect(stackCard).toBeVisible();

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
      control: stackCard,
      offset: "-2px",
      // Shift+Tab from the stack lands in the terminal, which keeps Tab for the shell.
      reverse: true,
    },
  ];

  for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
    await setWindowSize(app, page, width, height);
    for (const [index, { control, offset, reverse }] of controls.entries()) {
      if (index === 2) await page.locator('[data-testid="terminal-tile"]:visible').focus();
      await focusFromKeyboard(page, control, reverse);
      await expect(control).toHaveCSS("outline-style", "solid");
      await expect(control).toHaveCSS("outline-width", "2px");
      await expect(control).toHaveCSS("outline-color", "rgb(77, 168, 181)");
      await expect(control).toHaveCSS("outline-offset", offset);
      await page.screenshot({
        path: testInfo.outputPath(`focus-${width}x${height}-${index + 1}.png`),
      });
    }
  }

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

test("moves along the side column tabs with the arrow keys and selects with Enter", async ({ harness }) => {
  const { page } = harness;
  await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
  // Only the visible row is in the accessibility tree: the stack's, or Details' while it is open.
  const tabs = page.getByRole("tablist", { name: "Side column" });
  const details = page.getByRole("complementary", { name: "Details" });

  await tabs.getByRole("tab", { name: "Sessions" }).focus();
  await page.keyboard.press("ArrowRight");
  const detailsTab = tabs.getByRole("tab", { name: "Details" });
  await expect(detailsTab).toBeFocused();
  expect(await detailsTab.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
  await expect(detailsTab).toHaveCSS("outline-style", "solid");
  await expect(detailsTab).toHaveCSS("outline-color", "rgb(77, 168, 181)");
  await expect(details).toHaveCount(0);

  await page.keyboard.press("Enter");
  await expect(details).toBeVisible();
  await expect(details.getByRole("tab", { name: "Details" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(details.getByRole("tab", { name: "Sessions" })).toBeFocused();
  await expect(details).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(details).toHaveCount(0);
  // Closing hands focus back to the stack's Details tab, the trigger; the arrows go on from there.
  await expect(detailsTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.getByRole("tab", { name: "Sessions" })).toBeFocused();

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function focusFromKeyboard(page: Page, control: Locator, reverse = false): Promise<void> {
  await control.focus();
  await page.keyboard.press(reverse ? "Tab" : "Shift+Tab");
  await page.keyboard.press(reverse ? "Shift+Tab" : "Tab");
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
