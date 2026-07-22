import type { Page } from "@playwright/test";

export type WorkLayoutItem = "Focus" | "Split" | "Grid" | "Arrange";

export async function chooseWorkLayout(page: Page, item: WorkLayoutItem): Promise<void> {
  const toolbar = page.getByRole("toolbar", { name: "Work layout controls" });
  await toolbar.getByRole("button", { name: /Open layout menu/ }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}
