import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeedSection } from "../components/feed-section";

describe("FeedSection", () => {
  afterEach(() => cleanup());

  it("renders the label, active count, and children for Running", () => {
    render(
      <FeedSection label="Running" count={2}>
        <article>Live run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Running" });

    expect(within(section).getByRole("heading", { name: "Running" })).toHaveClass("reader-feed-section__label");
    expect(within(section).getByText("2 active")).toHaveClass("reader-feed-section__total");
    expect(within(section).getByText("Live run")).toBeInTheDocument();
  });

  it("uses item count text for Needs you because those rows require a person", () => {
    render(
      <FeedSection label="Needs you" count={5}>
        <article>Waiting run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Needs you" });

    expect(within(section).getByText("5 items")).toBeInTheDocument();
  });

  it("uses item count text for Problems so failed sessions are not framed as human approvals", () => {
    render(
      <FeedSection label="Problems" count={3}>
        <article>Failed run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Problems" });

    expect(within(section).getByText("3 items")).toBeInTheDocument();
  });

  it("uses a stable heading id and accessible section name for multi-word labels", () => {
    render(
      <FeedSection label="Quiet archive" count={3}>
        <article>Quiet run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Quiet archive" });
    const heading = within(section).getByRole("heading", { name: "Quiet archive" });

    expect(heading).toHaveAttribute("id", "reader-feed-section-quiet-archive");
    expect(section).toHaveAttribute("aria-labelledby", "reader-feed-section-quiet-archive");
  });
});
