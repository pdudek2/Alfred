import { appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";

const HOOKS_SCREEN = [
  "  Hooks need review",
  "  4 hooks are new or changed.",
  "› 1. Review hooks",
  "  2. Trust all and continue",
  "  enter confirm · esc skip",
].join("\r\n");

test("asks for you while Codex holds on a start screen, until the screen goes", async ({ harness }) => {
  const { app, page, paths } = harness;
  await setWindowSize(app, page, 1440, 900);

  await page.getByRole("button", { name: "New", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Codex/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(tile).toContainText("codex fixture ready");
  const needsYou = page.getByRole("button", { name: /Needs you/ });
  await expect(needsYou).toHaveCount(0);

  const files = await readdir(paths.root);
  const marker = path.join(paths.root, files.find((name) => name.startsWith("alfred-codex-fixture-"))!);
  await appendFile(marker, `\u001b[2J\u001b[H${HOOKS_SCREEN}\r\n`);
  await expect(tile).toContainText("Hooks need review");
  await expect(needsYou).toBeVisible();
  await needsYou.click();
  await expect(page.getByRole("dialog", { name: /Needs you/ })).toContainText("Hooks need review");
  await page.keyboard.press("Escape");

  await appendFile(marker, "\u001b[2J\u001b[H› Ask Codex to do anything\r\n");
  await expect(tile).toContainText("Ask Codex to do anything");
  await expect(needsYou).toHaveCount(0);
});
