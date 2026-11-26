import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";
import { startAgent, treeRow } from "./support/work-layout";

test.use({
  fixtureOptions: {
    activeWorkspaceId: "A",
    projectShell: true,
  },
});

test("uses one visible keyboard focus ring across Work controls", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  // A narrow focus column folds Close into the overflow menu; either way one tile control takes the ring.
  const tileUtility = page.getByTestId("workbench-header")
    .getByRole("button", { name: /^(Close|More actions for) Claude/ }).first();
  // A second agent takes the focus; the first one waits in the rail's tree.
  await startAgent(page, "claude-1");
  const second = await startAgent(page, "claude-2");
  // The new terminal claims focus once it starts; let that settle first.
  await expect(second.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
  const treeCard = treeRow(page, "claude-1");
  await expect(treeCard).toBeVisible();

  const controls = [
    {
      control: page.getByRole("navigation", { name: "Projects and Free Chats" })
        .getByRole("button", { name: "Fixture Alpha project" }),
      offset: "-2px",
    },
    {
      control: page.getByRole("button", { name: "New session", exact: true }),
      offset: "-2px",
      // The terminal before it keeps Tab for the shell, so reach it from the control after it.
      fromAfter: true,
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
    for (const [index, { control, offset, fromAfter }] of controls.entries()) {
      if (index === 2) await page.locator('[data-testid="terminal-tile"]:visible').focus();
      await focusFromKeyboard(page, control, fromAfter);
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

async function focusFromKeyboard(page: Page, control: Locator, fromAfter = false): Promise<void> {
  await control.focus();
  await page.keyboard.press(fromAfter ? "Tab" : "Shift+Tab");
  await page.keyboard.press(fromAfter ? "Shift+Tab" : "Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
}

