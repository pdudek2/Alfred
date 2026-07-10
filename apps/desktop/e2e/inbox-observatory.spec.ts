import type { Locator, Page } from "@playwright/test";
import type { TerminalApi, TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: TerminalApi };
};

test.use({ fixtureOptions: { inboxItems: 14, restoredSessions: 2 } });

test("inbox scrolls, executes a real action, and opens Observatory history", async ({ harness }) => {
  const { page } = harness;
  await page.getByRole("button", { name: /Open Inbox surface/i }).first().click();

  const inbox = page.getByRole("region", { name: "Inbox workspace" });
  await expect(inbox).toBeVisible();
  const scrollOwner = inbox.getByLabel("Inbox sections");
  const lastItem = page.getByText("Fixture item 14", { exact: true }).first();
  const beforeScroll = await readScrollGeometry(scrollOwner, lastItem);
  expect(beforeScroll.scrollTop, scrollEvidence("before", beforeScroll)).toBe(0);
  expect(beforeScroll.scrollHeight, scrollEvidence("before", beforeScroll)).toBeGreaterThan(
    beforeScroll.clientHeight,
  );
  expect(beforeScroll.itemBottomOverflow, scrollEvidence("before", beforeScroll)).toBeGreaterThan(2);

  await scrollOwner.hover();
  await page.mouse.wheel(0, beforeScroll.itemBottomOverflow + 2);
  await expect.poll(async () => (await readScrollGeometry(scrollOwner, lastItem)).scrollTop).toBeGreaterThan(0);

  const afterScroll = await readScrollGeometry(scrollOwner, lastItem);
  expect(afterScroll.itemTopUnderflow, scrollEvidence("after", afterScroll)).toBeLessThanOrEqual(2);
  expect(afterScroll.itemBottomOverflow, scrollEvidence("after", afterScroll)).toBeLessThanOrEqual(2);

  await scrollOwner.hover();
  await page.mouse.wheel(0, -afterScroll.scrollHeight);
  await expect.poll(async () => (await readScrollGeometry(scrollOwner, lastItem)).scrollTop).toBe(0);

  await expect(page.getByRole("article", { name: /Fixture item 1/i })).toHaveCount(0);
  await page.getByRole("button", {
    name: "Launch Fixture item 1 in Fixture Alpha",
  }).click();

  const runtimeSurface = page.getByTestId("desk-runtime-surface");
  await expect(runtimeSurface).toBeVisible();
  const launchedItem = runtimeSurface.getByRole("article", { name: /Fixture item 1/i });
  await expect(launchedItem).toBeVisible();
  const launchedHost = launchedItem.getByTestId("xterm-host");
  // The fixture launches /usr/bin/printf directly, so this text is PTY output rather than typed command echo.
  await expect(launchedHost).toContainText("fixture item 1");
  await expect(launchedHost).toContainText("[process exited with code 0]");
  await expect.poll(async () => {
    const listed = await listMainProcessTerminals(page);
    const snapshot = listed.restoredSessions?.find((session) => session.clientId === "fixture-item-1");
    return snapshot
      ? { args: snapshot.args, buffer: snapshot.buffer, command: snapshot.command }
      : null;
  }).toEqual({
    args: ["fixture item 1\n"],
    buffer: expect.stringContaining("fixture item 1"),
    command: "/usr/bin/printf",
  });

  await page.getByRole("button", { name: "Open History surface" }).click();
  const history = page.getByRole("region", { name: "History workspace" });
  await expect(history).toBeVisible();
  await expect(history.getByText("Sessions and project memory", { exact: true })).toBeVisible();
  await expect(history.getByRole("textbox", { name: "Search History sessions" })).toBeVisible();
  await expect(history.getByRole("complementary", { name: "Projects" })).toBeVisible();
  await expect(history.getByLabel("Sessions", { exact: true })).toBeVisible();
  await expect(history.getByRole("complementary", { name: "Session detail" })).toBeVisible();
  await expect(
    history.getByLabel("Sessions", { exact: true }).getByText("Fixture item 1", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open Work surface" }).click();
  await expect(runtimeSurface).toBeVisible();
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function readScrollGeometry(scrollOwner: Locator, item: Locator) {
  const [ownerBox, itemBox, dimensions] = await Promise.all([
    scrollOwner.boundingBox(),
    item.boundingBox(),
    scrollOwner.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
    })),
  ]);
  if (ownerBox === null || itemBox === null) throw new Error("Inbox scroll geometry is unavailable.");
  return {
    ...dimensions,
    itemTopUnderflow: ownerBox.y - itemBox.y,
    itemBottomOverflow: itemBox.y + itemBox.height - (ownerBox.y + ownerBox.height),
  };
}

function scrollEvidence(
  phase: string,
  geometry: Awaited<ReturnType<typeof readScrollGeometry>>,
): string {
  return `${phase} Inbox scroll geometry: ${JSON.stringify(geometry)}`;
}

async function listMainProcessTerminals(page: Page): Promise<TerminalListResult> {
  return page.evaluate(async () => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return terminalApi.list();
  });
}
