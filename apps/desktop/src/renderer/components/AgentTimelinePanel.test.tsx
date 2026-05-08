import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AgentTimelinePanel } from "./AgentTimelinePanel";
import type { SessionTile } from "../session-state";

describe("AgentTimelinePanel", () => {
  it("renders an empty state when no session is focused", () => {
    render(<AgentTimelinePanel session={null} />);
    expect(screen.getByLabelText("Agent activity")).toBeInTheDocument();
    expect(screen.getByText("no focused session")).toBeInTheDocument();
    expect(screen.getByText(/structured agent events will appear here/i)).toBeInTheDocument();
  });

  it("shows the focused session title when a session is provided", () => {
    const session: SessionTile = {
      id: "s1",
      title: "claude — alfred",
      workspaceId: "w1",
      stage: "live",
      cwd: "/tmp",
      source: "manual",
    };
    render(<AgentTimelinePanel session={session} />);
    expect(screen.getByText("claude — alfred")).toBeInTheDocument();
  });
});
