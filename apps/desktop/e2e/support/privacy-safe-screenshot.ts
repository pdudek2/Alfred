export const neutralScreenshotPointer = { x: 1, y: 1 } as const;

export const privacySafeScreenshotSelectors = [
  ".xterm-host",
  ".xterm-host *",
  ".session-location-value",
  ".new-session-prompt textarea",
  ".agent-timeline-header > strong",
  ".details-location-name",
  ".details-location-path",
  // Mask the containers so empty logs and conditional file rows are covered too.
  ".agent-activity-list",
  ".details-section[aria-label='Changes'] > :not(.details-section-heading)",
  ".workspace-title-trigger small",
  ".project-row-label",
  ".workbench-breadcrumb-parent",
  ".workbench-surface-title",
  ".project-session-title",
  ".sessions-navigator__search input",
  // The state glyph is not text; masking it would erase the row's state from the evidence.
  ".sessions-result > span:not(.session-status-glyph)",
  ".workbench-history-title",
  ".sessions-transcript > header > *",
  ":is(.sessions-transcript [data-testid='transcript-block'], .sessions-transcript [data-testid='transcript-block'] *)",
  ".command-palette-list button small",
  ".session-strip-age",
  ".terminal-empty-copy p",
  ".terminal-empty-asleep-title",
  ".terminal-empty-asleep-meta",
  ".terminal-empty-asleep-warning",
  ".session-stack-title",
  ".session-stack-preview",
  "time",
] as const;

export const privacySafeHiddenScreenshotSelectors = [
  ".xterm-screen",
] as const;

export const privacySafeScreenshotStyle = `
  .needs-you-popover__copy p,
  .plan-line__sub,
  .agent-timeline-body > .details-empty,
  .agent-staged-editor-copy,
  .agent-staged-edit-form input,
  .agent-staged-edit-form textarea,
  .agent-staged-edit-form [role="alert"] {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
  }

  ${privacySafeScreenshotSelectors.join(",\n  ")} {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    caret-color: transparent !important;
  }

  ${privacySafeHiddenScreenshotSelectors.join(",\n  ")} {
    opacity: 0 !important;
  }
`;
