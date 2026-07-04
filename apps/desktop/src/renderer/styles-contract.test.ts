import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = [
  resolve(process.cwd(), "src/renderer/styles.css"),
  resolve(process.cwd(), "apps/desktop/src/renderer/styles.css"),
].find((candidate) => existsSync(candidate));

if (!stylesPath) {
  throw new Error("Unable to locate renderer styles.css");
}

const styles = readFileSync(stylesPath, "utf8");
const flatStylesStart = styles.indexOf("ALFRED CLEAN FLAT v4");

if (flatStylesStart < 0) {
  throw new Error("Unable to locate CLEAN FLAT v4 styles");
}

const flatStyles = styles.slice(flatStylesStart);
const prototypeStylesStart = styles.indexOf("ALFRED PROTOTYPE CLEAN v5");

if (prototypeStylesStart < 0) {
  throw new Error("Unable to locate PROTOTYPE CLEAN v5 styles");
}

const prototypeStyles = styles.slice(prototypeStylesStart);
const polishStylesStart = styles.indexOf("ALFRED PROTOTYPE POLISH v6");
const polishStyles = polishStylesStart >= 0 ? styles.slice(polishStylesStart) : "";
const materialStylesStart = styles.indexOf("ALFRED CLEAN MATERIAL v7");
const materialStyles = materialStylesStart >= 0 ? styles.slice(materialStylesStart) : "";
const readabilityStylesStart = styles.indexOf("ALFRED CLEAN READABILITY v8");
const readabilityStyles = readabilityStylesStart >= 0 ? styles.slice(readabilityStylesStart) : "";
const colorRoleStylesStart = styles.indexOf("ALFRED TERMINAL-FIRST COLOR ROLES v9");
const colorRoleStyles = colorRoleStylesStart >= 0 ? styles.slice(colorRoleStylesStart) : "";

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "gm"))];
  return matches.at(-1)?.groups?.body ?? "";
}

function firstBlockFor(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "m"))?.groups?.body ?? "";
}

function exactBlockFor(selector: string): string {
  const matches = [...styles.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gm)].filter((match) =>
    (match.groups?.selectors ?? "").split(",").some((candidate) => candidate.trim() === selector),
  );
  return matches.at(-1)?.groups?.body ?? "";
}

function ruleForSelectorContaining(selector: string): { selectors: string; body: string } {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...styles.matchAll(new RegExp(`(?<selectors>[^{}]*${escapedSelector}[^{}]*)\\{(?<body>[^}]*)\\}`, "gm")),
  ];
  const match = matches.at(-1);

  return {
    selectors: match?.groups?.selectors ?? "",
    body: match?.groups?.body ?? "",
  };
}

function rulesForSelectorContaining(selector: string): Array<{ selectors: string; body: string }> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`(?<selectors>[^{}]*${escapedSelector}[^{}]*)\\{(?<body>[^}]*)\\}`, "gm"))].map(
    (match) => ({
      selectors: match.groups?.selectors ?? "",
      body: match.groups?.body ?? "",
    }),
  );
}

function rootToken(name: string): string {
  const match = styles.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"));
  return match?.[1] ?? "";
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/../g)
    ?.map((pair) => parseInt(pair, 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected six-digit hex color, received ${hex}`);
  }

  const [red, green, blue] = channels as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("renderer CSS contracts", () => {
  it("keeps Arrange mode scrollable with room for the bottom resize handle", () => {
    const arrangeCanvas = blockFor(".terminal-stage.arranging .terminal-grid-column");
    const arrangingGrid = blockFor(".terminal-stage.arranging .terminal-grid");

    expect(arrangeCanvas).toContain("overflow-y: auto");
    expect(arrangeCanvas).toContain("scrollbar-gutter: stable");
    expect(arrangingGrid).toContain("--arrange-bottom-safe-zone");
    expect(arrangingGrid).toContain("flex: 0 0 auto");
    expect(arrangingGrid).toContain("min-height: calc(100% + var(--arrange-bottom-safe-zone))");
    expect(arrangingGrid).toContain("padding-bottom: var(--arrange-bottom-safe-zone)");
  });

  it("keeps normal Grid scrollable when terminal tiles overflow the viewport", () => {
    const activeDeskSurface = exactBlockFor(".desk-surface-panel.active");
    const stage = exactBlockFor(".surface-panel > .terminal-stage");
    const gridColumn = exactBlockFor(".terminal-grid-column");
    const laidOutGrid = exactBlockFor(".terminal-grid.laid-out");
    const laidOutTile = exactBlockFor(".terminal-grid.laid-out .terminal-tile");

    expect(activeDeskSurface).toContain("overflow: hidden");
    expect(stage).toContain("height: 100%");
    expect(stage).toContain("max-height: 100%");
    expect(gridColumn).toContain("height: 100%");
    expect(gridColumn).toContain("max-height: 100%");
    expect(gridColumn).toContain("overflow-y: auto");
    expect(gridColumn).toContain("overscroll-behavior: contain");
    expect(gridColumn).toContain("scrollbar-gutter: stable");
    expect(gridColumn).toContain("scrollbar-width: thin");
    expect(gridColumn).toContain("scrollbar-color:");
    expect(laidOutGrid).toContain("--grid-bottom-safe-zone");
    expect(laidOutGrid).toContain("flex: 0 0 auto");
    expect(laidOutGrid).toContain("padding-bottom: var(--grid-bottom-safe-zone)");
    expect(laidOutTile).toContain("scroll-margin-bottom: var(--grid-bottom-safe-zone)");
  });

  it("keeps Inbox section titles separated from explanatory copy", () => {
    const inboxHeader = blockFor(".inbox-section > header");
    const inboxHeaderCopy = blockFor(".inbox-section > header div");
    const emptyCopy = blockFor(".inbox-section-empty");

    expect(inboxHeader).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(inboxHeaderCopy).toContain("display: grid");
    expect(inboxHeaderCopy).toContain("gap: 4px");
    expect(emptyCopy).toContain("font: 500 13px/1.4 var(--sans)");
  });

  it("keeps empty Inbox lanes compact instead of stretching across the workspace", () => {
    const inboxStack = blockFor(".inbox-section-stack");
    const emptySection = blockFor(".inbox-section.is-empty");
    const emptyHeader = blockFor(".inbox-section.is-empty > header");

    expect(inboxStack).toContain("align-content: start");
    expect(inboxStack).toContain("align-items: start");
    expect(inboxStack).toContain("grid-auto-rows: max-content");
    expect(emptySection).toContain("align-self: start");
    expect(emptyHeader).toContain("min-height: 32px");
    expect(emptyHeader).toContain("padding: 7px 10px");
  });

  it("keeps the clean flat workbench controls proportional", () => {
    expect(flatStyles).toContain(".workbench-actions button,");
    expect(flatStyles).toContain("height: var(--flat-control-height)");
    expect(flatStyles).toContain("background: var(--flat-control)");
    expect(flatStyles).toContain(".workbench-tool-group");
    expect(flatStyles).toContain("padding: 2px");
    expect(flatStyles).toContain(".workbench-primary-action");
    expect(flatStyles).toContain("background-image: none");
  });

  it("keeps header counts quiet instead of rendering badge bubbles", () => {
    const panelGroup = blockFor(".workbench-panel-group button strong");
    const quietDot = blockFor(".quiet-count-dot,\n.quiet-count-mark");

    expect(panelGroup).toContain("display: none");
    expect(quietDot).toContain("border-radius: 999px");
  });

  it("keeps quick switch as a compact flat switcher, not a heavy glass modal", () => {
    const backdrop = blockFor(".session-observatory-backdrop");
    const panel = blockFor(".session-observatory-panel");
    const header = blockFor(".session-observatory-header");
    const list = blockFor(".session-observatory-list");

    expect(backdrop).toContain("background: rgba(0, 0, 0, 0.54)");
    expect(backdrop).toContain("backdrop-filter: none");
    expect(panel).toContain("width: min(760px, calc(100vw - 88px))");
    expect(panel).toContain("max-height: min(560px, calc(100vh - 96px))");
    expect(panel).toContain("background-image: none");
    expect(header).toContain("padding: 14px 18px 12px");
    expect(list).toContain("padding: 10px 18px 18px");
  });

  it("keeps legacy gradients out of the main clean flat surfaces", () => {
    expect(flatStyles).toContain(".workspace-popover");
    expect(flatStyles).toContain("background: var(--flat-panel-2)");
    expect(flatStyles).toContain(".terminal-tile");
    expect(flatStyles).toContain("background-image: none");
    expect(flatStyles).toContain(".workspace-button.active");
  });

  it("keeps the clean-depth shell close to the prototype layout", () => {
    expect(prototypeStyles).toContain("grid-template-columns: 48px minmax(196px, 232px) minmax(0, 1fr)");
    expect(prototypeStyles).toContain(".context-column {");
    expect(materialStyles).toContain(".workspace-layout:has(.context-column.open)");
    expect(materialStyles).toContain("grid-template-columns: 48px minmax(196px, 232px) minmax(0, 1fr) minmax(304px, 340px)");
    expect(materialStyles).toContain(".workspace-layout > .context-column.open");
    expect(materialStyles).toContain("position: static");
    expect(prototypeStyles).toContain(".context-column.closed");
    expect(prototypeStyles).toContain("display: none");
  });

  it("keeps the Inbox empty state compact instead of a stretched dashboard card", () => {
    const emptyLanes = blockFor(".review-empty-lanes div");

    expect(prototypeStyles).toContain(".review-surface-empty {");
    expect(prototypeStyles).toContain("align-self: start");
    expect(prototypeStyles).toContain("min-height: 0");
    expect(prototypeStyles).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(prototypeStyles).toContain("background-image: none");
    expect(emptyLanes).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
  });

  it("styles workspace scrollbars so native white rails do not dominate the shell", () => {
    expect(prototypeStyles).toContain(".workspace-nav-scroll,");
    expect(prototypeStyles).toContain("scrollbar-width: thin");
    expect(prototypeStyles).toContain("scrollbar-color: rgba(255, 255, 255, 0.18) transparent");
    expect(prototypeStyles).toContain(".workspace-nav-scroll::-webkit-scrollbar-thumb");
    expect(prototypeStyles).toContain("background: rgba(255, 255, 255, 0.16)");
  });

  it("keeps the top chrome as one workspace switcher plus one workbench header", () => {
    const frame = blockFor(".desktop-frame");
    const missionBar = blockFor(".mission-bar");
    const missionNameBase = firstBlockFor(polishStyles, ".mission-bar .mission-name");
    const stageUtilityText = blockFor(".terminal-stage-utility span");

    expect(frame).toContain("grid-template-rows: 52px minmax(0, 1fr) 58px");
    expect(missionBar).toContain("position: static");
    expect(missionBar).toContain("height: 52px");
    expect(missionNameBase).toContain("position: static");
    expect(missionNameBase).toContain("max-width: min(420px, 48vw)");
    expect(stageUtilityText).toContain("font: 600 10px/1 var(--mono)");
    expect(stageUtilityText).toContain("text-transform: uppercase");
  });

  it("makes the context drawer itself scrollable instead of clipping the lower timeline", () => {
    const contextColumn = firstBlockFor(materialStyles, ".workspace-layout > .context-column.open");
    const contextDrawer = blockFor(".context-drawer");
    const timelinePanel = blockFor(".context-drawer .agent-timeline-panel");

    expect(contextColumn).toContain("display: flex");
    expect(contextDrawer).toContain("overflow: hidden");
    expect(contextDrawer).toContain("flex-direction: column");
    expect(timelinePanel).toContain("overflow: auto");
  });

  it("removes old glass gradients from the Sessions modal", () => {
    expect(polishStyles).toContain(".session-observatory-backdrop");
    expect(polishStyles).toContain("backdrop-filter: none");
    expect(polishStyles).toContain(".session-observatory-panel");
    expect(polishStyles).toContain("background-image: none");
    expect(polishStyles).toContain(".session-observatory-empty");
    expect(polishStyles).toContain(".session-observatory-main");
  });

  it("keeps recovery strip text from visually colliding", () => {
    const recoveryCopy = blockFor(".recovery-workspace-strip p");

    expect(recoveryCopy).toContain("gap: 4px");
  });

  it("keeps Arrange mode reachable at the bottom edge", () => {
    const arrangingGrid = blockFor(".terminal-stage.arranging .terminal-grid");
    const resizeHandle = blockFor(".tile-resize-handle");

    expect(arrangingGrid).toContain("--arrange-bottom-safe-zone: 156px");
    expect(arrangingGrid).toContain("min-height: calc(100% + var(--arrange-bottom-safe-zone))");
    expect(resizeHandle).toContain("width: 32px");
    expect(resizeHandle).toContain("background-image: none");
  });

  it("keeps terminal tile chrome secondary to the xterm body", () => {
    const header = blockFor(".terminal-tile-header");
    const kindMark = blockFor(".tile-kind-mark");
    const kindMarkText = blockFor(".tile-kind-mark span");
    const primaryActions = blockFor(".tile-primary-actions");
    const utilities = blockFor(".tile-utility-actions,\n.tile-danger-actions");
    const readyToolDot = blockFor(".terminal-tile.real-terminal.ready .tool-dot");
    const selectedToolDotRule = ruleForSelectorContaining(".terminal-tile.real-terminal.selected .tool-dot");
    const terminalChromeLayer = styles.slice(styles.indexOf(".terminal-tile.real-terminal .tool-dot"));

    expect(header).toContain("min-height");
    expect(header).toContain("background: var(--proto-panel-soft)");
    expect(header).not.toContain("linear-gradient");
    expect(kindMark).toContain("width: 24px");
    expect(kindMarkText).toContain("display: none");
    expect(primaryActions).toContain("opacity: 1");
    expect(primaryActions).toContain("pointer-events: auto");
    expect(utilities).toContain("opacity: 0");
    expect(utilities).toContain("pointer-events: none");
    expect(readyToolDot).not.toContain("var(--green)");
    expect(selectedToolDotRule.selectors).toContain(".terminal-tile.real-terminal.selected .tool-dot");
    expect(selectedToolDotRule.selectors).toContain(".terminal-tile.real-terminal.session-waiting .tool-dot");
    expect(selectedToolDotRule.selectors).toContain(".terminal-tile.real-terminal.error .tool-dot");
    expect(terminalChromeLayer).not.toMatch(/\.terminal-tile\.selected\s+\.tool-dot/);
  });

  it("keeps terminal tile titles readable before action chrome under constrained width", () => {
    const title = blockFor(".terminal-tile-header .tile-title");
    const titleText = blockFor(".terminal-tile-header .tile-title > div");
    const titleLabel = blockFor(".terminal-tile-header .tile-title b");
    const actions = blockFor(".terminal-tile-header .tile-actions");
    const primaryAction = blockFor(".tile-primary-actions .continue-button");
    const primaryActionText = blockFor(".tile-primary-actions .continue-button span");
    const statusText = blockFor(".terminal-status-text");
    const constrainedChrome = blockFor(".tile-age,\n  .terminal-status-text,\n  .tile-primary-actions .continue-button span");

    expect(/\.terminal-tile-header\s*\{[^}]*display:\s*flex;/.test(styles)).toBe(true);
    expect(title).toContain("flex: 1 1 auto");
    expect(title).toContain("min-width: 140px");
    expect(titleText).toContain("min-width: 0");
    expect(titleLabel).toContain("overflow: hidden");
    expect(titleLabel).toContain("text-overflow: ellipsis");
    expect(actions).toContain("flex: 0 1 auto");
    expect(actions).toContain("min-width: 0");
    expect(primaryAction).toContain("max-width");
    expect(primaryActionText).toContain("overflow: hidden");
    expect(statusText).toContain("max-width");
    expect(constrainedChrome).toContain("display: none");
  });

  it("keeps terminal-first color roles explicit and non-generic", () => {
    const manualDot = blockFor(".terminal-tile.real-terminal .tool-dot.manual,\n.terminal-tile.real-terminal .tool-dot.shell,\n.focus-session-strip .tool-dot.manual,\n.focus-session-strip .tool-dot.shell");
    const codexDot = blockFor(".terminal-tile.real-terminal .tool-dot.codex,\n.focus-session-strip .tool-dot.codex");
    const claudeDot = blockFor(".terminal-tile.real-terminal .tool-dot.claude,\n.focus-session-strip .tool-dot.claude");
    const primaryAction = blockFor(".workbench-primary-action,\n.mission-actions .new-terminal-button,\n.terminal-empty-primary-action");
    const readyDispatch = blockFor(".dispatch-bar[data-state=\"ready\"] .composer-send:enabled");
    const commandActivity = blockFor(".agent-activity-object.type-command,\n.agent-activity-object.type-file");
    const activeControlHover = blockFor(".workbench-tool-group button[aria-pressed=\"true\"]:hover,\n.workbench-tool-group button[aria-pressed=\"true\"]:focus-visible,\n.workbench-tool-group button.active:hover,\n.workbench-tool-group button.active:focus-visible,\n.context-toggle-button.active:hover,\n.context-toggle-button.active:focus-visible");
    const codexHover = blockFor(".workbench-launch-group button[aria-label=\"Start Codex\"]:hover,\n.workbench-launch-group button[aria-label=\"Start Codex\"]:focus-visible");
    const claudeHover = blockFor(".workbench-launch-group button[aria-label=\"Start Claude\"]:hover,\n.workbench-launch-group button[aria-label=\"Start Claude\"]:focus-visible");

    expect(colorRoleStyles).toContain("--role-active: var(--cyan)");
    expect(colorRoleStyles).toContain("--role-success: #63d18a");
    expect(manualDot).toContain("var(--role-neutral-marker)");
    expect(manualDot).not.toContain("var(--green)");
    expect(codexDot).toContain("var(--codex-blue)");
    expect(claudeDot).toContain("var(--claude-amber)");
    expect(primaryAction).toContain("background-image: none");
    expect(readyDispatch).toContain("var(--role-active)");
    expect(readyDispatch).not.toContain("var(--role-success)");
    expect(commandActivity).toContain("var(--role-active)");
    expect(activeControlHover).toContain("var(--role-active)");
    expect(activeControlHover).toContain("var(--accent-strong)");
    expect(codexHover).toContain("var(--codex-blue)");
    expect(claudeHover).toContain("var(--claude-amber)");
  });

  it("keeps legacy neon success greens from winning the primary action cascade", () => {
    expect(styles).not.toMatch(/background:\s*#(?:35d47f|37d884)\s*!important/i);
    expect(styles).not.toMatch(/#(?:35d47f|37d884)/i);
  });

  it("keeps primary actions tokenized without important overrides fighting the cascade", () => {
    const importantPrimaryRules = rulesForSelectorContaining(".workbench-primary-action")
      .filter(({ body }) => /(background|border-color|box-shadow|color|padding):[^;]+!important/i.test(body))
      .map(({ selectors }) => selectors.trim());
    const finalPrimaryAction = blockFor(
      ".workbench-primary-action,\n.mission-actions .new-terminal-button,\n.terminal-empty-primary-action",
    );

    expect(importantPrimaryRules).toEqual([]);
    expect(finalPrimaryAction).toContain("var(--role-success)");
    expect(finalPrimaryAction).not.toMatch(/(background|border-color|box-shadow|color|padding):[^;]+!important/i);
  });

  it("keeps starting session glyphs active instead of muted", () => {
    const startingGlyphRule = ruleForSelectorContaining(".session-status-glyph.status-starting");
    const stagedGlyphRule = ruleForSelectorContaining(".session-status-glyph.status-staged");

    expect(startingGlyphRule.selectors).toContain(".session-status-glyph.status-waiting");
    expect(startingGlyphRule.selectors).toContain(".session-status-glyph.status-checking");
    expect(startingGlyphRule.selectors).toContain(".session-status-glyph.status-runtime");
    expect(startingGlyphRule.body).toContain("color: var(--brass)");
    expect(startingGlyphRule.body).not.toContain("var(--muted)");
    expect(stagedGlyphRule.body).toContain("color: var(--muted)");
    expect(stagedGlyphRule.selectors).not.toContain(".session-status-glyph.status-starting");
  });

  it("keeps overlay surfaces flat instead of glassy", () => {
    const overlayBackdrop = blockFor(".review-queue-backdrop,\n.command-palette-backdrop,\n.session-observatory-backdrop");

    expect(materialStyles).toContain("ALFRED CLEAN MATERIAL v7");
    expect(overlayBackdrop).toContain("backdrop-filter: none");
    expect(overlayBackdrop).toContain("background-image: none");
    expect(materialStyles).toContain(".command-palette,");
    expect(materialStyles).toContain("box-shadow: none");
  });

  it("keeps the Work chrome quiet and command-like", () => {
    const tileUtilities = blockFor(".tile-utility-actions,\n.tile-danger-actions");
    const dispatchBar = blockFor(".dispatch-bar");
    const dispatchChip = blockFor(".dispatch-target-chip,\n.dispatch-bar .composer-input,\n.dispatch-bar .composer-send");

    expect(readabilityStyles).toContain("ALFRED CLEAN READABILITY v8");
    expect(readabilityStyles).toContain(".arrange-mode-label");
    expect(tileUtilities).toContain("opacity: 0");
    expect(tileUtilities).toContain("pointer-events: none");
    expect(dispatchBar).toContain("grid-template-rows: 32px 14px");
    expect(dispatchChip).toContain("background-image: none");
    expect(styles).not.toContain(".work-mode-control");
    expect(styles).not.toContain(".layout-controls button");
  });

  it("keeps workbench controls on shared sizing tokens instead of ad-hoc px heights", () => {
    const workbenchControlSizing = firstBlockFor(
      readabilityStyles,
      ".workbench-tool-group,\n.workbench-actions button,\n.context-toggle-button",
    );
    const workbenchSegmentSizing = firstBlockFor(readabilityStyles, ".workbench-tool-group button");

    expect(readabilityStyles).toContain("--workbench-control-height: 32px");
    expect(readabilityStyles).toContain("--workbench-segment-height: calc(var(--workbench-control-height) - 6px)");
    expect(workbenchControlSizing).toContain("height: var(--workbench-control-height)");
    expect(workbenchControlSizing).toContain("min-height: var(--workbench-control-height)");
    expect(workbenchSegmentSizing).toContain("height: var(--workbench-segment-height)");
    expect(workbenchSegmentSizing).toContain("min-height: var(--workbench-segment-height)");
    expect(readabilityStyles).not.toMatch(/\.workbench-tool-group button\s*\{[^}]*height:\s*(?:24|30|32)px/s);
  });

  it("keeps passive chrome text readable against the dark panel surface", () => {
    expect(contrastRatio(rootToken("--passive"), rootToken("--surface-panel"))).toBeGreaterThanOrEqual(4.5);
  });
});
