import { BrowserWindow, session, type NativeImage, type Rectangle } from "electron";
import { fileURLToPath } from "node:url";

export const PAGE_PATH = /\.(?:svg|html?)$/i;

// Charts and diagrams are drawn by the page's scripts after it loads: wait until it stops changing, 3 s at most.
const SETTLED = `new Promise((done) => {
  let quiet;
  const settle = () => { clearTimeout(quiet); quiet = setTimeout(done, 300); };
  new MutationObserver(settle).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  settle();
  setTimeout(done, 3000);
}).then(() => new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted))))`;
const GIVE_UP_MS = 8000;
// An 800×520 page drawn at 2x, so a small diagram cut out of it stays sharp in the hover card.
const ZOOM = 2;
const MARGIN = 12 * ZOOM;
const PARTITION = "alfred-page-snapshot";
const pagesBeingDrawn = new Set<string>();
let pagesGuarded = false;

// Electron lets a file:// page read any file Alfred can, and the page has the network for its chart libraries:
// it gets its own file and nothing else local.
function guardPages(): void {
  if (pagesGuarded) return;
  pagesGuarded = true;
  const pages = session.fromPartition(PARTITION);
  pages.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url.startsWith("file:") && !pagesBeingDrawn.has(filePathOf(details.url)) });
  });
  pages.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  pages.setPermissionCheckHandler(() => false);
}

function filePathOf(url: string): string {
  try {
    return fileURLToPath(url);
  } catch {
    return "";
  }
}

/** An HTML or SVG file as a browser shows it, scripts run, cut to what it draws, from a hidden window that keeps nothing. */
export async function pageSnapshot(filePath: string): Promise<NativeImage> {
  guardPages();
  pagesBeingDrawn.add(filePath);
  const window = new BrowserWindow({
    show: false,
    width: 800 * ZOOM,
    height: 520 * ZOOM,
    useContentSize: true,
    webPreferences: { sandbox: true, partition: PARTITION, zoomFactor: ZOOM },
  });
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  // A page that never finishes loading would keep the window.
  const giveUp = setTimeout(() => window.destroy(), GIVE_UP_MS);
  try {
    await window.loadFile(filePath);
    await window.webContents.executeJavaScript(SETTLED);
    const page = await window.webContents.capturePage();
    const drawn = page.crop(drawnRect(page.toBitmap(), page.getSize().width, page.getSize().height));
    return drawn.resize({ width: Math.min(640, drawn.getSize().width) });
  } finally {
    clearTimeout(giveUp);
    pagesBeingDrawn.delete(filePath);
    if (!window.isDestroyed()) window.destroy();
  }
}

/** Where a 4-byte-per-pixel bitmap differs from its top-left pixel, with a margin; all of it when nowhere does. */
export function drawnRect(bitmap: Buffer, width: number, height: number): Rectangle {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      // Antialiasing and colour management leave the background a few levels off.
      const differs = Math.abs(bitmap[at]! - bitmap[0]!) > 8
        || Math.abs(bitmap[at + 1]! - bitmap[1]!) > 8
        || Math.abs(bitmap[at + 2]! - bitmap[2]!) > 8;
      if (!differs) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return { x: 0, y: 0, width, height };
  const x = Math.max(0, left - MARGIN);
  const y = Math.max(0, top - MARGIN);
  return { x, y, width: Math.min(width, right + MARGIN + 1) - x, height: Math.min(height, bottom + MARGIN + 1) - y };
}
