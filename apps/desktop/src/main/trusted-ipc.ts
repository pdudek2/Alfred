import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";

let trustedContents: WebContents | null = null;
let trustedEntryUrl = "";

export function configureTrustedIpc(contents: WebContents, entryUrl: string): void {
  trustedContents = contents;
  trustedEntryUrl = entryUrl;
  contents.once("destroyed", () => {
    if (trustedContents === contents) trustedContents = null;
  });
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
    && isTrustedDocumentUrl(contents.mainFrame.url, trustedEntryUrl);
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
      if (isTrustedSender(event)) listener(event, ...args);
    });
  },
};
