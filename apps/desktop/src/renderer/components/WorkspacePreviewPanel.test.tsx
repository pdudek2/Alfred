import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        onClose={vi.fn()}
        onCopyUrl={vi.fn()}
        onOpenExternal={vi.fn()}
        onRefresh={vi.fn()}
        onSelectUrl={vi.fn()}
      />,
    );

    expect(await screen.findByText("Preview is offline")).toBeInTheDocument();
    expect(screen.getByText("The local app is no longer responding.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/",
      expect.objectContaining({ mode: "no-cors", cache: "no-store" }),
    );
  });

  it("keeps Open and Close visible while moving refresh and copy into a quiet menu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const onClose = vi.fn();
    const onCopyUrl = vi.fn();
    const onOpenExternal = vi.fn();
    const onRefresh = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkspacePreviewPanel
        candidates={[
          {
            id: "A:http://127.0.0.1:5173/forecast",
            workspaceId: "A",
            url: "http://127.0.0.1:5173/forecast",
            sessionId: "dev",
            sessionTitle: "Responsive forecast",
            firstSeenAt: 1,
            lastSeenAt: 1,
          },
        ]}
        refreshKey={0}
        selectedUrl="http://127.0.0.1:5173/forecast"
        workspaceLabel="Chmury_lab04"
        onClose={onClose}
        onCopyUrl={onCopyUrl}
        onOpenExternal={onOpenExternal}
        onRefresh={onRefresh}
        onSelectUrl={vi.fn()}
      />,
    );

    expect(screen.getByText("127.0.0.1:5173/forecast")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open preview externally" }));
    expect(onOpenExternal).toHaveBeenCalledWith("http://127.0.0.1:5173/forecast");

    await user.click(screen.getByRole("button", { name: "More Preview actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy URL" }));
    expect(onCopyUrl).toHaveBeenCalledWith("http://127.0.0.1:5173/forecast");

    await user.click(screen.getByRole("button", { name: "More Preview actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Refresh preview" }));
    expect(onRefresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Close Preview" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
