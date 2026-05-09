import { describe, expect, it } from "vitest";
import {
  extractLocalPreviewUrls,
  mergePreviewUrlCandidates,
  normalizeLocalPreviewUrl,
  previewUrlCandidatesFromText,
  recordPreviewUrlsFromText,
  type PreviewUrlCandidate,
} from "./preview-state";

describe("preview-state", () => {
  it("extracts local http preview URLs and trims terminal punctuation", () => {
    expect(
      extractLocalPreviewUrls(
        "Local: http://localhost:5173, network: http://127.0.0.1:3000/path). ipv6: http://[::1]:8080/app?ready=true]",
      ),
    ).toEqual([
      "http://localhost:5173/",
      "http://127.0.0.1:3000/path",
      "http://[::1]:8080/app?ready=true",
    ]);
  });

  it("rejects non-local and non-http URLs", () => {
    expect(
      extractLocalPreviewUrls(
        [
          "https://localhost:5173",
          "http://example.com:5173",
          "http://localhost.evil.test:5173",
          "http://127.0.0.2:5173",
          "http://0.0.0.0:5173",
        ].join(" "),
      ),
    ).toEqual([]);
  });

  it("keeps IPv6 host brackets while trimming punctuation around them", () => {
    expect(normalizeLocalPreviewUrl("http://[::1]:5173.")).toBe("http://[::1]:5173/");
    expect(normalizeLocalPreviewUrl("http://[::1]")).toBe("http://[::1]/");
  });

  it("deduplicates URLs extracted from a single terminal observation", () => {
    expect(
      previewUrlCandidatesFromText({
        workspaceId: "workspace-a",
        sessionId: "session-a",
        sessionTitle: "Dev server",
        text: "http://localhost:5173 http://localhost:5173/",
        seenAt: 100,
      }),
    ).toEqual([
      {
        id: "workspace-a:http://localhost:5173/",
        workspaceId: "workspace-a",
        url: "http://localhost:5173/",
        sessionId: "session-a",
        sessionTitle: "Dev server",
        firstSeenAt: 100,
        lastSeenAt: 100,
      },
    ]);
  });

  it("merges by workspace and URL with the latest session metadata", () => {
    const existing: PreviewUrlCandidate[] = [
      candidate({
        workspaceId: "workspace-a",
        url: "http://localhost:5173/",
        sessionId: "old-session",
        sessionTitle: "Old server",
        firstSeenAt: 10,
        lastSeenAt: 50,
      }),
      candidate({
        workspaceId: "workspace-b",
        url: "http://localhost:5173/",
        sessionId: "other-workspace-session",
        sessionTitle: "Other workspace",
        firstSeenAt: 20,
        lastSeenAt: 60,
      }),
    ];

    expect(
      mergePreviewUrlCandidates(existing, [
        candidate({
          workspaceId: "workspace-a",
          url: "http://localhost:5173/",
          sessionId: "new-session",
          sessionTitle: "New server",
          firstSeenAt: 90,
          lastSeenAt: 90,
        }),
      ]),
    ).toEqual([
      candidate({
        workspaceId: "workspace-a",
        url: "http://localhost:5173/",
        sessionId: "new-session",
        sessionTitle: "New server",
        firstSeenAt: 10,
        lastSeenAt: 90,
      }),
      candidate({
        workspaceId: "workspace-b",
        url: "http://localhost:5173/",
        sessionId: "other-workspace-session",
        sessionTitle: "Other workspace",
        firstSeenAt: 20,
        lastSeenAt: 60,
      }),
    ]);
  });

  it("does not let older observations overwrite newer session metadata", () => {
    const existing = [
      candidate({
        workspaceId: "workspace-a",
        url: "http://localhost:5173/",
        sessionId: "new-session",
        sessionTitle: "New server",
        firstSeenAt: 10,
        lastSeenAt: 100,
      }),
    ];

    expect(
      mergePreviewUrlCandidates(existing, [
        candidate({
          workspaceId: "workspace-a",
          url: "http://localhost:5173/",
          sessionId: "old-session",
          sessionTitle: "Old server",
          firstSeenAt: 5,
          lastSeenAt: 50,
        }),
      ]),
    ).toEqual([
      candidate({
        workspaceId: "workspace-a",
        url: "http://localhost:5173/",
        sessionId: "new-session",
        sessionTitle: "New server",
        firstSeenAt: 5,
        lastSeenAt: 100,
      }),
    ]);
  });

  it("orders candidates deterministically by lastSeenAt descending", () => {
    expect(
      mergePreviewUrlCandidates([], [
        candidate({ workspaceId: "workspace-b", url: "http://localhost:3000/", lastSeenAt: 100 }),
        candidate({ workspaceId: "workspace-a", url: "http://localhost:4000/", lastSeenAt: 200 }),
        candidate({ workspaceId: "workspace-a", url: "http://localhost:3000/", lastSeenAt: 100 }),
      ]),
    ).toEqual([
      candidate({ workspaceId: "workspace-a", url: "http://localhost:4000/", lastSeenAt: 200 }),
      candidate({ workspaceId: "workspace-a", url: "http://localhost:3000/", lastSeenAt: 100 }),
      candidate({ workspaceId: "workspace-b", url: "http://localhost:3000/", lastSeenAt: 100 }),
    ]);
  });

  it("returns the same array for renderer state updates when no preview URL is found", () => {
    const existing = [candidate({ workspaceId: "workspace-a", url: "http://localhost:5173/" })];

    expect(
      recordPreviewUrlsFromText(existing, {
        workspaceId: "workspace-a",
        sessionId: "session-a",
        sessionTitle: "Dev server",
        text: "ready on http://example.com",
        seenAt: 100,
      }),
    ).toBe(existing);
  });

  it("extracts URLs from ANSI-colored terminal output", () => {
    expect(extractLocalPreviewUrls("\u001B[32mhttp://localhost:5173\u001B[0m")).toEqual([
      "http://localhost:5173/",
    ]);
  });

  it("stops at a literal backslash delimiter from escaped terminal transcripts", () => {
    expect(extractLocalPreviewUrls("Local: http://localhost:5173/\\n")).toEqual(["http://localhost:5173/"]);
  });
});

function candidate(overrides: Partial<PreviewUrlCandidate>): PreviewUrlCandidate {
  const workspaceId = overrides.workspaceId ?? "workspace-a";
  const url = overrides.url ?? "http://localhost:5173/";

  return {
    id: `${workspaceId}:${url}`,
    workspaceId,
    url,
    sessionId: overrides.sessionId ?? "session-a",
    sessionTitle: overrides.sessionTitle ?? "Dev server",
    firstSeenAt: overrides.firstSeenAt ?? overrides.lastSeenAt ?? 0,
    lastSeenAt: overrides.lastSeenAt ?? overrides.firstSeenAt ?? 0,
  };
}
