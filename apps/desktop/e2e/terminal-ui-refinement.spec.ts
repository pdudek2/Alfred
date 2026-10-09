import { expect, test } from "./support/electron-app";

test("terminal identity marks stay visible and the deck keeps one terminal beside the stack", async ({ harness }, testInfo) => {
  const { app, page } = harness;
  await addSession(page, "New Codex session");
  await addSession(page, "New Claude session");

  const tiles = page.getByTestId("terminal-tile");
  await expect(tiles).toHaveCount(3);
  // The focused tile shows its mark; the other two wait in the stack and keep theirs while hidden.
  await expect(page.locator(".terminal-tile .tile-kind-mark.claude .kind-brand-icon")).toBeVisible();
  await expect(page.locator(".terminal-tile .tile-kind-mark.codex .kind-brand-icon")).toBeAttached();

  const manualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  await page.getByRole("complementary", { name: /^Other sessions in / }).locator('[data-session-id="manual-1"]').click();
  await expect(manualTile).not.toHaveAttribute("aria-hidden", "true");
  const manualInput = manualTile.getByRole("textbox", { name: "Terminal input" });
  await manualInput.fill("codex");
  await manualInput.press("Enter");
  await expect(manualTile.locator(".tile-kind-mark.codex .kind-brand-icon")).toBeVisible();
  await expect.poll(() => tiles.evaluateAll(
    (nodes) => nodes.every((node) => node.classList.contains("ready")),
  )).toBe(true);
  await expect(manualTile).toHaveClass(/selected/);

  for (const [width, height] of [[1120, 720], [1686, 980]] as const) {
    await app.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...bounds });
    }, { width, height });
    await expect(page.locator('[data-testid="terminal-tile"]:visible')).toHaveCount(1);
    const [focus] = await tileGeometry(page.locator('[data-testid="terminal-tile"]:visible'));
    const stackBox = await page.getByRole("complementary", { name: /^Other sessions in / }).boundingBox();
    expect(stackBox).not.toBeNull();
    expect(stackBox!.width).toBeGreaterThanOrEqual(259);
    expect(focus!.left + focus!.width).toBeLessThanOrEqual(stackBox!.x);
    expect(focus!.width).toBeGreaterThan(stackBox!.width);
    expect(focus!.scrollWidth).toBeLessThanOrEqual(focus!.clientWidth);
    await page.screenshot({ path: testInfo.outputPath(`terminal-identities-deck-${width}x${height}.png`) });
  }
});

test("scrolls the focused terminal, not the deck column, under the wheel", async ({ harness }) => {
  const { app, page } = harness;
  const terminalTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  const input = terminalTile.getByRole("textbox", { name: "Terminal input" });
  await input.fill("seq 1 240");
  await input.press("Enter");

  const host = terminalTile.getByTestId("xterm-host");
  await expect(host).toContainText("240");
  const initialTerminalRowCount = await host.locator(".xterm-rows > div").count();
  expect(initialTerminalRowCount).toBeGreaterThan(0);
  for (let index = 0; index < 5; index += 1) {
    await addSession(page, "New manual terminal");
  }
  await page.getByRole("complementary", { name: /^Other sessions in / }).locator('[data-session-id="manual-1"]').click();
  await expect(terminalTile).not.toHaveAttribute("aria-hidden", "true");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1120, height: 720 });
  });

  const screen = host.locator(".xterm-screen");
  const column = page.locator(".terminal-grid-column");
  const slider = host.locator(".scrollbar.vertical .slider");
  await column.evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
  await expect.poll(async () => {
    const [screenBounds, columnBounds] = await Promise.all([screen.boundingBox(), column.boundingBox()]);
    if (!screenBounds || !columnBounds) return false;
    return screenBounds.y >= columnBounds.y && screenBounds.y < columnBounds.y + columnBounds.height;
  }).toBe(true);
  await expect.poll(() => host.locator(".xterm-rows > div").count()).toBeLessThan(initialTerminalRowCount);
  await screen.hover();

  const terminalPositionBeforeHistoryScroll = await slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  );
  await page.mouse.wheel(0, -10_000);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
  await expect.poll(() => slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  )).not.toBe(terminalPositionBeforeHistoryScroll);
  const terminalHistoryPosition = await slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  );

  let terminalBottomPosition = terminalHistoryPosition;
  await expect.poll(async () => {
    const positionBeforeWheel = await slider.evaluate(
      (element) => Number.parseFloat((element as HTMLElement).style.top),
    );
    await page.mouse.wheel(0, 120);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    terminalBottomPosition = await slider.evaluate(
      (element) => Number.parseFloat((element as HTMLElement).style.top),
    );
    return terminalBottomPosition === positionBeforeWheel;
  }, { intervals: [16] }).toBe(true);
  expect(terminalBottomPosition).toBeGreaterThan(terminalHistoryPosition);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);

  await page.mouse.wheel(0, 120);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await slider.evaluate(
    (element) => Number.parseFloat((element as HTMLElement).style.top),
  )).toBe(terminalBottomPosition);

  await terminalTile.locator(".tile-header").hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBe(0);
});

test("manual terminal adopts the Claude runtime identity", async ({ harness }, testInfo) => {
  const { page } = harness;
  const manualTile = page.locator('[data-testid="terminal-tile"][data-session-id="manual-1"]');
  const manualInput = manualTile.getByRole("textbox", { name: "Terminal input" });

  await manualInput.fill("claude");
  await manualInput.press("Enter");

  await expect(manualTile.locator(".tile-kind-mark.claude .kind-brand-icon")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("manual-claude-runtime-identity.png") });
});

async function addSession(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New session", exact: true });
  await expect(sheet).toBeVisible();
  const kind = name.includes("Codex") ? /^Codex/ : name.includes("Claude") ? /^Claude/ : /^Terminal/;
  const radio = sheet.getByRole("radio", { name: kind });
  await radio.click();
  await expect(radio).toBeChecked();
  await sheet.getByRole("button", { name: "Start", exact: true }).click();
}

async function tileGeometry(tiles: import("@playwright/test").Locator) {
  return tiles.evaluateAll((nodes) => nodes.map((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      scrollWidth: element.scrollWidth,
      top: Math.round(rect.top),
      width: Math.round(rect.width),
    };
  }));
}
