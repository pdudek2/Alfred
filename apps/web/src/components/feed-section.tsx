import type { ReactNode } from "react";

import type { FeedSectionLabel } from "../lib/run-view-model";

type FeedSectionProps = {
  label: FeedSectionLabel;
  count: number;
  children: ReactNode;
};

export function FeedSection({ label, count, children }: FeedSectionProps) {
  const headingId = `reader-feed-section-${label.toLowerCase().replaceAll(" ", "-")}`;
  const countNoun = countNounFor(label);

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

function countNounFor(label: FeedSectionLabel): string {
  if (label === "Needs you") return "items";
  if (label === "Running") return "active";
  if (label === "Quiet archive") return "quiet";
  if (label === "Done") return "done";
  return "runs";
}
