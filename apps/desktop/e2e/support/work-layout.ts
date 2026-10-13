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

/** Opens the New session sheet with Terminal picked; the caller presses Start. */
export async function openNewTerminalSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("dialog", { name: "New session", exact: true }).getByRole("radio", { name: /^Terminal/ }).click();
}
