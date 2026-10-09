import { expect, type Page } from "@playwright/test";

export async function settleTerminalTileAnimations(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    // Shell width transitions and React layout effects can start another animation after resize.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Array.from(document.querySelectorAll<HTMLElement>('.workspace-layout, .project-navigator, [data-testid="terminal-tile"]'))
      .flatMap((tile) => tile.getAnimations()).every((animation) => animation.playState === "finished");
  })).toBe(true);
}
