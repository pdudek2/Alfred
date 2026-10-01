import { expect, type Locator, type Page } from "@playwright/test";

// Drafts live in the plan line's list above the grid, which starts closed.
export async function openPlan(page: Page): Promise<Locator> {
  const trigger = page.locator(".plan-line__disclose");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  const drafts = page.getByRole("list", { name: /^Drafts in / });
  await expect(drafts).toBeVisible();
  return drafts;
}
