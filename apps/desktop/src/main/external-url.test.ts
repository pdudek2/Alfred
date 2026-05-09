import { describe, expect, it, vi } from "vitest";
import { normalizeLocalPreviewUrl, openExternalUrl } from "./external-url.js";

describe("external-url", () => {
  it("accepts localhost preview URLs and normalizes them", () => {
    expect(normalizeLocalPreviewUrl(" http://localhost:4310/path ")).toEqual({
      ok: true,
      url: "http://localhost:4310/path",
    });
    expect(normalizeLocalPreviewUrl("https://127.0.0.1:3000/")).toEqual({
      ok: true,
      url: "https://127.0.0.1:3000/",
    });
    expect(normalizeLocalPreviewUrl("http://[::1]:5173/app")).toEqual({
      ok: true,
      url: "http://[::1]:5173/app",
    });
  });

  it("rejects malformed or non-local URLs", () => {
    expect(normalizeLocalPreviewUrl(null)).toEqual({ ok: false, error: "Invalid preview URL request." });
    expect(normalizeLocalPreviewUrl(" ")).toEqual({ ok: false, error: "No preview URL to open." });
    expect(normalizeLocalPreviewUrl("not a url")).toEqual({
      ok: false,
      error: "Invalid preview URL.",
      url: "not a url",
    });
    expect(normalizeLocalPreviewUrl("https://example.com")).toEqual({
      ok: false,
      error: "Only localhost preview URLs can be opened.",
      url: "https://example.com/",
    });
    expect(normalizeLocalPreviewUrl("file:///tmp/index.html")).toEqual({
      ok: false,
      error: "Only local web preview URLs can be opened.",
      url: "file:///tmp/index.html",
    });
  });

  it("opens accepted URLs externally", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);

    await expect(openExternalUrl({ url: "http://localhost:4310" }, { openExternal })).resolves.toEqual({
      ok: true,
      url: "http://localhost:4310/",
    });
    expect(openExternal).toHaveBeenCalledWith("http://localhost:4310/");
  });
});
