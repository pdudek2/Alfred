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
export function surfaceButton(page: Page, surface: "Work" | "History" | "Settings"): Locator {
  const name = surface === "Work" ? "Deck" : surface;
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

/** Details holds the right column; it starts open only above 1200 px. This shows it from the palette when it is hidden. */
export async function openDetails(page: Page): Promise<void> {
  const column = page.getByTestId("context-column");
  if (await column.evaluate((node) => node.classList.contains("closed"))) {
    // Ctrl+I off macOS is Tab for a focused terminal, so the palette is the shortcut-free way in.
    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByRole("textbox", { name: "Search commands" }).fill("Details");
    await page.getByRole("option", { name: /^Details/ }).click();
  }
  await expect(column).toHaveClass(/(^| )open( |$)/);
}

/** Opens the New session composer under the terminal, from the deck; an empty deck already shows it. */
export async function openNewSession(page: Page): Promise<Locator> {
  const composer = page.getByRole("form", { name: "New session", exact: true });
  const rest = page.getByRole("button", { name: "New session", exact: true });
  if (!(await composer.isVisible()) && !(await rest.isVisible())) await surfaceButton(page, "Work").click();
  if (!(await composer.isVisible())) await rest.click();
  await expect(composer).toBeVisible();
  return composer;
}

/** Starts a plain terminal in the active project through the New session composer. */
export async function addManualTerminal(page: Page): Promise<void> {
  await openNewTerminalSheet(page);
  await page.getByRole("button", { name: "Start" }).click();
}

/** Opens the New session composer with Terminal picked; the caller presses Start. */
export async function openNewTerminalSheet(page: Page): Promise<void> {
  const composer = await openNewSession(page);
  await composer.getByRole("radio", { name: /^Terminal/ }).click();
}
