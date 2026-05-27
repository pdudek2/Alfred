import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePreviewPanel } from "./WorkspacePreviewPanel";

describe("WorkspacePreviewPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an offline state when a detected preview URL no longer responds", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WorkspacePreviewPanel
        candidates={[
          {
            id: "A:http://127.0.0.1:5173/",
            workspaceId: "A",
            url: "http://127.0.0.1:5173/",
            sessionId: "dev",
            sessionTitle: "Dev server",
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ]}
        refreshKey={0}
        selectedUrl="http://127.0.0.1:5173/"
        workspaceLabel="Alfred"
        onCopyUrl={vi.fn()}
        onOpenExternal={vi.fn()}
        onRefresh={vi.fn()}
        onSelectUrl={vi.fn()}
      />,
    );

    expect(await screen.findByText("Preview offline")).toBeInTheDocument();
    expect(screen.getByText("Start or restart the local dev server for this workspace.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/",
      expect.objectContaining({ mode: "no-cors", cache: "no-store" }),
    );
  });
});
