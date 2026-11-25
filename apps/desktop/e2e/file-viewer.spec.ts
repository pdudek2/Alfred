import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support/electron-app";
import { setWindowSize } from "./support/app-state";

/** A one-page PDF that says `text`. */
function pdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("opens a PDF and screenshots a terminal links to beside it, compares a before/after pair and pastes a path", async ({ harness }) => {
  const { app, page } = harness;
  // Wide enough that the paths stay on one row with the panel open.
  await setWindowSize(app, page, 1900, 1000);
  const dir = await mkdtemp(path.join(os.tmpdir(), "alfred-file-viewer-"));
  // Two 4×2 images, one pixel apart.
  const [before, after] = await app.evaluate(({ nativeImage }) => {
    const bitmap = (changed: boolean) => {
      const pixels = Buffer.alloc(4 * 2 * 4, 255);
      if (changed) pixels.writeUInt32LE(0xff0000ff, 0);
      return nativeImage.createFromBitmap(pixels, { width: 4, height: 2 }).toPNG().toString("base64");
    };
    return [bitmap(false), bitmap(true)];
  });
  await writeFile(path.join(dir, "shot-before.png"), Buffer.from(before, "base64"));
  await writeFile(path.join(dir, "shot-after.png"), Buffer.from(after, "base64"));
  await writeFile(path.join(dir, "report.pdf"), pdf("Audit report"));

  const tile = page.locator('.terminal-tile[data-session-id="manual-1"]');
  const rows = tile.locator(".xterm-rows > div");
  await expect(rows.filter({ hasText: /%\s*$/ }).first()).toBeVisible();
  await tile.locator(".xterm-host").click();
  await page.keyboard.type(`printf '%s\\n' ${dir}/shot-after.png ${dir}/report.pdf`);
  await page.keyboard.press("Enter");
  const row = (name: string) => rows.filter({ hasText: new RegExp(`^${escape(`${dir}/${name}`)}\\s*$`) });
  await expect(row("report.pdf")).toHaveCount(1);

  await commandClick(row("shot-after.png"), page);
  const panel = page.getByRole("region", { name: "File shot-after.png" });
  await expect(panel.getByRole("button", { name: /shot-after\.png, fitted/ })).toBeVisible();
  await panel.getByRole("button", { name: "Compare" }).click();
  await expect(panel.getByRole("combobox", { name: "Compare with" })).toHaveValue(`${dir}/shot-before.png`);
  await expect(panel.getByRole("slider", { name: "Before and after divider" })).toBeVisible();
  await panel.getByRole("group", { name: "Compare mode" }).getByRole("button", { name: "Diff" }).click();
  await expect(panel.getByRole("status")).toHaveText("13% of pixels differ, shown in red.");

  // Paste path: typed at the prompt as a file drop types it, with no Enter.
  await panel.getByRole("button", { name: "Paste path into the terminal" }).click();
  await expect.poll(async () => (await rows.allTextContents()).join("").replace(/\u00a0/g, " ")).toContain(`% ${dir}/shot-after.png`);
  await page.keyboard.press("Control+U");

  await commandClick(row("report.pdf"), page);
  const pdfPanel = page.getByRole("region", { name: "File report.pdf" });
  await expect(pdfPanel.locator("iframe.file-view-pdf")).toBeVisible();
  // Chromium's own viewer loads inside the frame.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.mainFrame.framesInSubtree.some((frame) => frame.url.startsWith("chrome-extension://")))).toBe(true);
  // A link in the document cannot take the PDF's frame anywhere: the frame tries to leave and stays on its blob.
  const urls = await app.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0]!.webContents.mainFrame;
    const frame = main.frames.find((child) => child.url.startsWith("blob:"))!;
    await frame.executeJavaScript('location.href = "https://example.com/"; 1').catch(() => 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return main.frames.map((child) => child.url);
  });
  expect(urls.filter((url) => url.startsWith("blob:"))).toHaveLength(1);
  expect(urls.some((url) => url.includes("example.com"))).toBe(false);

  harness.assertNoRuntimeErrors();
  await harness.closeActiveTerminals();
  await rm(dir, { recursive: true, force: true });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

async function commandClick(row: Locator, page: Page): Promise<void> {
  const box = await row.boundingBox();
  if (!box) throw new Error("Expected the terminal row on screen.");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.keyboard.down("Meta");
  await page.mouse.click(box.x + 12, box.y + box.height / 2);
  await page.keyboard.up("Meta");
}
