import { describe, expect, it, vi } from "vitest";
import {
  configureTrustedIpc,
  blocksPrivateRequest,
  isPageFrameEscape,
  isPrivateNetworkUrl,
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

  it("keeps a listener's exception inside the main process and logs it", () => {
    const entry = "http://127.0.0.1:4310/";
    const mainFrame = { url: entry };
    const contents = { mainFrame, once: vi.fn() };
    configureTrustedIpc(contents as never, entry);
    trustedIpc.on("failing", () => {
      throw new Error("malformed message");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => handlers.send.get("failing")?.({ sender: contents, senderFrame: mainFrame })).not.toThrow();
    expect(logged).toHaveBeenCalledWith("Alfred ignored a failing failing message.", expect.any(Error));
    logged.mockRestore();
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

  it("keeps a page frame on its own srcdoc and leaves frames inside Preview alone", () => {
    const page = { frameOrigin: "null", parentIsMainFrame: true };
    expect(isPageFrameEscape({ ...page, url: "http://127.0.0.1:4310/x" })).toBe(true);
    expect(isPageFrameEscape({ ...page, url: "https://example.com/" })).toBe(true);
    expect(isPageFrameEscape({ ...page, url: "about:srcdoc" })).toBe(false);
    expect(isPageFrameEscape({ ...page, url: "about:blank" })).toBe(false);
    expect(isPageFrameEscape({ frameOrigin: "null", parentIsMainFrame: false, url: "http://127.0.0.1:5173/" })).toBe(false);
    expect(isPageFrameEscape({ frameOrigin: "http://localhost:5173", parentIsMainFrame: true, url: "http://localhost:5173/a" })).toBe(false);
    // A PDF's frame holds a blob of Alfred's own origin: it may show another PDF, never a link's target.
    const pdf = { frameOrigin: "file://", frameUrl: "blob:file:///a1b2", parentIsMainFrame: true };
    expect(isPageFrameEscape({ ...pdf, url: "https://example.com/" })).toBe(true);
    expect(isPageFrameEscape({ ...pdf, url: "file:///etc/hosts" })).toBe(true);
    expect(isPageFrameEscape({ ...pdf, url: "blob:file:///c3d4" })).toBe(false);
  });

  it("keeps a page's subresources, and any whose frame is unknown, off private hosts; Alfred and Preview keep theirs", () => {
    const request = (url: string, frame: { isMain: boolean; origin: string } | null, resourceType = "xhr") =>
      blocksPrivateRequest({ url, resourceType, frame, trustedEntryUrls: ["http://127.0.0.1:4310/"] });
    const page = { isMain: false, origin: "null" };
    expect(request("https://127.0.0.1:8443/x", page)).toBe(true);
    expect(request("https://192.168.1.10/x", page, "image")).toBe(true);
    // Electron could not name the frame, as for some of a page's requests on a loaded machine.
    expect(request("https://localhost:8443/x", null, "image")).toBe(true);
    expect(request("https://cdn.jsdelivr.net/x.js", page, "script")).toBe(false);
    expect(request("http://localhost:5173/app.js", { isMain: false, origin: "http://localhost:5173" }, "script")).toBe(false);
    expect(request("http://127.0.0.1:4310/assets/app.js", { isMain: true, origin: "http://127.0.0.1:4310" }, "script")).toBe(false);
    // Alfred's own dev server, whatever frame Electron reports.
    expect(request("ws://127.0.0.1:4310/", null, "webSocket")).toBe(false);
    // Navigations go through their own guards.
    expect(request("http://localhost:5173/", null, "subFrame")).toBe(false);
  });

  it("tells addresses on this Mac or its network from public ones, whatever the scheme or spelling", () => {
    for (const url of [
      "https://127.0.0.1:8443/", "https://127.9.9.9/", "wss://10.1.2.3/", "https://172.16.0.1/", "https://172.31.255.255/",
      "https://192.168.100.100/", "https://169.254.169.254/", "https://100.64.0.1/", "https://0.0.0.0/", "https://0x7f.1/",
      "https://2130706433/", "https://[::1]/", "https://[::]/", "https://[fc00::1]/", "https://[fd12:3456::1]/", "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/", "https://[::ffff:192.168.1.1]/", "https://localhost/", "https://LOCALHOST./",
      "https://app.localhost/", "https://printer.local/",
    ]) expect(isPrivateNetworkUrl(url), url).toBe(true);
    for (const url of [
      "https://cdn.jsdelivr.net/x.js", "https://8.8.8.8/", "https://172.32.0.1/", "https://172.15.0.1/", "https://100.128.0.1/",
      "https://192.169.0.1/", "https://[2606:4700::1111]/", "https://[::ffff:8.8.8.8]/", "https://localhost.example.com/",
      "about:srcdoc", "data:text/plain,x", "not a url",
    ]) expect(isPrivateNetworkUrl(url), url).toBe(false);
  });
});
