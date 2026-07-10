import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { expect, test } from "./support/electron-app";

test.use({ fixtureOptions: { activeWorkspaceId: "A" } });

test("workspace switch keeps the same terminal runtime in workspace A", async ({ harness }) => {
  const { marker, page, paths } = harness;
  const terminalInput = page.getByRole("textbox", { name: "Terminal input" });
  const terminalHost = page.getByTestId("xterm-host");
  const terminalTiles = page.getByTestId("terminal-tile");
  const firstMarkerCommand = encodedPrintCommand(marker);

  expect(firstMarkerCommand).not.toContain(marker);
  await expect(terminalInput).toBeVisible();
  await terminalInput.fill(firstMarkerCommand);
  await terminalInput.press("Enter");
  await expect(terminalHost).toContainText(marker);
  await expect(terminalTiles).toHaveCount(1);

  const betaWorkspace = page.getByRole("tab", { name: /Fixture Beta workspace/i });
  const alphaWorkspace = page.getByRole("tab", { name: /Fixture Alpha workspace/i });
  await betaWorkspace.click();
  await expect(betaWorkspace).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("status", { name: "Empty workspace" })).toBeVisible();
  await expect(alphaWorkspace).toHaveAttribute("aria-selected", "false");

  await alphaWorkspace.click();
  await expect(alphaWorkspace).toHaveAttribute("aria-selected", "true");
  await expect(terminalTiles).toHaveCount(1);
  await expect(terminalHost).toContainText(marker);
  const cwdLabel = terminalTiles.locator('[aria-label^="cwd "]');
  await expect(cwdLabel).toHaveCount(1);
  const cwdAriaLabel = await cwdLabel.getAttribute("aria-label");
  if (cwdAriaLabel === null) throw new Error("Terminal CWD label is missing.");
  const actualCwd = cwdAriaLabel.slice("cwd ".length);
  expect(await realpath(actualCwd)).toBe(await realpath(paths.workspaceA));

  const secondMarker = `ALFRED_E2E_AFTER_SWITCH_${randomUUID()}`;
  const secondMarkerCommand = encodedPrintCommand(secondMarker);
  expect(secondMarkerCommand).not.toContain(secondMarker);
  await expect(terminalInput).toBeVisible();
  await terminalInput.fill(secondMarkerCommand);
  await terminalInput.press("Enter");
  await expect(terminalHost).toContainText(marker);
  await expect(terminalHost).toContainText(secondMarker);
  await expect(terminalTiles).toHaveCount(1);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

function encodedPrintCommand(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  return `printf '${hex}' | /usr/bin/xxd -r -p; printf '\\n'`;
}
