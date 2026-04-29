import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeedSection } from "../components/feed-section";

describe("FeedSection", () => {
  afterEach(() => cleanup());

  it("renders the label, active count, and children for Now", () => {
    render(
      <FeedSection label="Now" count={2}>
        <article>Live run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Now" });

    expect(within(section).getByRole("heading", { name: "Now" })).toHaveClass("reader-feed-section__label");
    expect(within(section).getByText("2 active")).toHaveClass("reader-feed-section__total");
    expect(within(section).getByText("Live run")).toBeInTheDocument();
  });

  it("uses closed count text for Today", () => {
    render(
      <FeedSection label="Today" count={5}>
        <article>Closed run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Today" });

    expect(within(section).getByText("5 closed")).toBeInTheDocument();
  });

  it("uses a stable heading id and accessible section name for multi-word labels", () => {
    render(
      <FeedSection label="Earlier this week" count={3}>
        <article>Recent run</article>
      </FeedSection>,
    );

    const section = screen.getByRole("region", { name: "Earlier this week" });
    const heading = within(section).getByRole("heading", { name: "Earlier this week" });

    expect(heading).toHaveAttribute("id", "reader-feed-section-earlier-this-week");
    expect(section).toHaveAttribute("aria-labelledby", "reader-feed-section-earlier-this-week");
  });
});
