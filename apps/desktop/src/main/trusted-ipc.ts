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
export function isPageFrameEscape(navigation: { url: string; frameOrigin: string | undefined; parentIsMainFrame: boolean }): boolean {
  return navigation.parentIsMainFrame && navigation.frameOrigin === "null"
    && navigation.url !== "about:srcdoc" && navigation.url !== "about:blank";
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
