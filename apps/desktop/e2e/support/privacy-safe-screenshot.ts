export const privacySafeScreenshotSelectors = [
  ".xterm-host",
  ".xterm-host *",
  ".session-location-value",
  ".agent-context-essentials",
  ".workspace-button-details > span",
  ".observatory-project-copy small",
  ".observatory-row-copy small",
  ".observatory-detail-card dd",
  ".session-observatory-copy small",
  ".command-palette-list button small",
  ".tile-age",
  "time",
] as const;

export const privacySafeScreenshotStyle = `
  ${privacySafeScreenshotSelectors.join(",\n  ")} {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    text-shadow: none !important;
    caret-color: transparent !important;
  }
`;
