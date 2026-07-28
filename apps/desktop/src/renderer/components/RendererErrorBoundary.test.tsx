import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererErrorBoundary } from "./RendererErrorBoundary";

function BrokenRenderer() {
  throw new Error("Fixture renderer failure");
}

describe("RendererErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the crash fallback as an alert with a heading and recovery action", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <RendererErrorBoundary>
        <BrokenRenderer />
      </RendererErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Alfred hit a UI error." })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload Alfred" })).toBeVisible();
  });
});
