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

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "gm"))];
  return matches.at(-1)?.groups?.body ?? "";
}

function firstBlockFor(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "m"))?.groups?.body ?? "";
}

function blocksFor(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "gm"))].map(
    (match) => match.groups?.body ?? "",
  );
}

function blockForContaining(selector: string, text: string): string {
  return blocksFor(selector).find((body) => body.includes(text)) ?? "";
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

function tokenValue(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
}

function tokenDefinitionCount(tokenName: string): number {
  const escaped = tokenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`${escaped}:\\s*`, "g"))].length;
}

function tokenUsageCount(tokenPrefix: string): number {
  const escaped = tokenPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`var\\(${escaped}`, "g"))].length;
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
  it("uses one canonical tactical-dark token hierarchy", () => {
    expect(tokenDefinitionCount("--surface-terminal")).toBe(1);
    expect(tokenDefinitionCount("--surface-canvas")).toBe(1);
    expect(tokenDefinitionCount("--surface-panel")).toBe(1);
    expect(tokenDefinitionCount("--surface-raised")).toBe(1);
    expect(tokenDefinitionCount("--text-primary")).toBe(1);
    expect(tokenDefinitionCount("--text-muted")).toBe(1);
    expect(tokenDefinitionCount("--text-faint")).toBe(1);

    expect(tokenValue("--accent")).toBe("var(--signal-focus)");
    expect(tokenValue("--terminal")).toBe("var(--surface-terminal)");
    expect(styles).not.toMatch(/--flat-/);
    expect(styles).not.toMatch(/--proto-/);
    expect(styles).not.toMatch(/ALFRED CLEAN FLAT v4/);
    expect(styles).not.toMatch(/ALFRED WORKBENCH CLEAN v5/);
    expect(styles).not.toMatch(/ALFRED WORKBENCH POLISH v6/);
    expect(styles).not.toMatch(/ALFRED CLEAN MATERIAL v7/);
    expect(styles).not.toMatch(/ALFRED CLEAN READABILITY v8/);
    expect(styles).not.toMatch(/ALFRED TERMINAL-FIRST COLOR ROLES v9/);
    expect(tokenUsageCount("--flat-")).toBe(0);
    expect(tokenUsageCount("--proto-")).toBe(0);
  });

  it("keeps terminal-first contrast and avoids glass on primary surfaces", () => {
    expect(contrastRatio(rootToken("--text-primary"), rootToken("--surface-terminal"))).toBeGreaterThanOrEqual(12);
    expect(contrastRatio(rootToken("--text-muted"), rootToken("--surface-panel"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rootToken("--text-faint"), rootToken("--surface-panel"))).toBeGreaterThanOrEqual(4.0);

    expect(styles).not.toMatch(/backdrop-filter:\s*blur/i);
    expect(styles).not.toMatch(/-webkit-backdrop-filter:\s*blur/i);
    expect(styles).not.toMatch(/--glass:/);
    expect(styles).not.toMatch(/0\s+28px\s+80px/);
  });

  it("keeps the CSS terminal surface synchronized with the xterm profile", () => {
    const xtermHost = blockFor(".terminal-tile .terminal-host,\n.terminal-tile .xterm-host");

    expect(rootToken("--surface-terminal")).toBe("#0a0e12");
    expect(rootToken("--signal-focus")).toBe("#53c7d8");
    expect(xtermHost).toContain("background: var(--surface-terminal)");
  });

  it("routes operational colors through signal tokens", () => {
    expect(styles).not.toMatch(/rgba\(83,\s*199,\s*216,/);
    expect(styles).not.toMatch(/rgba\(217,\s*174,\s*70,/);
    expect(styles).not.toMatch(/#(?:35d47f|37d884|3ee68a)/i);
    expect(styles).not.toMatch(/#e0b75b/i);
    expect(styles).not.toMatch(/var\(--accent\)/);
    expect(styles).not.toMatch(/var\(--amber\)/);
    expect(styles).not.toMatch(/var\(--coral\)/);
    expect(styles).not.toMatch(/var\(--green\)/);
  });

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
    const workbenchAction = blockFor(
      ".workbench-actions button,\n.context-toggle-button,\n.agent-handoff-buttons button,\n.workspace-preview-actions button,\n.review-surface-primary,\n.review-surface-discard,\n.observatory-surface-header button,\n.observatory-detail-card button",
    );
    const workbenchToolGroup = blockFor(".workbench-tool-group");
    const primaryAction = blockFor(".workbench-primary-action,\n.mission-actions .new-terminal-button");

    expect(workbenchAction).toMatch(/height:\s*(?:var\(--control-height\)|32px)/);
    expect(workbenchAction).toContain("background:");
    expect(workbenchToolGroup).toContain("padding: 2px");
    expect(primaryAction).toContain("height:");
    expect(styles).not.toContain("--flat-control-height");
    expect(styles).not.toContain("--flat-control");
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
    const workspacePopover = blockFor(".workspace-popover");
    const terminalTile = exactBlockFor(".terminal-tile");
    const activeWorkspace = blockFor(".workspace-button.active,\n.workspace-button.active:hover");

    expect(workspacePopover).toContain("background:");
    expect(workspacePopover).not.toContain("linear-gradient");
    expect(terminalTile).toContain("background-image: none");
    expect(terminalTile).not.toContain("linear-gradient");
    expect(activeWorkspace).toContain("background:");
    expect(styles).not.toContain("--flat-");
  });

  it("keeps the workbench shell close to the current layout", () => {
    const closedLayout = blockFor(
      ".workspace-layout,\n.workspace-layout.alfred-compact,\n.workspace-layout.preview-visible,\n.workspace-layout.alfred-compact.preview-visible,\n.workspace-layout:has(.context-column.closed),\n.workspace-layout.alfred-compact:has(.context-column.closed),\n.workspace-layout.preview-visible:has(.context-column.closed),\n.workspace-layout.alfred-compact.preview-visible:has(.context-column.closed),\n.workspace-layout.surface-inbox,\n.workspace-layout.surface-history,\n.workspace-layout.surface-inbox.preview-visible,\n.workspace-layout.surface-history.preview-visible,\n.workspace-layout.surface-inbox.alfred-compact,\n.workspace-layout.surface-history.alfred-compact",
    );
    const openLayout = blockFor(
      ".workspace-layout:has(.context-column.open),\n.workspace-layout.alfred-compact:has(.context-column.open),\n.workspace-layout.preview-visible:has(.context-column.open),\n.workspace-layout.alfred-compact.preview-visible:has(.context-column.open),\n.workspace-layout.surface-inbox:has(.context-column.open),\n.workspace-layout.surface-history:has(.context-column.open)",
    );
    const openColumn = firstBlockFor(styles, ".workspace-layout > .context-column.open");
    const closedColumn = blockFor(".workspace-layout > .context-column.closed");

    expect(closedLayout).toContain("grid-template-columns: 48px minmax(196px, 232px) minmax(0, 1fr)");
    expect(openLayout).toContain("grid-template-columns: 48px minmax(196px, 232px) minmax(0, 1fr) minmax(304px, 340px)");
    expect(openColumn).toContain("position: static");
    expect(closedColumn).toContain("display: none");
  });

  it("keeps the Inbox empty state compact instead of a stretched dashboard card", () => {
    const emptyLanes = blockFor(".review-empty-lanes div");
    const reviewEmpty = blockForContaining(".review-surface-empty", "align-self: start");

    expect(reviewEmpty).toContain("align-self: start");
    expect(reviewEmpty).toContain("min-height: 0");
    expect(reviewEmpty).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(reviewEmpty).toContain("background-image: none");
    expect(emptyLanes).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
  });

  it("styles workspace scrollbars so native white rails do not dominate the shell", () => {
    const workspaceScroll = blockFor(
      ".workspace-nav-scroll,\n.terminal-stage-body,\n.review-surface-list,\n.observatory-surface,\n.observatory-projects,\n.observatory-session-list,\n.context-drawer,\n.agent-timeline-panel",
    );
    const scrollbarThumb = blockFor(
      ".workspace-nav-scroll::-webkit-scrollbar-thumb,\n.terminal-stage-body::-webkit-scrollbar-thumb,\n.review-surface-list::-webkit-scrollbar-thumb,\n.observatory-surface::-webkit-scrollbar-thumb,\n.observatory-projects::-webkit-scrollbar-thumb,\n.observatory-session-list::-webkit-scrollbar-thumb,\n.context-drawer::-webkit-scrollbar-thumb,\n.agent-timeline-panel::-webkit-scrollbar-thumb",
    );

    expect(workspaceScroll).toContain("scrollbar-width: thin");
    expect(workspaceScroll).toContain("scrollbar-color:");
    expect(scrollbarThumb).toContain("background:");
  });

  it("keeps the top chrome as one workspace switcher plus one workbench header", () => {
    const frame = blockFor(".desktop-frame");
    const missionBar = blockFor(".mission-bar");
    const missionNameBase = blockForContaining(".mission-bar .mission-name", "position: static");
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
    const contextColumn = firstBlockFor(styles, ".workspace-layout > .context-column.open");
    const contextDrawer = blockFor(".context-drawer");
    const timelinePanel = blockFor(".context-drawer .agent-timeline-panel");

    expect(contextColumn).toContain("display: flex");
    expect(contextDrawer).toContain("overflow: hidden");
    expect(contextDrawer).toContain("flex-direction: column");
    expect(timelinePanel).toContain("overflow: auto");
  });

  it("removes old glass gradients from the Sessions modal", () => {
    const backdrop = blockFor(".session-observatory-backdrop");
    const panel = blockFor(".session-observatory-panel");
    const empty = blockFor(".session-observatory-empty");

    expect(backdrop).toContain("backdrop-filter: none");
    expect(panel).toContain("background-image: none");
    expect(empty).toContain("background-image: none");
    expect(panel).not.toContain("linear-gradient");
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
    const tile = blockForContaining(".terminal-tile", "box-shadow: none");
    const header = blockFor(".terminal-tile-header");
    const xtermHost = exactBlockFor(".xterm-host");
    const kindMark = blockFor(".tile-kind-mark");
    const kindMarkText = blockFor(".tile-kind-mark span");
    const primaryActions = blockFor(".tile-primary-actions");
    const utilities = blockFor(".tile-utility-actions,\n.tile-danger-actions");
    const readyToolDot = blockFor(".terminal-tile.real-terminal.ready .tool-dot");
    const selectedToolDotRule = ruleForSelectorContaining(".terminal-tile.real-terminal.selected .tool-dot");
    const terminalChromeLayer = styles.slice(styles.indexOf(".terminal-tile.real-terminal .tool-dot"));

    expect(tile).toContain("background: var(--surface-panel)");
    expect(tile).toContain("box-shadow: none");
    expect(header).toContain("min-height");
    expect(header).toContain("background: var(--surface-raised)");
    expect(header).not.toContain("linear-gradient");
    expect(xtermHost).toContain("background: var(--surface-terminal)");
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

    expect(styles).toContain("--role-active: var(--signal-focus)");
    expect(styles).toContain("--role-success: var(--signal-success)");
    expect(manualDot).toContain("var(--role-neutral-marker)");
    expect(manualDot).not.toContain("var(--green)");
    expect(codexDot).toContain("var(--codex-blue)");
    expect(claudeDot).toContain("var(--claude-amber)");
    expect(primaryAction).toContain("background-image: none");
    expect(readyDispatch).toContain("var(--role-active)");
    expect(readyDispatch).not.toContain("var(--role-success)");
    expect(commandActivity).toContain("var(--role-active)");
    expect(activeControlHover).toContain("var(--role-active)");
    expect(activeControlHover).toContain("var(--signal-focus-strong)");
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
    expect(finalPrimaryAction).toContain("var(--border-focus)");
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
    const commandPalette = blockFor(".command-palette,\n.global-review-panel,\n.privacy-panel,\n.session-observatory-panel");

    expect(overlayBackdrop).toContain("backdrop-filter: none");
    expect(overlayBackdrop).toContain("background-image: none");
    expect(commandPalette).toContain("background: var(--surface-panel)");
    expect(commandPalette).toContain("background-image: none");
  });

  it("keeps the Work chrome quiet and command-like", () => {
    const tileUtilities = blockFor(".tile-utility-actions,\n.tile-danger-actions");
    const dispatchBar = blockFor(".dispatch-bar");
    const dispatchChip = blockFor(".dispatch-target-chip,\n.dispatch-bar .composer-input,\n.dispatch-bar .composer-send");

    expect(styles).toContain(".arrange-mode-label");
    expect(tileUtilities).toContain("opacity: 0");
    expect(tileUtilities).toContain("pointer-events: none");
    expect(dispatchBar).toContain("grid-template-rows: 32px 14px");
    expect(dispatchChip).toContain("background-image: none");
    expect(styles).not.toContain(".work-mode-control");
    expect(styles).not.toContain(".layout-controls button");
  });

  it("keeps workbench controls on shared sizing tokens instead of ad-hoc px heights", () => {
    const workbenchControlSizing = blockForContaining(
      ".workbench-tool-group,\n.workbench-actions button,\n.context-toggle-button",
      "height: var(--workbench-control-height)",
    );
    const workbenchSegmentSizing = blockForContaining(
      ".workbench-tool-group button",
      "height: var(--workbench-segment-height)",
    );

    expect(styles).toContain("--workbench-control-height: 32px");
    expect(styles).toContain("--workbench-segment-height: calc(var(--workbench-control-height) - 6px)");
    expect(workbenchControlSizing).toContain("height: var(--workbench-control-height)");
    expect(workbenchControlSizing).toContain("min-height: var(--workbench-control-height)");
    expect(workbenchSegmentSizing).toContain("height: var(--workbench-segment-height)");
    expect(workbenchSegmentSizing).toContain("min-height: var(--workbench-segment-height)");
    expect(styles).not.toMatch(/\.workbench-tool-group button\s*\{[^}]*height:\s*(?:24|30|32)px/s);
  });

  it("keeps passive chrome text readable against the dark panel surface", () => {
    expect(contrastRatio(rootToken("--text-faint"), rootToken("--surface-panel"))).toBeGreaterThanOrEqual(4.0);
  });

  it("keeps chrome microcopy on a readable type floor", () => {
    expect(styles).toContain("--type-micro: 10px");
    expect(styles).not.toMatch(/font-size:\s*(?:8\.5|9)px/);
  });

  it("keeps Context hierarchy quiet except selected session and key signal", () => {
    const drawer = blockForContaining(".context-drawer", "background: var(--surface-panel)");
    const identity = blockForContaining(".agent-context-zone.agent-context-identity", "color: var(--text-muted)");
    const moreDetails = blockForContaining(".agent-context-zone.agent-context-more", "color: var(--text-faint)");
    const activityList = blockForContaining(".agent-activity-list", "color: var(--text-faint)");
    const pulseTitle = blockFor(".agent-session-pulse strong");
    const pulseBody = blockFor(".agent-session-pulse p");
    const handoffButton = blockFor(".agent-handoff-buttons button");

    expect(drawer).toContain("background: var(--surface-panel)");
    expect(identity).toContain("color: var(--text-muted)");
    expect(moreDetails).toContain("color: var(--text-faint)");
    expect(activityList).toContain("color: var(--text-faint)");
    expect(pulseTitle).toContain("color: var(--text-primary)");
    expect(pulseBody).toContain("color: var(--text-muted)");
    expect(handoffButton).toContain("background: color-mix(in oklab, var(--surface-raised) 72%, black 28%)");
  });
});
