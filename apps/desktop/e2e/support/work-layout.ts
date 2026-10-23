import { expect, type Locator, type Page } from "@playwright/test";

export async function settleTerminalTileAnimations(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    // React layout effects can start another animation after resize.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Array.from(document.querySelectorAll<HTMLElement>('.workspace-layout, .project-navigator, [data-testid="terminal-tile"]'))
      .flatMap((tile) => tile.getAnimations()).every((animation) => animation.playState === "finished");
  })).toBe(true);
}

/** Deck, History and Settings live in the rail. */
export function surfaceButton(page: Page, surface: "Work" | "History" | "Local Data & Privacy"): Locator {
  const name = surface === "Work" ? "Deck" : surface === "Local Data & Privacy" ? "Settings" : surface;
  return page.getByTestId("project-navigator").getByRole("button", { name, exact: true });
}

/** The active project's sessions in the rail. v5 replaced the right-hand session stack with this tree. */
export function sessionTree(page: Page): Locator {
  return page.getByTestId("project-navigator").getByRole("list", { name: /^Sessions in / });
}

/** One session's row in the rail tree; a terminal tile carries the same data-session-id, so scope to the row. */
export function treeRow(page: Page, sessionId: string): Locator {
  return sessionTree(page).locator(`.session-tree-row[data-session-id="${sessionId}"]`);
}

/** Details holds the right column and starts open; this reopens it with ⌘I when a test has hidden it. */
export async function openDetails(page: Page): Promise<void> {
  const column = page.getByTestId("context-column");
  if (await column.evaluate((node) => node.classList.contains("closed"))) await page.keyboard.press("ControlOrMeta+i");
  await expect(column).toHaveClass(/(^| )open( |$)/);
}

/** Opens the New session sheet with Terminal picked; the caller presses Start. */
export async function openNewTerminalSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("dialog", { name: "New session", exact: true }).getByRole("radio", { name: /^Terminal/ }).click();
}
