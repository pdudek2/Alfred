import { expect, test } from "./support/electron-app";

test("plain terminals report Idle at the prompt and Running while a program holds the foreground", async ({ harness }) => {
  const { page } = harness;
  // The focused session's state is the glyph beside its title in the breadcrumb.
  const status = page.getByRole("navigation", { name: "Breadcrumb" }).locator(".session-status-glyph");
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();

  // Fresh shell: no output timing involved, the shell itself is in the foreground.
  await expect(status).toHaveAttribute("aria-label", "status idle");

  await input.fill("sleep 4");
  await input.press("Enter");
  await expect(status).toHaveAttribute("aria-label", "status running");

  await expect(status).toHaveAttribute("aria-label", "status idle", { timeout: 15_000 });
});
