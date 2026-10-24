import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewUrlCandidate } from "../preview-state";
import { WorkspacePreviewPanel, type WorkspacePreviewPanelProps } from "./WorkspacePreviewPanel";

function candidate(url: string, sessionTitle = "Dev server"): PreviewUrlCandidate {
  return {
    id: `A:${url}`,
    workspaceId: "A",
    url,
    sessionId: "dev",
    sessionTitle,
    sources: [{ sessionId: "dev", sessionTitle, lastSeenAt: 1 }],
    firstSeenAt: 1,
    lastSeenAt: 1,
  };
}

function panelProps(overrides: Partial<WorkspacePreviewPanelProps> = {}): WorkspacePreviewPanelProps {
  return {
    candidates: [candidate("http://127.0.0.1:5173/")],
    refreshKey: 0,
    selectedUrl: "http://127.0.0.1:5173/",
    onClose: vi.fn(),
    onOpenExternal: vi.fn(),
    onRefresh: vi.fn(),
    onSelectUrl: vi.fn(),
    ...overrides,
  };
}

describe("WorkspacePreviewPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an offline state when a detected preview URL no longer responds", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkspacePreviewPanel {...panelProps()} />);

    expect(await screen.findByText("Preview is offline")).toBeInTheDocument();
    expect(screen.getByText("The local app is no longer responding.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/",
      expect.objectContaining({ mode: "no-cors", cache: "no-store" }),
    );
  });

  it("checks a preview address once, not again each time its candidates are recomputed", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<WorkspacePreviewPanel {...panelProps()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    // Terminal output recomputes the candidates: a new object for the same address.
    rerender(<WorkspacePreviewPanel {...panelProps({ candidates: [candidate("http://127.0.0.1:5173/")] })} />);
    rerender(<WorkspacePreviewPanel {...panelProps({ candidates: [candidate("http://127.0.0.1:5173/")] })} />);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("removes the iframe from focus when a retry goes offline", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const props = panelProps();
    const { rerender } = render(<WorkspacePreviewPanel {...props} />);

    const panel = screen.getByRole("region", { name: "Project preview" });
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByTitle("Preview of http://127.0.0.1:5173/")).toBeInTheDocument();
    rerender(<WorkspacePreviewPanel {...props} refreshKey={1} />);

    expect(await screen.findByText("Preview is offline")).toBeInTheDocument();
    expect(screen.queryByTitle("Preview of http://127.0.0.1:5173/")).not.toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
  });

  it("draws the canvas address row: Reload, the address with its source, and Open in browser", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const onOpenExternal = vi.fn();
    const onRefresh = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkspacePreviewPanel
        {...panelProps({
          candidates: [candidate("http://127.0.0.1:5173/forecast", "Responsive forecast")],
          selectedUrl: "http://127.0.0.1:5173/forecast",
          onOpenExternal,
          onRefresh,
        })}
      />,
    );

    expect(screen.getByText("127.0.0.1:5173/forecast")).toBeInTheDocument();
    expect(screen.getByText("from Responsive forecast")).toBeInTheDocument();
    expect(screen.getByTitle("Preview of http://127.0.0.1:5173/forecast"))
      .toHaveAttribute("sandbox", "allow-forms allow-same-origin allow-scripts");

    await user.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(onOpenExternal).toHaveBeenCalledWith("http://127.0.0.1:5173/forecast");
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(onRefresh).toHaveBeenCalledOnce();

    // The Terminal tab closes Preview; the panel carries no close button or status word of its own.
    expect(screen.queryByRole("button", { name: "Close Preview" })).not.toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
  });

  it("offers a choice in the address row when more than one local app is running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const onSelectUrl = vi.fn();
    const user = userEvent.setup();

    render(
      <WorkspacePreviewPanel
        {...panelProps({
          candidates: [candidate("http://127.0.0.1:5173/"), candidate("http://localhost:4310/", "API docs")],
          onSelectUrl,
        })}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Detected preview URL" }), "http://localhost:4310/");
    expect(onSelectUrl).toHaveBeenCalledWith("http://localhost:4310/");
  });

  it("hands Escape to the owner so the terminal can come back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const onClose = vi.fn();
    render(<WorkspacePreviewPanel {...panelProps({ onClose })} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "Project preview" })).toHaveAttribute("aria-busy", "false"));

    fireEvent.keyDown(screen.getByRole("button", { name: "Reload" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
