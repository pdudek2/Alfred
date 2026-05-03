import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../app";
import { runDetailFixture, runFixture } from "./fixtures";

describe("App (new shell)", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/runs?")) {
          return new Response(JSON.stringify({ items: [runFixture] }), { status: 200 });
        }
        if (url === "/api/v1/system/status") {
          return new Response(
            JSON.stringify({
              runner: {
                state: "live",
                seconds_since_last_device_seen: 8,
                seconds_since_last_ingest: 8,
                last_device_seen_at: "2026-04-30T12:00:00.000Z",
                last_ingest_at: "2026-04-30T12:00:00.000Z",
                latest_run_updated_at: "2026-04-30T12:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }
        if (url === "/api/v1/runs/run-1") {
          return new Response(JSON.stringify(runDetailFixture), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    window.history.pushState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("renders the briefing line and feed by default", async () => {
    render(<App />);

    expect(await screen.findByText(/Alfred/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /All/i })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /run feed/i })).toBeInTheDocument();
  });

  it("fetches runner status and shows reader freshness", async () => {
    render(<App />);

    expect(await screen.findByText("Runner live")).toBeInTheDocument();
    expect(await screen.findByText("Last ingest 8s ago")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/v1/system/status", { credentials: "include" });
    });
  });

  it("opens the drawer when a run is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    const feed = await screen.findByRole("region", { name: /run feed/i });
    const row = within(feed).getByRole("button", { name: /Alfred/i });
    await user.click(row);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(window.location.search).toContain("run=run-1");
  });

  it("keeps a newly opened run selected when an older refresh finishes afterward", async () => {
    const user = userEvent.setup();
    const staleRefresh = createDeferred<Response>();
    const intervalCallbacks: Array<() => void> = [];
    let listCalls = 0;
    vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler) => {
      intervalCallbacks.push(handler as () => void);
      return intervalCallbacks.length as unknown as ReturnType<typeof window.setInterval>;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/runs?")) {
          listCalls += 1;
          if (listCalls === 2) {
            return staleRefresh.promise;
          }
          return new Response(JSON.stringify({ items: [runFixture] }), { status: 200 });
        }
        if (url === "/api/v1/system/status") {
          return new Response(
            JSON.stringify({
              runner: {
                state: "live",
                seconds_since_last_device_seen: 8,
                seconds_since_last_ingest: 8,
                last_device_seen_at: "2026-04-30T12:00:00.000Z",
                last_ingest_at: "2026-04-30T12:00:00.000Z",
                latest_run_updated_at: "2026-04-30T12:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }
        if (url === "/api/v1/runs/run-1") {
          return new Response(JSON.stringify(runDetailFixture), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(<App />);

    const feed = await screen.findByRole("region", { name: /run feed/i });
    expect(intervalCallbacks.length).toBeGreaterThan(0);

    await act(async () => {
      intervalCallbacks[0]?.();
    });
    expect(listCalls).toBe(2);

    await user.click(within(feed).getByRole("button", { name: /Alfred/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await act(async () => {
      staleRefresh.resolve(new Response(JSON.stringify({ items: [runFixture] }), { status: 200 }));
      await staleRefresh.promise;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(window.location.search).toContain("run=run-1");
  });

  it("keeps a deep-linked run selected when the initial list finishes afterward", async () => {
    window.history.pushState({}, "", "/?run=run-1");
    const initialList = createDeferred<Response>();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/runs?")) {
          return initialList.promise;
        }
        if (url === "/api/v1/system/status") {
          return new Response(
            JSON.stringify({
              runner: {
                state: "live",
                seconds_since_last_device_seen: 8,
                seconds_since_last_ingest: 8,
                last_device_seen_at: "2026-04-30T12:00:00.000Z",
                last_ingest_at: "2026-04-30T12:00:00.000Z",
                latest_run_updated_at: "2026-04-30T12:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }
        if (url === "/api/v1/runs/run-1") {
          return new Response(JSON.stringify(runDetailFixture), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(<App />);

    const feed = await screen.findByRole("region", { name: /run feed/i });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await act(async () => {
      initialList.resolve(new Response(JSON.stringify({ items: [runFixture] }), { status: 200 }));
      await initialList.promise;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await within(feed).findByRole("button", { name: /Alfred/i });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(window.location.search).toContain("run=run-1");
  });

  it("keeps the feed usable when run detail fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/runs?")) {
          return new Response(JSON.stringify({ items: [runFixture] }), { status: 200 });
        }
        if (url === "/api/v1/system/status") {
          return new Response(
            JSON.stringify({
              runner: {
                state: "live",
                seconds_since_last_device_seen: 8,
                seconds_since_last_ingest: 8,
                last_device_seen_at: "2026-04-30T12:00:00.000Z",
                last_ingest_at: "2026-04-30T12:00:00.000Z",
                latest_run_updated_at: "2026-04-30T12:00:00.000Z",
              },
            }),
            { status: 200 },
          );
        }
        if (url === "/api/v1/runs/run-1") {
          return new Response("detail failed", { status: 500 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    const feed = await screen.findByRole("region", { name: /run feed/i });
    await user.click(within(feed).getByRole("button", { name: /Alfred/i }));

    expect(await screen.findByText(/couldn't open that run/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(feed).not.toHaveClass("reader-feed-dimmed");
    expect(screen.queryByText(/can't reach the runner/i)).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("run=");
  });

  it("switches to Observatory with Cmd+O", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("region", { name: /run feed/i });
    await user.keyboard("{Meta>}o{/Meta}");

    expect(document.querySelector(".observatory")).not.toBeNull();
    expect(window.location.search).toContain("view=observatory");
  });

  it("ignores retired legacy and mockup flags", async () => {
    window.history.pushState({}, "", "/?legacy=1");
    render(<App />);

    expect(await screen.findByRole("region", { name: /run feed/i })).toBeInTheDocument();
    cleanup();

    window.history.pushState({}, "", "/?mockup=1");
    render(<App />);

    expect(await screen.findByRole("region", { name: /run feed/i })).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: /mockup/i })).not.toBeInTheDocument();
  });

  it("shows a login action when the API requires authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("login required", { status: 401 })),
    );

    render(<App />);

    expect(await screen.findByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/auth/login");
    expect(screen.queryByText(/Failed to load runs/i)).not.toBeInTheDocument();
  });

  it("does not require auth when only system status is unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/v1/runs?")) {
          return new Response(JSON.stringify({ items: [runFixture] }), { status: 200 });
        }
        if (url === "/api/v1/system/status") {
          return new Response("login required", { status: 401 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: /All/i })).toBeInTheDocument();
    expect(await screen.findByText("Runner status unavailable")).toBeInTheDocument();
    expect(screen.getByText("I can't check freshness right now")).toBeInTheDocument();
    expect(screen.queryByText("No heartbeat yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("clears deep-linked run selection when authentication is required", async () => {
    window.history.pushState({}, "", "/?run=run-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("login required", { status: 401 })),
    );

    render(<App />);

    await screen.findByRole("link", { name: /sign in/i });
    expect(window.location.search).not.toContain("run=");
  });
});

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
