import { appendFile, readdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { treeRow } from "./support/work-layout";

test("builds a hooked agent's history from its hooks and ignores the old screen it redraws", async ({ harness }, testInfo) => {
  const { app, page, paths } = harness;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1440, height: 900 }));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);

  await page.getByRole("button", { name: "New", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await sheet.getByRole("radio", { name: /^Claude/ }).click();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
  const tile = page.locator('[data-testid="terminal-tile"]:visible');
  await expect(tile).toContainText("claude fixture ready");
  const sessionId = (await tile.getAttribute("data-session-id"))!;
  const files = await readdir(paths.root);
  const marker = path.join(paths.root, files.find((name) => name.startsWith("alfred-claude-fixture-"))!);
  const [socketPath, hookSessionId] = (await readFile(path.join(paths.root, files.find((name) => name.startsWith("alfred-claude-hook-"))!), "utf8"))
    .trim()
    .split("\n");
  // What Alfred's relay forwards when Claude Code runs a hook.
  const hook = (event: string, payload: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
    const message = JSON.stringify({ sessionId: hookSessionId, event, payload: JSON.stringify({ hook_event_name: event, ...payload }) });
    const socket = net.connect(socketPath!, () => socket.end(`${message}\n`));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });

  await tile.getByTestId("xterm-host").click();
  await page.keyboard.type("Fix the build");
  await page.keyboard.press("Enter");
  await hook("UserPromptSubmit", { prompt: "Fix the build" });
  await hook("PostToolUse", { tool_name: "Bash", tool_input: { command: "pnpm test", description: "Run tests" } });
  await hook("PostToolUse", { tool_name: "Edit", tool_input: { file_path: "/repo/src/app.tsx", old_string: "a", new_string: "b" } });
  await hook("Stop", { last_assistant_message: "Fixed the build." });

  const activity = page.getByRole("complementary", { name: "Details" }).getByRole("region", { name: "Activity" });
  for (const line of ["Fixed the build.", "Edited app.tsx", "Ran pnpm test", "You asked: Fix the build"]) {
    await expect(activity).toContainText(line);
  }
  const row = treeRow(page, sessionId);
  await expect(row.locator(".session-tree-meta")).toHaveText("Fixed the build.");
  const items = activity.getByRole("listitem");
  const count = await items.count();

  // Scrolling back through the transcript makes Claude draw its old tool lines and errors again.
  for (let pass = 0; pass < 3; pass += 1) {
    await appendFile(marker, "⏺ Update(src/old.ts)\n  ⎿  Updated with 3 additions\nBash(\"pnpm lint\")\nError: old failure\nRan 5 shell commands\n");
  }
  await expect(tile.getByTestId("xterm-host")).toContainText("Ran 5 shell commands");
  await page.waitForTimeout(500);
  await expect(items).toHaveCount(count);
  await expect(activity).not.toContainText("old failure");
  await expect(row.locator(".session-tree-meta")).toHaveText("Fixed the build.");
  await page.screenshot({ path: testInfo.outputPath("agent-history-1440x900.png") });
});
