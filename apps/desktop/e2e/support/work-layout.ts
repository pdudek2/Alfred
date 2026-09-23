import { expect, type Page } from "@playwright/test";

export type WorkLayoutItem = "Focus" | "Split" | "Grid" | "Arrange";

export async function chooseWorkLayout(page: Page, item: WorkLayoutItem): Promise<void> {
  const toolbar = page.getByRole("toolbar", { name: "Work layout controls" });
  await toolbar.getByRole("button", { name: /Open layout menu/ }).click();
  await page.getByRole("menuitemradio", { name: item, exact: true }).click();
}

export async function settleTerminalTileAnimations(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    // Shell width transitions and React layout effects can start another tile animation after resize.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Array.from(document.querySelectorAll<HTMLElement>('.workspace-layout, .project-navigator, [data-testid="terminal-tile"]'))
      .flatMap((tile) => tile.getAnimations()).every((animation) => animation.playState === "finished");
  })).toBe(true);
}
