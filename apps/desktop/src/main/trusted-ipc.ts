import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";

let trustedContents: WebContents | null = null;
// The window's renderer entry, and while a reload moves to another release's renderer, that one too.
let trustedEntryUrls: string[] = [];

export function configureTrustedIpc(contents: WebContents, entryUrl: string): void {
  trustedContents = contents;
  trustedEntryUrls = [entryUrl];
  contents.once("destroyed", () => {
    if (trustedContents === contents) trustedContents = null;
  });
}

export function trustedEntries(): readonly string[] {
  return trustedEntryUrls;
}

/** A reload to `next` is under way: both entries stay trusted until it lands or fails. */
export function beginEntrySwitch(next: string): void {
  trustedEntryUrls = [trustedEntryUrls[0] ?? next, next];
}

export function finishEntrySwitch(landed: boolean): void {
  const [current, next] = trustedEntryUrls;
  trustedEntryUrls = [(landed ? next : current) ?? current ?? ""];
}

export function isTrustedEntry(actual: string): boolean {
  return trustedEntryUrls.some((entry) => isTrustedDocumentUrl(actual, entry));
}

export function isTrustedDocumentUrl(actual: string, entryUrl: string): boolean {
  try {
    const document = new URL(actual);
    const entry = new URL(entryUrl);
    return document.protocol === entry.protocol
      && document.host === entry.host
      && document.pathname === entry.pathname
      && document.search === entry.search;
  } catch {
    return false;
  }
}

/**
 * A page an agent wrote runs in a sandboxed frame of the window's main frame, with an opaque origin. It may show its
 * own srcdoc and nothing else: navigating itself is how it would reach a local address its CSP blocks.
 */
export function isPageFrameEscape(navigation: {
  url: string;
  frameOrigin: string | undefined;
  frameUrl?: string | undefined;
  parentIsMainFrame: boolean;
}): boolean {
  if (!navigation.parentIsMainFrame) return false;
  // A PDF beside the terminal is a blob of Alfred's own origin; a link in the document may not take its frame anywhere.
  if (navigation.frameUrl?.startsWith("blob:") && !navigation.url.startsWith("blob:")) return true;
  return navigation.frameOrigin === "null" && navigation.url !== "about:srcdoc" && navigation.url !== "about:blank";
}

/**
 * A URL whose host is this Mac or its local network: loopback, private, link-local, shared and unspecified addresses,
 * and localhost or .local names. The scheme does not matter (wss: passes a CSP's https:).
 * shortcut: a public name that resolves to a private address still passes; resolve the host first if pages ever need it.
 */
export function isPrivateNetworkUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.startsWith("[")) return isPrivateIpv6(host.slice(1, -1));
  const octets = host.split(".");
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet)) && isPrivateIpv4(octets.map(Number));
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127);
}

// `new URL` has already compressed the address and written an IPv4 tail as two hex groups.
function isPrivateIpv6(address: string): boolean {
  const [head = "", tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const words = groups.map((group) => Number.parseInt(group, 16));
  const [first = 0] = words;
  if (words.slice(0, 7).every((word) => word === 0)) return words[7]! <= 1;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isPrivateIpv4([words[6]! >> 8, words[6]! & 0xff]);
  }
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Whether a subresource request from Alfred's window must not reach this Mac or its network. Only a frame known to
 * be Alfred's own (the main frame) or a Preview frame (its server's origin) may; a page's opaque frame may not, and
 * neither may a request whose frame Electron cannot name, which a page's requests on a busy machine can be.
 */
export function blocksPrivateRequest(request: {
  url: string;
  resourceType: string;
  frame: { isMain: boolean; origin: string } | null;
  trustedEntryUrls: readonly string[];
}): boolean {
  // Frame navigations have their own guards (will-frame-navigate and the trusted-entry rule).
  if (request.resourceType === "mainFrame" || request.resourceType === "subFrame") return false;
  if (!isPrivateNetworkUrl(request.url)) return false;
  // Alfred's own dev server, its HMR socket (ws:) included.
  if (request.trustedEntryUrls.some((entry) => sameHost(request.url, entry))) return false;
  return !request.frame || (!request.frame.isMain && request.frame.origin === "null");
}

function sameHost(actual: string, entryUrl: string): boolean {
  try {
    const entry = new URL(entryUrl);
    return /^https?:$/.test(entry.protocol) && new URL(actual).host === entry.host;
  } catch {
    return false;
  }
}

export function isTrustedDocumentOrigin(actual: string, entryUrl: string): boolean {
  try {
    const document = new URL(actual);
    const entry = new URL(entryUrl);
    return document.protocol === entry.protocol && document.host === entry.host;
  } catch {
    return false;
  }
}

export function isTrustedIpcRecipient(contents: WebContents): boolean {
  return trustedContents === contents
    && contents.mainFrame != null
    && isTrustedEntry(contents.mainFrame.url);
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isTrustedIpcRecipient(event.sender)
    && event.senderFrame != null
    && event.senderFrame === event.sender.mainFrame;
}

export const trustedIpc = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error("Untrusted IPC sender.");
      return listener(event, ...args);
    });
  },
  on(channel: string, listener: Parameters<typeof ipcMain.on>[1]): void {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedSender(event)) return;
      // A one-way message has no caller to reject; an exception here would reach Electron's crash dialog.
      try {
        listener(event, ...args);
      } catch (error) {
        console.error(`Alfred ignored a failing ${channel} message.`, error);
      }
    });
  },
};
