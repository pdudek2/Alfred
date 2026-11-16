import { BrowserWindow, session, type NativeImage, type Rectangle } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Charts and diagrams are drawn by the page's scripts after it loads: wait until it stops changing, 3 s at most.
const SETTLED = `new Promise((done) => {
  let quiet;
  const settle = () => { clearTimeout(quiet); quiet = setTimeout(done, 300); };
  new MutationObserver(settle).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  settle();
  setTimeout(done, 3000);
}).then(() => new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted))))`;
const GIVE_UP_MS = 8000;
// An 800×520 page drawn at 2x, so a small diagram cut out of it stays sharp in its Details card.
const ZOOM = 2;
const MARGIN = 12 * ZOOM;
const PARTITION = "alfred-page-snapshot";
const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), "page-snapshot-preload.cjs");
const pagesBeingDrawn = new Map<number, string>();
let pagesGuarded = false;
let drawing: Promise<unknown> = Promise.resolve();

// Electron lets a file:// page read any file Alfred can, and the page has the network for its chart libraries:
// it gets its own file and nothing else local, no local services, no downloads and no permissions.
function guardPages(): void {
  if (pagesGuarded) return;
  pagesGuarded = true;
  const pages = session.fromPartition(PARTITION);
  pages.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith("file:")) {
      const ownFile = details.webContentsId === undefined ? undefined : pagesBeingDrawn.get(details.webContentsId);
      callback({ cancel: filePathOf(details.url) !== ownFile });
      return;
    }
    callback({ cancel: isLocalAddress(hostOf(details.url)) });
  });
  pages.on("will-download", (event) => event.preventDefault());
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Loopback, private and link-local hosts written as such, where Alfred's own services and the user's LAN live.
 * shortcut: a public name that resolves to a private address passes; resolving names first needs a DNS lookup per request.
 */
export function isLocalAddress(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost") || name === "::1" || name === "::" || name === "0.0.0.0") return true;
  if (/^(?:fc|fd|fe[89ab])[0-9a-f]{0,2}:/.test(name)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(name)?.[1];
  const octets = (mapped ?? name).split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet))) return false;
  const [a, b] = octets.map(Number) as [number, number];
  return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * An HTML or SVG file as a browser shows it, scripts run, cut to what it draws, from a hidden window that keeps nothing.
 * Pages are drawn one at a time, in the order asked.
 */
export function pageSnapshot(filePath: string): Promise<NativeImage> {
  const turn = drawing.then(() => drawPage(filePath));
  drawing = turn.catch(() => undefined);
  return turn;
}

async function drawPage(filePath: string): Promise<NativeImage> {
  guardPages();
  const window = new BrowserWindow({
    show: false,
    width: 800 * ZOOM,
    height: 520 * ZOOM,
    useContentSize: true,
    webPreferences: { sandbox: true, partition: PARTITION, zoomFactor: ZOOM, disableDialogs: true, preload: PRELOAD },
  });
  const pageId = window.webContents.id;
  pagesBeingDrawn.set(pageId, filePath);
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  let giveUp: NodeJS.Timeout | undefined;
  // A page that never finishes loading would keep the window, and a call into a destroyed one may never settle.
  const limit = new Promise<never>((_, reject) => {
    giveUp = setTimeout(() => reject(new Error("The page took too long to draw.")), GIVE_UP_MS);
  });
  const draw = (async () => {
    await window.loadFile(filePath);
    await window.webContents.executeJavaScript(SETTLED);
    const page = await window.webContents.capturePage();
    const drawn = page.crop(drawnRect(page.toBitmap(), page.getSize().width, page.getSize().height));
    return drawn.resize({ width: Math.min(640, drawn.getSize().width) });
  })();
  draw.catch(() => undefined);
  try {
    return await Promise.race([draw, limit]);
  } finally {
    clearTimeout(giveUp);
    pagesBeingDrawn.delete(pageId);
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
