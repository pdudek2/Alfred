import type { ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("swaps the focused terminal from the stack without remounting any xterm", async ({ harness }) => {
  const { page } = harness;

  await addManualTerminal(page);
  await addManualTerminal(page);
  await addManualTerminal(page);

  await expect(page.getByTestId("terminal-tile")).toHaveCount(4);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(1);
  const stack = page.getByRole("complementary", { name: /^Other sessions in / });
  await expect(stack.getByRole("button", { name: /Manual · zsh/ })).toHaveCount(3);

  const beforeHosts = await captureHosts(page, 4);
  const focusedBefore = await visibleSessionId(page);
  const target = stack.getByRole("button", { name: /Manual · zsh/ }).first();
  const targetId = await target.getAttribute("data-session-id");
  expect(targetId).not.toBe(focusedBefore);

  await target.click();
  const promoted = page.locator(`[data-testid="terminal-tile"][data-session-id="${targetId}"]`);
  await expect(promoted).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(1);
  await expect(stack.locator(`[data-session-id="${focusedBefore}"]`)).toBeVisible();
  await expectSameHosts(beforeHosts, page, "stack focus swap");
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
  test.use({ fixtureOptions: { inboxItems: 1 } });

  test("keeps drafts off the deck until launched, then stacks the launched session", async ({ harness }) => {
    const { page } = harness;

    await addManualTerminal(page);
    await expect(page.locator(".plan-line")).toBeVisible();
    await expect(page.getByTestId("terminal-grid").locator('[data-session-id="fixture-item-1"]')).toHaveCount(0);

    await page.locator(".plan-line").getByRole("button", { name: "Launch 1 ready draft" }).click();
    // Launching does not take focus; the launched session waits in the stack.
    await expect(page.getByRole("complementary", { name: /^Other sessions in / }).locator('[data-session-id="fixture-item-1"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="terminal-tile"][data-session-id="fixture-item-1"]'))
      .toHaveAttribute("aria-hidden", "true");
  });
});

async function addManualTerminal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("radio", { name: /^Terminal/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
}

async function selectSurface(page: Page, surface: "Work" | "History"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
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

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
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
