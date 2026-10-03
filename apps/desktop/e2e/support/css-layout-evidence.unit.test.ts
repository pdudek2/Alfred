import { describe, expect, it } from "vitest";
import { captureReadinessForState, cssEvidenceStateNames } from "./css-layout-evidence";
import {
  neutralScreenshotPointer,
  privacySafeHiddenScreenshotSelectors,
  privacySafeScreenshotSelectors,
  privacySafeScreenshotStyle,
} from "./privacy-safe-screenshot";

describe("CSS layout evidence support", () => {
  it("uses Sessions as the only session-reader evidence state", () => {
    expect(cssEvidenceStateNames).toContain("sessions");
    expect(cssEvidenceStateNames).not.toContain("observatory");
  });

  it("keeps deterministic fixture text visible while masking sensitive runtime fields", () => {
    expect(privacySafeScreenshotStyle).not.toMatch(/body\s+\*/);
    expect(privacySafeScreenshotStyle).toContain(".xterm-host");
    expect(privacySafeScreenshotStyle).toContain(".session-location-value");
    expect(privacySafeScreenshotStyle).toContain(".new-session-prompt textarea");
    expect(privacySafeScreenshotStyle).toContain(".details-location-name");
    expect(privacySafeScreenshotStyle).toContain(".details-location-path");
    expect(privacySafeScreenshotStyle).toContain(".agent-timeline-header > strong");
    expect(privacySafeScreenshotStyle).not.toContain(".agent-context-essentials");
    expect(privacySafeScreenshotStyle).toContain(".project-row-label");
    expect(privacySafeScreenshotStyle).toContain(".project-session-title");
    expect(privacySafeScreenshotStyle).toContain(".sessions-result > span");
    expect(privacySafeScreenshotStyle).toContain(".sessions-reader__breadcrumb > strong");
    expect(privacySafeScreenshotStyle).toContain(".sessions-reader__breadcrumb > span");
    expect(privacySafeScreenshotStyle).toContain(".sessions-transcript > header > *");
    expect(privacySafeScreenshotStyle).not.toContain(".session-observatory-");
    expect(privacySafeScreenshotStyle).not.toContain(".observatory-");
    expect(privacySafeScreenshotStyle).toContain(".command-palette-list button small");
    expect(privacySafeScreenshotStyle).toContain(".workspace-title-trigger small");
    expect(privacySafeScreenshotStyle).toContain(".plan-line__sub");
    expect(privacySafeScreenshotStyle).toContain(".agent-activity-list");
    expect(privacySafeScreenshotStyle).toContain(".details-section[aria-label='Changes'] > :not(.details-section-heading)");
    expect(privacySafeScreenshotStyle).not.toContain(".agent-session-pulse");
    expect(privacySafeScreenshotStyle).toContain(".xterm-screen");
    expect(privacySafeScreenshotStyle).toContain("opacity: 0 !important");
    expect(privacySafeScreenshotSelectors).not.toContain("body *");
    expect(privacySafeHiddenScreenshotSelectors).toContain(".xterm-screen");
    expect(neutralScreenshotPointer).toEqual({ x: 1, y: 1 });
  });

  it("matches every privacy selector against a fixture node", () => {
    const fixture = document.createElement("div");
    fixture.innerHTML = `
      <div class="xterm-host"><div class="xterm-screen"></div><span>terminal</span></div>
      <span class="session-location-value">/fixture/project</span>
      <div class="workbench-session-context"><small>fixture project</small></div>
      <span class="work-surface-context">fixture context</span>
      <div class="new-session-prompt"><textarea>fixture prompt</textarea></div>
      <header class="agent-timeline-header"><strong data-private>Private session</strong></header>
      <p class="details-location-name" data-private>private-branch</p>
      <p class="details-location-path" data-private>/private/project</p>
      <section class="details-section" aria-label="Activity">
        <ol class="agent-activity-list"><li><span class="details-activity-text" data-private>Private activity</span></li></ol>
      </section>
      <section class="details-section" aria-label="Changes">
        <header class="details-section-heading"><h2>Changes</h2></header>
        <ul class="details-files"><li><span data-private>private-file.ts</span><span>+1</span></li></ul>
        <p class="details-empty" data-private>Error in /private/project</p>
        <div class="details-actions"><button data-private>Apply to Private project</button></div>
      </section>
      <button class="workspace-title-trigger"><small>/fixture/workspace</small></button>
      <span class="project-row-label">Fixture project</span>
      <span class="project-session-title">Fixture session</span>
      <section class="sessions-surface">
        <aside class="sessions-navigator">
          <label class="sessions-navigator__search"><input value="private query"></label>
          <div class="sessions-results">
            <button class="sessions-result"><span>Fixture session</span></button>
          </div>
        </aside>
        <main class="sessions-reader">
          <header class="sessions-reader__toolbar"><nav class="sessions-reader__breadcrumb"><span>Fixture project</span><span>/</span><strong>Fixture session</strong></nav><span class="sessions-reader__toolbar-spacer"></span></header>
          <article class="sessions-transcript"><header><h1>Fixture session</h1><p>Fixture project</p></header>
            <section data-testid="transcript-block"><div>private transcript</div></section>
          </article>
        </main>
      </section>
      <div class="command-palette-list"><button><small>fixture command</small></button></div>
      <span class="tile-age">2m</span><time>now</time>
      <div class="terminal-empty-state">
        <div class="terminal-empty-copy"><strong>Nothing is running</strong><p data-private>Folder unavailable: /private/project.</p></div>
        <section class="terminal-empty-asleep"><ul><li>
          <span class="terminal-empty-asleep-title" data-private>Private session</span>
          <span class="terminal-empty-asleep-meta" data-private>Terminal, 3h ago</span>
          <small class="terminal-empty-asleep-warning" data-private>Review before resuming: rm -rf would be replayed.</small>
        </li></ul></section>
      </div>
    `;
    document.body.append(fixture);

    try {
      for (const node of fixture.querySelectorAll("[data-private]")) {
        expect(node.closest(privacySafeScreenshotSelectors.join(",")), "Private Details text must inherit a mask").not.toBeNull();
      }
      for (const selector of [...privacySafeScreenshotSelectors, ...privacySafeHiddenScreenshotSelectors]) {
        expect(document.querySelector(selector), `${selector} must match the fixture DOM`).not.toBeNull();
      }
    } finally {
      fixture.remove();
    }
  });

  it("waits for the command palette selection effect before capture", () => {
    expect(captureReadinessForState("command-palette")).toEqual({
      selector: ".command-palette-list [role='option'][aria-selected='true']",
    });
    expect(captureReadinessForState("sessions")).toBeNull();
    expect(captureReadinessForState("new-session")).toBeNull();
  });
});
