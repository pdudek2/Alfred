import { describe, expect, it, vi } from "vitest";
import { drawnRect, isLocalAddress } from "./page-snapshot";

vi.mock("electron", () => ({ BrowserWindow: {} }));

function bitmap(width: number, height: number, drawn: Array<[number, number, number]>): Buffer {
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (const [x, y, level] of drawn) pixels.fill(level, (y * width + x) * 4, (y * width + x) * 4 + 3);
  return pixels;
}

describe("drawnRect", () => {
  it("cuts a page to what it draws, with a margin kept inside the page", () => {
    expect(drawnRect(bitmap(200, 100, [[60, 30, 0], [90, 40, 0]]), 200, 100)).toEqual({ x: 36, y: 6, width: 79, height: 59 });
    expect(drawnRect(bitmap(200, 100, [[2, 3, 0], [199, 99, 0]]), 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("keeps the whole page when nothing stands out from its background", () => {
    // A level a few steps off is antialiasing, not drawing.
    expect(drawnRect(bitmap(50, 40, [[10, 10, 250]]), 50, 40)).toEqual({ x: 0, y: 0, width: 50, height: 40 });
  });
});

describe("isLocalAddress", () => {
  it("names loopback, private and link-local hosts and lets the rest of the network through", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.8.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1",
      "172.31.255.255", "192.168.1.10", "169.254.169.254", "[::1]", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1",
      "LOCALHOST."]) {
      expect(isLocalAddress(host), host).toBe(true);
    }
    for (const host of ["cdn.jsdelivr.net", "172.32.0.1", "192.169.0.1", "8.8.8.8", "2606:4700::1111", "fc.example.com", ""]) {
      expect(isLocalAddress(host), host).toBe(false);
    }
  });
});
