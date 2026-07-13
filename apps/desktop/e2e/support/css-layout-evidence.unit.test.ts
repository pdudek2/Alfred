import { describe, expect, it } from "vitest";
import { captureReadinessForState } from "./css-layout-evidence";
import {
  neutralScreenshotPointer,
  privacySafeHiddenScreenshotSelectors,
  privacySafeScreenshotSelectors,
  privacySafeScreenshotStyle,
} from "./privacy-safe-screenshot";

describe("CSS layout evidence support", () => {
  it("keeps deterministic fixture text visible while masking sensitive runtime fields", () => {
    expect(privacySafeScreenshotStyle).not.toMatch(/body\s+\*/);
    expect(privacySafeScreenshotStyle).toContain(".xterm-host");
    expect(privacySafeScreenshotStyle).toContain(".session-location-value");
    expect(privacySafeScreenshotStyle).toContain(".composer-input");
    expect(privacySafeScreenshotStyle).toContain(".agent-context-essentials");
    expect(privacySafeScreenshotStyle).toContain(".workspace-button-details > span");
    expect(privacySafeScreenshotStyle).toContain(".observatory-project-copy small");
    expect(privacySafeScreenshotStyle).not.toContain(".session-observatory-");
    expect(privacySafeScreenshotStyle).toContain(".command-palette-list button small");
    expect(privacySafeScreenshotStyle).toContain(".workspace-title-trigger small");
    expect(privacySafeScreenshotStyle).toContain(".staged-command");
    expect(privacySafeScreenshotStyle).toContain(".staged-cwd");
    expect(privacySafeScreenshotStyle).toContain(".agent-session-pulse");
    expect(privacySafeScreenshotStyle).toContain(".review-surface-command code");
    expect(privacySafeScreenshotStyle).toContain(".xterm-screen");
    expect(privacySafeScreenshotStyle).toContain("opacity: 0 !important");
    expect(privacySafeScreenshotSelectors).not.toContain("body *");
    expect(privacySafeHiddenScreenshotSelectors).toContain(".xterm-screen");
    expect(neutralScreenshotPointer).toEqual({ x: 1, y: 1 });
  });

  it("waits for the command palette selection effect before capture", () => {
    expect(captureReadinessForState("command-palette")).toEqual({
      selector: ".command-palette-list [role='option'][aria-selected='true']",
    });
    expect(captureReadinessForState("inbox")).toBeNull();
    expect(captureReadinessForState("prepare-work")).toBeNull();
  });
});
