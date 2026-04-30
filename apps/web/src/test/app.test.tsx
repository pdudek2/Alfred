import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
        if (url === "/api/v1/runs/run-1") {
          return new Response(JSON.stringify(runDetailFixture), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
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

  it("opens the drawer when a run is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    const feed = await screen.findByRole("region", { name: /run feed/i });
    const row = within(feed).getByRole("button", { name: /Alfred/i });
    await user.click(row);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(window.location.search).toContain("run=run-1");
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
