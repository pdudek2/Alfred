export const neutralScreenshotPointer = { x: 1, y: 1 } as const;

export const privacySafeScreenshotSelectors = [
  ".xterm-host",
  ".xterm-host *",
  ".session-location-value",
  ".workbench-session-context > small",
  ".work-surface-context",
  ".composer-input",
  ".agent-context-essentials",
  ".agent-session-pulse",
  ".workspace-title-trigger small",
  ".project-row-label",
  ".project-session-title",
  ".terminal-tile.staged .tile-title small",
  ".staged-command",
  ".staged-cwd",
  ".inbox-docket__item-copy small",
  ".inbox-docket code",
  ".sessions-navigator__search input",
  ".sessions-result > span",
  ".sessions-reader__breadcrumb > strong",
  ".sessions-reader__breadcrumb > span",
  ".sessions-transcript > header > *",
  ":is(.sessions-transcript [data-testid='transcript-block'], .sessions-transcript [data-testid='transcript-block'] *)",
  ".command-palette-list button small",
  ".tile-age",
  "time",
] as const;

export const privacySafeHiddenScreenshotSelectors = [
  ".xterm-screen",
] as const;

export const privacySafeScreenshotStyle = `
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
