import { openNewSession } from "./support/work-layout";
import { expect, test } from "./support/electron-app";

test.use({
  fixtureOptions: {
    activeWorkspaceId: "A",
    missingWorkspaceId: "A",
  },
});

test("keeps a workspace recoverable when its saved folder is missing", async ({ harness }) => {
  const { page } = harness;
  const unavailable = page.getByRole("status", { name: "Unavailable project folder" });

  await expect(unavailable).toBeVisible();
  await expect(unavailable).toContainText("Folder unavailable");
  await expect(unavailable).toContainText("workspace-a");
  await expect(unavailable.getByRole("button", { name: "Choose folder" })).toBeVisible();
  await expect(unavailable.getByRole("button", { name: "New terminal" })).toHaveCount(0);
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+T");
  await expect(page.getByTestId("terminal-tile")).toHaveCount(0);

  await openNewSession(page);
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(page.getByRole("form", { name: "New session" })).toContainText("Reconnect the project folder first");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("textbox", { name: "Search commands" }).fill("new terminal");
  await expect(page.getByRole("option", { name: /New terminal/ })).toBeDisabled();

});
