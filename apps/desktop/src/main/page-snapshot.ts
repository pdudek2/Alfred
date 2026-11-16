// Runs in the page drawing process (page-snapshot-worker.ts), never in Alfred's own main process.
import { BrowserWindow, session, type Rectangle } from "electron";
import { isIPv4, isIPv6 } from "node:net";
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
    const host = hostOf(details.url);
    // data: and blob: carry what the page already has.
    if (!host) return callback({});
    if (isLocalAddress(host) || isIPv4(host) || isIPv6(host.replace(/^\[|\]$/g, ""))) {
      return callback({ cancel: isLocalAddress(host) });
    }
    // A public name can point at a local address (localtest.me is 127.0.0.1); one that does not resolve is not fetched.
    // shortcut: a name whose answer changes between this lookup and the connection (DNS rebinding) passes; closing
    // that needs a proxy that connects to the address it checked.
    pages.resolveHost(host).then(
      ({ endpoints }) => callback({ cancel: endpoints.length === 0 || endpoints.some(({ address }) => isLocalAddress(address)) }),
      () => callback({ cancel: true }),
    );
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
 * A host or address where Alfred's own services and the user's LAN live: loopback, private, shared, link-local,
 * multicast and reserved addresses, in every way an IPv6 address can carry an IPv4 one. A name is not looked up here.
 */
export function isLocalAddress(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (isIPv4(name)) return isLocalIPv4(name.split(".").map(Number));
  if (!isIPv6(name)) return false;
  const groups = ipv6Groups(name);
  const [first = 0, second = 0] = groups;
  if (groups.every((group) => group === 0) || groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return true;
  const carriesIPv4 = groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0 || groups[5] === 0xffff)
    || first === 0x64 && second === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  const [high = 0, low = 0] = groups.slice(6);
  return carriesIPv4 && isLocalIPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
}

function isLocalIPv4([a = 0, b = 0, c = 0]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
}

/** The eight 16-bit groups of a valid IPv6 address, "::" filled in and a trailing dotted IPv4 split in two. */
function ipv6Groups(address: string): number[] {
  const parts = (text: string): number[] => text === "" ? [] : text.split(":").flatMap((part) => {
    if (!part.includes(".")) return [parseInt(part, 16)];
    const [a = 0, b = 0, c = 0, d = 0] = part.split(".").map(Number);
    return [(a << 8) | b, (c << 8) | d];
  });
  const gap = address.indexOf("::");
  if (gap < 0) return parts(address);
  const head = parts(address.slice(0, gap));
  const tail = parts(address.slice(gap + 2));
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** An HTML or SVG file as a browser shows it, scripts run, cut to what it draws, as PNG, from a hidden window that keeps nothing. */
export async function drawPage(filePath: string): Promise<Buffer> {
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
  // WebRTC would reach the LAN without a request the session sees.
  window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
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
    return drawn.resize({ width: Math.min(640, drawn.getSize().width) }).toPNG();
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
