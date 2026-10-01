import { realpath } from "node:fs/promises";
import type { Page } from "@playwright/test";
import type { TerminalListResult } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: { list(): Promise<TerminalListResult> } };
};

test.use({ fixtureOptions: { restoredSessions: 6, unsafeRecoveryItem: 1 } });

test("History recovery safety requires review, supports Escape disarm, and starts only on confirm", async ({
  harness,
}) => {
  const { page, paths } = harness;
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  const history = page.getByRole("region", { name: "History" });
  await history.getByRole("combobox", { name: "Session source" }).selectOption("saved");
  await expect(history.getByRole("listbox", { name: "Session results" }).getByRole("option")).toHaveCount(6);
  await history.getByRole("option", { name: /Restored fixture 1\b/ }).click();

  const unsafeAction = history.getByRole("button", { name: "Review resume" });
  const beforeReview = await listMainProcessTerminals(page);
  expect(beforeReview.sessions.some((session) => session.clientId === "restored-1")).toBe(false);
  expect(beforeReview.restoredSessions?.find((session) => session.clientId === "restored-1")?.buffer)
    .not.toContain("unsafe recovery confirmed");
  await unsafeAction.click();

  const confirm = history.getByRole("button", { name: "Confirm resume" });
  const review = history.getByRole("region", { name: "Resume review" });
  await expect(confirm).toBeVisible();
  await expect(review.getByText("shell command replay needs review", { exact: true })).toBeVisible();
  await expect(review.getByText(paths.workspaceA, { exact: true })).toBeVisible();
  await expect(
    review.getByText(
      "/bin/sh -c /usr/bin/printf 'unsafe recovery confirmed\\n'",
      { exact: true },
    ),
  ).toBeVisible();
  const armedSnapshot = await listMainProcessTerminals(page);
  expect(armedSnapshot.sessions.some((session) => session.clientId === "restored-1")).toBe(false);
  expect(armedSnapshot.restoredSessions?.find((session) => session.clientId === "restored-1")?.buffer)
    .not.toContain("unsafe recovery confirmed");

  await page.keyboard.press("Escape");
  await expect(history).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(history.getByRole("button", { name: "Review resume" })).toBeVisible();
  await expect(review).toHaveCount(0);

  await history.getByRole("button", { name: "Review resume" }).click();
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  const canonicalWorkspaceA = await realpath(paths.workspaceA);
  await expect.poll(async () => {
    const listed = await listMainProcessTerminals(page);
    const session = [...listed.sessions, ...(listed.restoredSessions ?? [])].find(
      (candidate) => candidate.clientId === "restored-1",
    );
    const sentinelCount = session?.buffer?.match(/unsafe recovery confirmed/g)?.length ?? 0;
    return session ? { command: session.command, cwd: session.cwd, sentinelCount } : null;
  }).toEqual({ command: "/bin/sh", cwd: canonicalWorkspaceA, sentinelCount: 1 });

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function listMainProcessTerminals(page: Page): Promise<TerminalListResult> {
  return page.evaluate(async () => {
    const terminalApi = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    if (!terminalApi) throw new Error("Desktop terminal API is unavailable.");
    return terminalApi.list();
  });
}
