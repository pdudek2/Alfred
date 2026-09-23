import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";

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
  const tileUtility = page.getByTestId("terminal-tile")
    .getByRole("button", { name: /^Close Manual/ });

  const controls = [
    {
      control: page.getByRole("navigation", { name: "Projects and Free Chats" })
        .getByRole("button", { name: "Fixture Alpha workspace" }),
      offset: "-2px",
    },
    {
      control: page.getByRole("button", { name: /^Open layout menu,/ }),
      offset: "2px",
    },
    {
      control: tileUtility,
      offset: "-2px",
    },
  ];

  for (const [width, height] of [[1440, 900], [1120, 720]] as const) {
    await setWindowSize(app, page, width, height);
    for (const [index, { control, offset }] of controls.entries()) {
      if (index === 2) await page.getByTestId("terminal-tile").focus();
      await focusFromKeyboard(page, control);
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
