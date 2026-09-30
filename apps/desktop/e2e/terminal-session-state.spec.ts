import { expect, test } from "./support/electron-app";

test("plain terminals report Idle at the prompt and Running while a program holds the foreground", async ({ harness }) => {
  const { page } = harness;
  const status = page.getByTestId("terminal-tile").first().locator(".terminal-status-text");
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();

  // Fresh shell: no output timing involved, the shell itself is in the foreground.
  await expect(status).toHaveText("idle");

  await input.fill("sleep 4");
  await input.press("Enter");
  await expect(status).toHaveText("running");

  await expect(status).toHaveText("idle", { timeout: 15_000 });
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});
