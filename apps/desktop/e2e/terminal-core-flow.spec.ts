import type { ElementHandle, Locator } from "@playwright/test";
import { expect, test } from "./support/electron-app";

test("terminal core flow preserves the real xterm and layout geometry", async ({ harness }, testInfo) => {
  const { app, marker, page } = harness;
  await expect(page.getByTestId("workbench-header")).toBeVisible();
  const firstInput = page.getByRole("textbox", { name: "Terminal input" }).first();
  await expect(firstInput).toBeVisible();
  await firstInput.fill(`printf '${marker}\\n'`);
  await firstInput.press("Enter");
  await expect(page.getByTestId("xterm-host").first()).toContainText(marker);

  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.getByTestId("terminal-tile")).toHaveCount(2);
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.getByTestId("terminal-tile")).toHaveCount(3);

  const tile = page.getByTestId("terminal-tile").first();
  const host = page.getByTestId("xterm-host").first();
  const screen = host.locator(".xterm-screen");
  await expect(screen).toBeAttached();
  const tileBefore = await requiredHandle(tile, "terminal tile");
  const hostBefore = await requiredHandle(host, "xterm host");
  const screenBefore = await requiredHandle(screen, "xterm screen");

  await page.getByRole("button", { name: /Open Inbox surface/i }).first().click();
  await expect(page.getByRole("region", { name: "Inbox workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Open History surface" }).click();
  await expect(page.getByRole("region", { name: "History workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Open Work surface" }).click();
  await expect(page.getByTestId("desk-runtime-surface")).toBeVisible();
  await expectSameNode(tileBefore, tile, "terminal tile changed across surfaces");
  await expectSameNode(hostBefore, host, "xterm host changed across surfaces");
  await expectSameNode(screenBefore, screen, "xterm screen changed across surfaces");
  await expect(host).toContainText(marker);

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(2);
  await expectSameNode(hostBefore, host, "xterm host changed in Focus");

  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.getByRole("button", { name: "Split", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(1);
  await expectSameNode(hostBefore, host, "xterm host changed in Split");

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByRole("button", { name: "Grid", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-testid="terminal-tile"][aria-hidden="true"]')).toHaveCount(0);
  await expectSameNode(hostBefore, host, "xterm host changed in Grid");
  await expect(host).toContainText(marker);

  const initialGeometry = await readGeometry(page);
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) throw new Error("Electron window is missing.");
    window.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });
  await expect.poll(async () => (await readGeometry(page)).documentOverflow).toBeLessThanOrEqual(0);
  const narrowGeometry = await readGeometry(page);
  await testInfo.attach("terminal-geometry.json", {
    body: Buffer.from(`${JSON.stringify({ initialGeometry, narrowGeometry }, null, 2)}\n`),
    contentType: "application/json",
  });
  assertGeometry(initialGeometry);
  assertGeometry(narrowGeometry);
  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
});

async function requiredHandle(locator: Locator, label: string): Promise<ElementHandle<HTMLElement>> {
  const handle = await locator.elementHandle();
  if (!handle) throw new Error(`${label} is not mounted.`);
  return handle as ElementHandle<HTMLElement>;
}

async function expectSameNode(
  before: ElementHandle<HTMLElement>,
  current: Locator,
  message: string,
): Promise<void> {
  const after = await requiredHandle(current, message);
  const same = await before.evaluate(
    (node, currentNode) => node.isSameNode(currentNode) && node.isConnected,
    after,
  );
  expect(same, message).toBe(true);
}

async function readGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="desk-runtime-surface"]');
    const surface = document.querySelector('[data-testid="workbench-surface"]');
    const tile = document.querySelector('[data-testid="terminal-tile"]:not([aria-hidden="true"])');
    const host = tile?.querySelector('[data-testid="xterm-host"]');
    if (!(stage instanceof HTMLElement) || !(surface instanceof HTMLElement) ||
        !(tile instanceof HTMLElement) || !(host instanceof HTMLElement)) {
      throw new Error("Core geometry nodes are missing.");
    }
    const stageRect = stage.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      stageHeightDelta: Math.abs(stageRect.height - surfaceRect.height),
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      tileBottomOverflow: tileRect.bottom - stageRect.bottom,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

function assertGeometry(geometry: Awaited<ReturnType<typeof readGeometry>>): void {
  const evidence = `geometry: ${JSON.stringify(geometry)}`;
  expect(geometry.stageHeightDelta, evidence).toBeLessThanOrEqual(2);
  expect(geometry.hostWidth).toBeGreaterThan(0);
  expect(geometry.hostHeight).toBeGreaterThan(0);
  expect(geometry.tileBottomOverflow).toBeLessThanOrEqual(2);
  expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
}
