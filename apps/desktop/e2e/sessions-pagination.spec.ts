import { readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test.use({ fixtureOptions: { externalSessionSummaryCount: 120 } });

test("Sessions exposes all 120 external summaries through bounded UI pages and local search", async ({
  harness,
}, testInfo) => {
  const { app, page, paths } = harness;
  const sessionDirectory = path.join(paths.home, ".codex", "sessions", "2026", "07", "20");
  const files = (await readdir(sessionDirectory)).filter((file) => file.endsWith(".jsonl")).sort();
  const lateFixtureId = "summary-fixture-00119";
  const newestTimestamp = Date.parse("2026-07-20T12:00:00.000Z");
  for (const [index, file] of files.entries()) {
    const timestamp = new Date(newestTimestamp - index * 60_000);
    await utimes(path.join(sessionDirectory, file), timestamp, timestamp);
  }
  await writeFile(
    path.join(paths.home, ".codex", "session_index.jsonl"),
    `${JSON.stringify({ id: lateFixtureId, thread_name: "Known late pagination title" })}\n`,
    "utf8",
  );

  await selectSurface(page, "Sessions");
  const sessions = page.getByRole("region", { name: "Sessions workspace" });
  const results = sessions.getByRole("listbox", { name: "Session results" });
  await page.getByRole("combobox", { name: "Session source" })
    .selectOption("external-codex");

  await expect(sessions.getByRole("status")).toHaveText("120");
  await expect(results.getByRole("option")).toHaveCount(80);
  const absoluteTimes = results.locator(".sessions-navigator__result-meta time small");
  await expect(absoluteTimes).toHaveCount(80);
  expect(new Set((await absoluteTimes.allTextContents()).slice(0, 10)).size).toBe(10);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1120, height: 720 },
  ]) {
    await setHiddenWindowSize(app, page, viewport.width, viewport.height);
    expect(await results.getByRole("option").evaluateAll((options) => options.every((option) => (
      option.scrollWidth <= option.clientWidth
    )))).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`sessions-volume-${viewport.width}x${viewport.height}.png`),
    });
  }
  await sessions.getByRole("button", { name: "Next" }).click();
  await expect(results.getByRole("option")).toHaveCount(40);
  await expect(results.getByRole("option", { name: /Known late pagination title/i })).toBeVisible();

  const search = sessions.getByRole("searchbox", { name: "Search sessions" });
  await search.fill("Known late pagination title");
  await expect(search).toBeFocused();
  await expect(results.getByRole("option")).toHaveCount(1);
  await expect(results.getByRole("option", { name: /Known late pagination title/i })).toBeVisible();
  expect(await page.locator(".sessions-result").count()).toBeLessThanOrEqual(80);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function selectSurface(page: import("@playwright/test").Page, surface: "Sessions"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: surface }).click();
}

async function setHiddenWindowSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    if (window.isVisible()) throw new Error("Sessions visual test must keep Electron hidden.");
    window.setBounds({ x: 0, y: 0, ...bounds });
  }, { width, height });
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width,
    height,
  });
}
