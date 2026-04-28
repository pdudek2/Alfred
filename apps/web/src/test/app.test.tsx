import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app";
import { runDetailFixture, runFixture } from "./fixtures";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("project=No+Matches")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.startsWith("/api/v1/runs?")) {
          return new Response(JSON.stringify({ items: [runFixture] }), { status: 200 });
        }
        if (url === "/api/v1/runs/run-1") {
          return new Response(JSON.stringify(runDetailFixture), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders runs and selected timeline", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Alfred" })).toBeInTheDocument();
    expect(await screen.findAllByText("codex-cli")).toHaveLength(2);
    expect(await screen.findByText(/1 loaded · 1 active/i)).toBeInTheDocument();
    expect(await screen.findByText("run.started")).toBeInTheDocument();
    expect(await screen.findByText("tool.started")).toBeInTheDocument();
  });

  it("toggles live updates", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("codex-cli");

    await user.click(screen.getByRole("button", { name: /pause live updates/i }));
    expect(screen.getByLabelText("Sync state")).toHaveTextContent(/paused/i);

    await user.click(screen.getByRole("button", { name: /resume live updates/i }));
    expect(screen.getByLabelText("Sync state")).toHaveTextContent(/live/i);
  });

  it("refreshes runs", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("codex-cli");
    await user.click(screen.getByRole("button", { name: /refresh runs/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/runs?limit=25"));
  });

  it("loads runs with applied filters", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("codex-cli");

    await user.type(screen.getByLabelText(/source/i), "codex-cli");
    await user.selectOptions(screen.getByLabelText(/status/i), "running");
    await user.type(screen.getByLabelText(/project/i), "Alfred Labs");
    await user.type(screen.getByLabelText(/since/i), "2026-04-28");
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/runs?limit=25&source=codex-cli&status=running&project=Alfred+Labs&since=2026-04-28",
      ),
    );
  });

  it("shows a filtered empty state and clears filters", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findAllByText("codex-cli");

    await user.type(screen.getByLabelText(/project/i), "No Matches");
    await user.click(screen.getByRole("button", { name: /apply filters/i }));

    expect(await screen.findByText("No runs match current filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show all runs/i }));

    expect(await screen.findAllByText("codex-cli")).toHaveLength(2);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/v1/runs?limit=25"));
  });

  it("refreshes the selected run detail", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/v1/runs?")) {
        return new Response(JSON.stringify({ items: [runFixture] }), { status: 200 });
      }
      if (url === "/api/v1/runs/run-1") {
        const detail =
          fetchImpl.mock.calls.filter(([request]) => String(request) === "/api/v1/runs/run-1").length > 1
            ? {
                ...runDetailFixture,
                events: [
                  ...runDetailFixture.events,
                  {
                    id: "event-3",
                    event_id: "event-000000000003",
                    source_event_id: "source-event-3",
                    type: "run.completed",
                    status: "completed",
                    occurred_at: "2026-04-28T10:00:03.000Z",
                    payload: { summary: "done" },
                  },
                ],
              }
            : runDetailFixture;

        return new Response(JSON.stringify(detail), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchImpl);
    render(<App />);

    await screen.findByText("tool.started");
    await user.click(screen.getByRole("button", { name: /refresh runs/i }));

    expect(await screen.findByText("run.completed")).toBeInTheDocument();
  });

  it("renders collapsible event payloads with a summary", async () => {
    const user = userEvent.setup();
    render(<App />);

    const summary = await screen.findByText(/tool_name: session/i);
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");

    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(details?.querySelector("pre")?.textContent).toContain("\"tool_name\": \"session\"");
  });

  it("clears stale detail when a newly selected run detail fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/runs?")) {
          return new Response(JSON.stringify({ items: [runFixture, { ...runFixture, id: "run-2" }] }), {
            status: 200,
          });
        }
        if (url === "/api/v1/runs/run-1") {
          return new Response(JSON.stringify(runDetailFixture), { status: 200 });
        }
        if (url === "/api/v1/runs/run-2") {
          return new Response("not found", { status: 404 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(<App />);

    await screen.findByText("tool.started");
    const [, secondRunButton] = screen.getAllByRole("button", { name: /Alfredcodex-clirunning/i });
    await user.click(secondRunButton!);

    expect(await screen.findByText(/Failed to load run: 404/i)).toBeInTheDocument();
    expect(screen.queryByText("tool.started")).not.toBeInTheDocument();
  });
});
