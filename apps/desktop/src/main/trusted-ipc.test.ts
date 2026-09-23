import { describe, expect, it, vi } from "vitest";
import {
  configureTrustedIpc,
  isTrustedDocumentOrigin,
  isTrustedDocumentUrl,
  isTrustedIpcRecipient,
  trustedIpc,
} from "./trusted-ipc.js";

const handlers = vi.hoisted(() => ({
  invoke: new Map<string, (event: unknown) => unknown>(),
  send: new Map<string, (event: unknown) => void>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown) => unknown) => handlers.invoke.set(channel, listener),
    on: (channel: string, listener: (event: unknown) => void) => handlers.send.set(channel, listener),
  },
}));

describe("trusted IPC boundary", () => {
  it("rejects IPC before an Alfred window is configured", () => {
    trustedIpc.handle("before-window", vi.fn());
    expect(() => handlers.invoke.get("before-window")?.({ sender: {}, senderFrame: {} }))
      .toThrow("Untrusted IPC sender.");
  });

  it("accepts only the current Alfred entrypoint in the main frame", () => {
    const entry = "http://127.0.0.1:4310/?alfred-window-material=native";
    const mainFrame = { url: entry };
    const contents = { mainFrame, once: vi.fn() };
    configureTrustedIpc(contents as never, entry);
    const invoked = vi.fn(() => "allowed");
    const sent = vi.fn();
    trustedIpc.handle("invoke", invoked);
    trustedIpc.on("send", sent);

    const trustedEvent = { sender: contents, senderFrame: mainFrame };
    expect(isTrustedIpcRecipient(contents as never)).toBe(true);
    expect(handlers.invoke.get("invoke")?.(trustedEvent)).toBe("allowed");
    handlers.send.get("send")?.(trustedEvent);
    expect(invoked).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledOnce();

    const rejected = [
      { sender: contents, senderFrame: { url: entry } }, // subframe, even at the entry URL
      { sender: { mainFrame }, senderFrame: mainFrame },
      { sender: contents, senderFrame: null },
    ];
    for (const event of rejected) {
      expect(() => handlers.invoke.get("invoke")?.(event)).toThrow("Untrusted IPC sender.");
      handlers.send.get("send")?.(event);
    }
    expect(invoked).toHaveBeenCalledOnce();
    expect(sent).toHaveBeenCalledOnce();

    mainFrame.url = "http://127.0.0.1:9999/";
    expect(isTrustedIpcRecipient(contents as never)).toBe(false);
    expect(() => handlers.invoke.get("invoke")?.(trustedEvent)).toThrow("Untrusted IPC sender.");
    mainFrame.url = entry;
    expect(isTrustedIpcRecipient(contents as never)).toBe(true);
    expect(handlers.invoke.get("invoke")?.(trustedEvent)).toBe("allowed");

    const onDestroyed = contents.once.mock.calls.find(([name]) => name === "destroyed")?.[1] as (() => void) | undefined;
    onDestroyed?.();
    expect(isTrustedIpcRecipient(contents as never)).toBe(false);
    expect(() => handlers.invoke.get("invoke")?.(trustedEvent)).toThrow("Untrusted IPC sender.");
  });

  it("matches the exact packaged file and ignores only its hash", () => {
    const entry = "file:///Applications/Alfred.app/Contents/Resources/app/renderer/index.html";
    expect(isTrustedDocumentUrl(`${entry}#work`, entry)).toBe(true);
    expect(isTrustedDocumentUrl("file:///tmp/index.html", entry)).toBe(false);
    expect(isTrustedDocumentUrl("http://127.0.0.1:4310/other", "http://127.0.0.1:4310/")).toBe(false);
    expect(isTrustedDocumentUrl("http://127.0.0.1:9999/", "http://127.0.0.1:4310/")).toBe(false);
    expect(isTrustedDocumentOrigin("http://127.0.0.1:4310/other", "http://127.0.0.1:4310/")).toBe(true);
    expect(isTrustedDocumentOrigin("http://127.0.0.1:4311/", "http://127.0.0.1:4310/")).toBe(false);
  });
});
