import type { ElementHandle, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { requiredHandle } from "./support/app-state";
import { sessionTree, startAgent, surfaceButton, treeRow } from "./support/work-layout";

test("swaps the focused terminal from the rail's tree without remounting any xterm", async ({ harness }) => {
  const { page } = harness;

  await startAgent(page, "claude-1");
  await startAgent(page, "codex-1");
  await startAgent(page, "claude-2");

  // The first shell waits in the drawer; the deck holds the agents.
  await expect(page.getByTestId("terminal-tile")).toHaveCount(3);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(1);
  // The tree lists every agent, the focus included, which it marks as current.
  const rows = sessionTree(page).locator(".session-tree-row");
  await expect(rows).toHaveCount(3);
  await expect(sessionTree(page).locator('.session-tree-row[aria-current="true"]')).toHaveCount(1);

  const beforeHosts = await captureHosts(page, 3);
  const focusedBefore = await visibleSessionId(page);
  const target = sessionTree(page).locator('.session-tree-row:not([aria-current])').first();
  const targetId = await target.getAttribute("data-session-id");
  expect(targetId).not.toBe(focusedBefore);

  await target.click();
  const promoted = page.locator(`[data-testid="terminal-tile"][data-session-id="${targetId}"]`);
  await expect(promoted).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(1);
  await expect(treeRow(page, targetId!)).toHaveAttribute("aria-current", "true");
  await expect(treeRow(page, focusedBefore!)).not.toHaveAttribute("aria-current", "true");
  await expectSameHosts(beforeHosts, page, "tree focus swap");
  // A terminal shown again refits to the focus column instead of keeping its hidden size.
  await expect.poll(() => promoted.locator(".xterm-screen").evaluate((node) => node.getBoundingClientRect().width))
    .toBeGreaterThan(400);
  await expect.poll(() => focusedTerminalSessionId(page)).toBe(targetId);

  await selectSurface(page, "History");
  await expect(page.getByRole("region", { name: "History" })).toBeVisible();
  await selectSurface(page, "Work");
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await expect.poll(() => focusedTerminalSessionId(page)).toBe(targetId);
  await expectSameHosts(beforeHosts, page, "Work reactivation");
});

test.describe("draft plan line", () => {
  // The fixture's drafts are shells; the waiting one keeps running after launch.
  test.use({ fixtureOptions: { stagedItems: 1, waitingStagedItem: 1 } });

  test("keeps drafts off the deck until launched, then lists the launched shell in the drawer", async ({ harness }) => {
    const { page } = harness;

    await startAgent(page, "claude-1");
    await expect(page.locator(".plan-line")).toBeVisible();
    await expect(page.getByTestId("terminal-grid").locator('[data-session-id="fixture-item-1"]')).toHaveCount(0);

    await page.locator(".plan-line").getByRole("button", { name: "Launch 1 ready draft" }).click();
    // Launching does not take focus; the launched shell joins the drawer's tabs, not the rail's tree.
    await expect(page.getByRole("tablist", { name: "Shells" }).getByRole("tab", { name: /Fixture item 1/ })).toBeVisible();
    await expect(treeRow(page, "fixture-item-1")).toHaveCount(0);
    await expect(treeRow(page, "claude-1")).toHaveAttribute("aria-current", "true");
  });
});

async function selectSurface(page: Page, surface: "Work" | "History"): Promise<void> {
  await surfaceButton(page, surface).click();
}

async function captureHosts(page: Page, expectedCount: number): Promise<ElementHandle<HTMLElement>[]> {
  const hosts = page.getByTestId("xterm-host");
  await expect(hosts).toHaveCount(expectedCount);
  const handles: ElementHandle<HTMLElement>[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    handles.push(await requiredHandle(hosts.nth(index), `xterm host ${index + 1}`));
  }
  return handles;
}

async function expectSameHosts(
  before: ElementHandle<HTMLElement>[],
  page: Page,
  transition: string,
): Promise<void> {
  const hosts = page.getByTestId("xterm-host");
  await expect(hosts).toHaveCount(before.length);
  for (const [index, prior] of before.entries()) {
    const current = await requiredHandle(hosts.nth(index), `${transition}: xterm host ${index + 1}`);
    const same = await prior.evaluate(
      (node, currentNode) => node.isSameNode(currentNode) && node.isConnected,
      current,
    );
    expect(same, `${transition}: xterm host ${index + 1} changed`).toBe(true);
  }
}

async function visibleSessionId(page: Page): Promise<string | null> {
  return page.locator('[data-testid="terminal-tile"]:visible').getAttribute("data-session-id");
}

async function focusedTerminalSessionId(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.activeElement?.closest<HTMLElement>('[data-testid="terminal-tile"][data-session-id]')?.dataset.sessionId ?? null,
  );
}
