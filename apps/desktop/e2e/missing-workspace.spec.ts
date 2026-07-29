import { expect, test } from "./support/electron-app";

test.use({
  fixtureOptions: {
    activeWorkspaceId: "A",
    missingWorkspaceId: "A",
  },
});

test("keeps a workspace recoverable when its saved folder is missing", async ({ harness }) => {
  const { page } = harness;
  const unavailable = page.getByRole("status", { name: "Unavailable workspace folder" });

  await expect(unavailable).toBeVisible();
  await expect(unavailable).toContainText("Folder unavailable");
  await expect(unavailable).toContainText("workspace-a");
  await expect(unavailable.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(unavailable.getByRole("button", { name: "New terminal" })).toHaveCount(0);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);
  await expect(
    page.getByRole("toolbar", { name: "Work layout controls" }).getByRole("button", { name: "New terminal" }),
  ).toBeDisabled();

  await page.keyboard.press("Meta+T");
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);

  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("textbox", { name: "Search commands" }).fill("manual terminal");
  await expect(page.getByRole("option", { name: /New manual terminal/ })).toBeDisabled();

  harness.assertNoRuntimeErrors();
});
