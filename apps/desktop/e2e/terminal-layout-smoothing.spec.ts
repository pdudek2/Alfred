import type { ElementHandle, Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("keeps four xterm hosts mounted while Grid shows one primary and two companions", async ({ harness }) => {
  const { page } = harness;

  await addManualTerminal(page);
  await addManualTerminal(page);
  await addManualTerminal(page);

  await expect(page.getByTestId("terminal-tile")).toHaveCount(4);
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.locator('[data-presentation-slot="primary"]')).toHaveCount(1);
  await expect(page.locator('[data-presentation-slot="secondary"]')).toHaveCount(1);
  await expect(page.locator('[data-presentation-slot="tertiary"]')).toHaveCount(1);
  await expect(page.getByRole("toolbar", { name: "Work layout controls" })).toContainText("3 visible sessions");

  const beforeHosts = await captureHosts(page, 4);
  const hiddenSession = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  await expect(hiddenSession).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "Manual · zsh 1" }).click();

  await expect(hiddenSession).not.toHaveAttribute("aria-hidden", "true");
  await expect(hiddenSession).toHaveAttribute("data-presentation-slot", "primary");
  await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(3);
  await expect(page.getByRole("toolbar", { name: "Work layout controls" })).toContainText("3 visible sessions");
  await expectSameHosts(beforeHosts, page, "select hidden project session");
});

async function addManualTerminal(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: "New manual terminal" }).click();
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
