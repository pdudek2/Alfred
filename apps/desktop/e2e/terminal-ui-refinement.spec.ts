import { expect, test } from "./support/electron-app";
import { chooseWorkLayout } from "./support/work-layout";

test("terminal identity marks and compact Grid stay visible", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  await addSession(page, "New Codex session");
  await addSession(page, "New Claude session");

  const tiles = page.getByTestId("terminal-tile");
  await expect(tiles).toHaveCount(3);
  await expect(page.locator(".terminal-tile .tile-kind-mark.codex .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".terminal-tile .tile-kind-mark.claude .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".project-session-kind.kind-codex .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".project-session-kind.kind-claude .kind-brand-icon")).toBeVisible();

  const manualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  const manualInput = manualTile.getByRole("textbox", { name: "Terminal input" });
  await manualInput.fill("codex");
  await manualInput.press("Enter");
  await expect(manualTile.locator(".tile-kind-mark.codex .kind-brand-icon")).toBeVisible();
  await expect(page.locator('.project-session[data-session-id="manual-1"]')
    .locator(".project-session-kind.kind-codex .kind-brand-icon")).toBeVisible();

  const placement = await tiles.evaluateAll((nodes) => nodes.map((node) => ({
    id: (node as HTMLElement).dataset.sessionId,
    column: (node as HTMLElement).style.gridColumn,
    row: (node as HTMLElement).style.gridRow,
  })));
  expect(placement.map(({ column, row }) => ({ column, row }))).toEqual([
    { column: "1 / span 6", row: "1 / span 3" },
    { column: "7 / span 6", row: "1 / span 3" },
    { column: "1 / span 12", row: "4 / span 3" },
  ]);
  await expect(manualTile).toHaveClass(/selected/);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-1120x720.png") });

  await chooseWorkLayout(page, "Split");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-split-1120x720.png") });

  await chooseWorkLayout(page, "Grid");
  await addSession(page, "New manual terminal");
  await addSession(page, "New manual terminal");
  await expect(tiles).toHaveCount(5);
  await expect(tiles.last()).toHaveClass(/selected/);
  expect(await tiles.evaluateAll((nodes) => nodes.map((node) => ({
    column: (node as HTMLElement).style.gridColumn,
    row: (node as HTMLElement).style.gridRow,
  })))).toEqual([
    { column: "1 / span 6", row: "1 / span 3" },
    { column: "7 / span 6", row: "1 / span 3" },
    { column: "1 / span 4", row: "4 / span 3" },
    { column: "5 / span 4", row: "4 / span 3" },
    { column: "9 / span 4", row: "4 / span 3" },
  ]);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1686, height: 980 });
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-5-1686x980.png") });

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-5-1120x720.png") });
});

test("manual terminal adopts the Claude runtime identity", async ({ harness }, testInfo) => {
  const { page } = harness;
  const manualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  const manualInput = manualTile.getByRole("textbox", { name: "Terminal input" });

  await manualInput.fill("claude");
  await manualInput.press("Enter");

  await expect(manualTile.locator(".tile-kind-mark.claude .kind-brand-icon")).toBeVisible();
  await expect(page.locator('.project-session[data-session-id="manual-1"]')
    .locator(".project-session-kind.kind-claude .kind-brand-icon")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("manual-claude-runtime-identity.png") });
});

async function addSession(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name }).click();
}
