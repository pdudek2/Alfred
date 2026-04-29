import type { ReactNode } from "react";

import type { TimeGroupedFeedSectionLabel } from "../lib/run-view-model";

type FeedSectionProps = {
  label: TimeGroupedFeedSectionLabel;
  count: number;
  children: ReactNode;
};

export function FeedSection({ label, count, children }: FeedSectionProps) {
  const headingId = `reader-feed-section-${label.toLowerCase().replaceAll(" ", "-")}`;
  const countNoun = label === "Now" ? "active" : "closed";

  return (
    <section className="reader-feed-section" aria-labelledby={headingId}>
      <header className="reader-feed-section__header">
        <h2 className="reader-feed-section__label" id={headingId}>
          {label}
        </h2>
        <span className="reader-feed-section__total">
          {count} {countNoun}
        </span>
      </header>
      <div className="reader-feed-section__body">{children}</div>
    </section>
  );
}
