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
  ".workspace-nav-head > div > span",
  ".workspace-button-details > span",
  ".terminal-tile.staged .tile-title small",
  ".staged-command",
  ".staged-cwd",
  ".review-surface-copy small",
  ".review-surface-command code",
  ".observatory-project-copy small",
  ".observatory-row-copy small",
  ".observatory-detail-card dd",
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
