import type { Page } from "@playwright/test";
import type { TerminalApi } from "../src/shared/terminal-ipc";
import { expect, test } from "./support/electron-app";

type DesktopTerminalWindow = Window & {
  alfredDesktop?: { terminal: TerminalApi };
};

test("keeps Prepare Work and global session actions continuous across surfaces", async ({ harness }) => {
  const { page } = harness;
  await expect(page.getByRole("article", { name: /Manual · zsh 1/i })).toBeVisible();

  await openLaunchItem(page, "Prepare Work");
  const draft = page.getByRole("textbox", { name: "Dispatch instruction" });
  await draft.fill("preserve this project draft");
  await page.keyboard.press("Escape");
  await selectSurface(page, "Sessions");
  await selectSurface(page, "Work");
  await openLaunchItem(page, "Prepare Work");
  await expect(page.getByRole("textbox", { name: "Dispatch instruction" }))
    .toHaveValue("preserve this project draft");
  await page.keyboard.press("Escape");

  await selectSurface(page, "Sessions");
  await openLaunchItem(page, "New manual terminal");
  await expect(page.getByTestId("workbench-shell")).toHaveClass(/surface-work/);
  await expect(page.getByRole("article", { name: /Manual · zsh 2/i })).toHaveClass(/selected/);

  await selectSurface(page, "Sessions");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.getByRole("textbox", { name: "Search commands" }).fill("rename current workspace");
  await page.getByRole("option", { name: /Rename current workspace/ }).click();
  await expect(page.getByTestId("workbench-shell")).toHaveClass(/surface-work/);
  await expect(page.getByRole("dialog", { name: "Rename workspace" })).toBeVisible();

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

test("reads final scrollback after a managed terminal exits", async ({ harness }) => {
  const { page } = harness;
  await expect(page.getByRole("article", { name: /Manual · zsh 1/i })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const terminal = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    return (await terminal?.list())?.sessions.length ?? 0;
  })).toBe(1);

  const runtimeId = await page.evaluate(async () => {
    const terminal = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    const session = (await terminal?.list())?.sessions[0];
    if (!terminal || !session) throw new Error("Fixture terminal is unavailable.");
    terminal.write({ id: session.id, data: "printf 'final scrollback proof\\n'; exit\n" });
    return session.id;
  });
  await expect.poll(() => page.evaluate(async (id) => {
    const terminal = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    return (await terminal?.list())?.sessions.some((session) => session.id === id) ?? false;
  }, runtimeId)).toBe(false);
  await expect.poll(() => page.evaluate(async (id) => {
    const terminal = (window as DesktopTerminalWindow).alfredDesktop?.terminal;
    return (await terminal?.snapshot({ id }))?.buffer ?? "";
  }, runtimeId)).toContain("final scrollback proof");

  await selectSurface(page, "Sessions");
  const results = page.getByRole("listbox", { name: "Session results" });
  await results.getByRole("option", { name: /Manual · zsh 1/i }).click();
  await expect(page.getByRole("article", { name: /Manual · zsh 1/i }))
    .toContainText("final scrollback proof");

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function openLaunchItem(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Open launch menu" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

async function selectSurface(page: Page, label: "Work" | "Sessions"): Promise<void> {
  await page.getByRole("button", { name: "Open Surfaces menu" }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
