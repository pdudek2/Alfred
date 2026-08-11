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
    expect(privacySafeScreenshotStyle).toContain(".composer-input");
    expect(privacySafeScreenshotStyle).toContain(".agent-context-essentials");
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
    expect(privacySafeScreenshotStyle).toContain(".staged-command");
    expect(privacySafeScreenshotStyle).toContain(".agent-session-pulse");
    expect(privacySafeScreenshotStyle).toContain(".inbox-docket code");
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
      <textarea class="composer-input">fixture prompt</textarea>
      <div class="agent-context-essentials">fixture essentials</div>
      <div class="agent-session-pulse">fixture activity</div>
      <div class="agents-drawer__work-copy"><span class="agents-drawer__work-detail">fixture agent activity</span></div>
      <button class="workspace-title-trigger"><small>/fixture/workspace</small></button>
      <span class="project-row-label">Fixture project</span>
      <span class="project-session-title">Fixture session</span>
      <div class="terminal-tile staged"><div class="tile-title"><small>fixture staged</small></div></div>
      <code class="staged-command">pnpm test</code>
      <div class="inbox-docket__item-copy"><small>fixture detail</small></div>
      <div class="inbox-docket"><code>fixture evidence</code></div>
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
    `;
    document.body.append(fixture);

    try {
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
    expect(captureReadinessForState("inbox")).toBeNull();
    expect(captureReadinessForState("prepare-work")).toBeNull();
  });
});
