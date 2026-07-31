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
  await expect(tiles.last()).toHaveClass(/selected/);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-grid-1120x720.png") });

  await chooseWorkLayout(page, "Split");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("terminal-identities-split-1120x720.png") });
});

async function addSession(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name }).click();
}
