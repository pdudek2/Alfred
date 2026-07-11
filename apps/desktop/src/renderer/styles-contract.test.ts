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

function mediaBlockFor(query: string): string {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`@media\\s*${escapedQuery}\\s*\\{(?<body>[\\s\\S]*?)^\\}`, "m"))?.groups?.body ?? "";
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

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function exactRuleBodiesIn(source: string, selector: string): string[] {
  const commentlessSource = withoutComments(source);
  return [...commentlessSource.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gm)]
    .filter((match) =>
      (match.groups?.selectors ?? "")
        .split(",")
        .some((candidate) => candidate.trim() === selector),
    )
    .map((match) => match.groups?.body ?? "");
}

function exactRuleBodies(selector: string): string[] {
  return exactRuleBodiesIn(styles, selector);
}

function balancedBlockBody(source: string, openingBraceIndex: number): { body: string; end: number } {
  let depth = 1;
  for (let index = openingBraceIndex + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return { body: source.slice(openingBraceIndex + 1, index), end: index };
  }
  throw new Error("Unbalanced CSS block");
}

function topLevelExactRuleBodiesIn(source: string, selector: string): string[] {
  const commentlessSource = withoutComments(source);
  let topLevelStyles = "";
  let cursor = 0;
  const mediaStart = /@media\s*[^{}]+\{/g;
  for (const match of commentlessSource.matchAll(mediaStart)) {
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    const block = balancedBlockBody(commentlessSource, openingBraceIndex);
    topLevelStyles += commentlessSource.slice(cursor, match.index);
    topLevelStyles += "\n".repeat(commentlessSource.slice(match.index, block.end + 1).split("\n").length - 1);
    cursor = block.end + 1;
  }
  topLevelStyles += commentlessSource.slice(cursor);
  return exactRuleBodiesIn(topLevelStyles, selector);
}

function topLevelExactRuleBodies(selector: string): string[] {
  return topLevelExactRuleBodiesIn(styles, selector);
}

function mediaExactRuleBodiesIn(source: string, query: string, selector: string): string[] {
  const commentlessSource = withoutComments(source);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mediaStart = new RegExp(`@media\\s*${escapedQuery}\\s*\\{`, "g");
  const bodies: string[] = [];
  for (const match of commentlessSource.matchAll(mediaStart)) {
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    bodies.push(...exactRuleBodiesIn(balancedBlockBody(commentlessSource, openingBraceIndex).body, selector));
  }
  return bodies;
}

function mediaExactRuleBodies(query: string, selector: string): string[] {
  return mediaExactRuleBodiesIn(styles, query, selector);
}

function canonicalBaseRuleBodiesIn(source: string, selector: string): string[] {
  return topLevelExactRuleBodiesIn(source, selector);
}

function expectCanonicalBase(selector: string, requiredDeclarations: string[]): void {
  const bodies = canonicalBaseRuleBodiesIn(styles, selector);
  expect(bodies, `${selector} must have one canonical base rule`).toHaveLength(1);
  for (const declaration of requiredDeclarations) expect(bodies[0]).toContain(declaration);
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
  it("does not treat a media-only fixture as a canonical top-level base", () => {
    const fixture = `@media (max-width: 980px) { .fixture-owner { display: grid; } }`;
    expect(canonicalBaseRuleBodiesIn(fixture, ".fixture-owner")).toHaveLength(0);
  });

  it("does not discover media owners inside comments", () => {
    const fixture = `/* @media (max-width: 980px) { .fixture-owner { display: none; } } */`;
    expect(mediaExactRuleBodiesIn(fixture, "(max-width: 980px)", ".fixture-owner")).toHaveLength(0);
  });

  it("keeps one canonical base owner for frame chrome and navigation", () => {
    const desktopFrameBodies = topLevelExactRuleBodies(".desktop-frame");
    expect(desktopFrameBodies).toHaveLength(1);
    expect(desktopFrameBodies[0]).toContain("display: grid");
    expect(desktopFrameBodies[0]).toContain("overflow: hidden");
    expect(mediaExactRuleBodies("(max-width: 980px)", ".desktop-frame")).toHaveLength(1);

    expectCanonicalBase(".mission-bar", ["display: flex", "min-height: 46px"]);
    expectCanonicalBase(".mission-name", ["display: flex", "min-width: 0"]);
    expectCanonicalBase(".workspace-title-menu", ["position: relative", "min-width: 0"]);
    expect(topLevelExactRuleBodies(".workspace-title-trigger")).toHaveLength(1);
    expect(mediaExactRuleBodies("(max-width: 980px)", ".workspace-title-trigger")).toHaveLength(1);
    expectCanonicalBase(".workbench-header", ["align-items: center", "padding: 9px 12px"]);
    expectCanonicalBase(".workbench-actions", ["display: flex", "gap: 8px"]);
    const workbenchToolGroupBodies = topLevelExactRuleBodies(".workbench-tool-group");
    expect(workbenchToolGroupBodies).toHaveLength(1);
    expect(workbenchToolGroupBodies.some((body) => body.includes("display: inline-flex") && body.includes("padding: 2px"))).toBe(true);
    expectCanonicalBase(".workbench-bar-title", ["display: flex", "white-space: nowrap"]);
    expectCanonicalBase(".workbench-bar-spacer", ["flex: 1 1 auto", "min-width: 8px"]);

    expectCanonicalBase(".primary-nav-rail", ["display: grid", "grid-template-rows: auto 1fr auto"]);
    // Shared dimensions with rail buttons plus the brand component base.
    const primaryNavBrandBodies = exactRuleBodies(".primary-nav-brand");
    expect(primaryNavBrandBodies).toHaveLength(2);
    expect(primaryNavBrandBodies.some((body) => body.includes("display: grid") && body.includes("place-items: center"))).toBe(true);
    expectCanonicalBase(".primary-nav-stack", ["display: grid", "align-content: start"]);
    expectCanonicalBase(".primary-nav-bottom", ["align-content: end"]);

    expectCanonicalBase(".workspace-navigation-panel", ["min-width: 0", "display: grid"]);
    expectCanonicalBase(".workspace-nav-head", ["display: grid", "align-items: center"]);
    expectCanonicalBase(".workspace-nav-avatar", ["display: grid", "place-items: center"]);
    expectCanonicalBase(".workspace-nav-search", ["display: grid", "align-items: center"]);
    // Component base plus the shared native-scrollbar owner.
    const workspaceNavScrollBodies = exactRuleBodies(".workspace-nav-scroll");
    expect(workspaceNavScrollBodies).toHaveLength(2);
    expect(workspaceNavScrollBodies.some((body) => body.includes("overflow: auto") && body.includes("align-content: start"))).toBe(true);
    expectCanonicalBase(".workspace-nav-section", ["display: grid", "gap: 7px"]);
    expectCanonicalBase(".workspace-nav-section > header", ["text-transform: uppercase"]);
    expectCanonicalBase(".workspace-nav-list", ["display: grid", "gap: 6px"]);
    expectCanonicalBase(".workspace-nav-more-button", ["min-height: 32px"]);
    expectCanonicalBase(".workspace-nav-row", ["display: grid", "width: 100%"]);
    expectCanonicalBase(".workspace-nav-mark", ["display: grid", "place-items: center"]);
    expectCanonicalBase(".workspace-nav-mark.codex", ["border-color:"]);
    expectCanonicalBase(".workspace-nav-mark.claude", ["border-color:"]);
    expectCanonicalBase(".workspace-nav-mark.alert", ["border-color:"]);
    // Shared navigation microcopy typography plus the empty-state color owner.
    const workspaceNavEmptyBodies = exactRuleBodies(".workspace-nav-empty");
    expect(workspaceNavEmptyBodies).toHaveLength(2);
    expect(workspaceNavEmptyBodies.some((body) => body.includes("color: var(--text-faint)"))).toBe(true);
  });

  it("keeps Slice A interaction winners adjacent to their canonical components", () => {
    const workspaceNavHover = topLevelExactRuleBodies(".workspace-nav-row:hover");
    const workspaceNavFocus = topLevelExactRuleBodies(".workspace-nav-row:focus-visible");
    expect(workspaceNavHover).toHaveLength(1);
    expect(workspaceNavFocus).toHaveLength(1);
    expect(workspaceNavHover[0]).toContain("background: color-mix(in oklab, var(--surface-raised) 72%, black 28%)");
    expect(workspaceNavHover[0]).toContain("background-image: none");

    expect(topLevelExactRuleBodies(".workbench-actions button")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-actions button:hover")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-actions button:focus-visible")).toHaveLength(1);
    expect(topLevelExactRuleBodies('.workbench-actions button[aria-pressed="true"]')).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-actions button.active")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-tool-group button")).toHaveLength(1);
    expect(topLevelExactRuleBodies('.workbench-tool-group button[aria-pressed="true"]')).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-tool-group button.active")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-primary-action")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-primary-action:hover")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workbench-primary-action:focus-visible")).toHaveLength(1);
    expect(topLevelExactRuleBodies('.workbench-launch-group button[aria-label="Start Codex"]')).toHaveLength(1);
    expect(topLevelExactRuleBodies('.workbench-launch-group button[aria-label="Start Claude"]')).toHaveLength(1);
    expect(topLevelExactRuleBodies(".primary-nav-rail button.active")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".primary-nav-rail button:hover")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".primary-nav-rail button:focus-visible")).toHaveLength(1);
  });

  it("uses one canonical tactical-dark token hierarchy", () => {
    expect(tokenDefinitionCount("--surface-terminal")).toBe(1);
    expect(tokenDefinitionCount("--surface-canvas")).toBe(1);
    expect(tokenDefinitionCount("--surface-panel")).toBe(1);
    expect(tokenDefinitionCount("--surface-raised")).toBe(1);
    expect(tokenDefinitionCount("--surface-workbench")).toBe(1);
    expect(tokenDefinitionCount("--surface-chrome")).toBe(1);
    expect(tokenDefinitionCount("--surface-control")).toBe(1);
    expect(tokenDefinitionCount("--surface-control-hover")).toBe(1);
    expect(tokenDefinitionCount("--surface-tile-header")).toBe(1);
    expect(tokenDefinitionCount("--text-primary")).toBe(1);
    expect(tokenDefinitionCount("--text-muted")).toBe(1);
    expect(tokenDefinitionCount("--text-faint")).toBe(1);

    expect(rootToken("--surface-workbench")).toBe("#040506");
    expect(rootToken("--surface-chrome")).toBe("#07090b");
    expect(rootToken("--surface-chrome-soft")).toBe("#0b0f13");
    expect(rootToken("--surface-control")).toBe("#090d11");
    expect(rootToken("--surface-control-hover")).toBe("#10151a");
    expect(rootToken("--surface-tile-header")).toBe("#0b0f13");
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
  });

  it("keeps the CSS terminal surface on the legacy shell rail", () => {
    const xtermHost = blockFor(".terminal-tile .terminal-host,\n.terminal-tile .xterm-host");

    expect(rootToken("--surface-terminal")).toBe("#070808");
    expect(rootToken("--signal-focus")).toBe("#55bdca");
    expect(xtermHost).toContain("background: var(--surface-terminal)");
  });

  it("routes operational colors through signal tokens", () => {
    expect(styles).not.toMatch(/rgba\(83,\s*199,\s*216,/);
    expect(styles).not.toMatch(/rgba\(217,\s*174,\s*70,/);
    expect(styles).not.toMatch(/#(?:35d47f|37d884|3ee68a)/i);
    expect(rootToken("--signal-agent")).toBe("#e0b75b");
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
    expect(arrangingGrid).toContain("--arrange-bottom-safe-zone: 156px");
    expect(arrangingGrid).toContain("flex: 0 0 auto");
    expect(arrangingGrid).toContain("min-height: calc(100% + var(--arrange-bottom-safe-zone))");
    expect(arrangingGrid).toContain("padding-bottom: var(--arrange-bottom-safe-zone)");
  });

  it("keeps the terminal Grid scrollbar visually quiet", () => {
    const gridColumn = exactBlockFor(".terminal-grid-column");

    expect(gridColumn).toContain("scrollbar-width: thin");
    expect(gridColumn).toContain("scrollbar-color:");
  });

  it("keeps terminal stage sizing and scroll propagation contracts", () => {
    const stage = exactBlockFor(".surface-panel > .terminal-stage");
    const gridColumn = exactBlockFor(".terminal-grid-column");

    expect(stage).toContain("height: 100%");
    expect(stage).toContain("max-height: 100%");
    expect(gridColumn).toContain("height: 100%");
    expect(gridColumn).toContain("max-height: 100%");
    expect(gridColumn).toContain("overscroll-behavior: contain");
    expect(gridColumn).toContain("scrollbar-gutter: stable");
  });

  it("keeps Inbox section titles quiet and inline", () => {
    const inboxHeader = blockFor(".inbox-section > header");

    expect(inboxHeader).toContain("display: flex");
    expect(inboxHeader).toContain("align-items: baseline");
    expect(inboxHeader).toContain("background: transparent");
  });

  it("omits empty Inbox lane chrome because empty sections are not rendered", () => {
    const inboxStack = blockFor(".inbox-section-stack");
    const waitingCount = blockFor(".review-surface-header .review-surface-waiting");

    expect(inboxStack).toContain("align-content: start");
    expect(inboxStack).toContain("align-items: start");
    expect(inboxStack).toContain("grid-auto-rows: max-content");
    expect(waitingCount).toContain("font-size: 12.5px");
    expect(waitingCount).toContain("color: var(--text-muted)");
    expect(styles).not.toContain(".inbox-section.is-empty");
    expect(styles).not.toContain('.inbox-section[data-state="empty"]');
  });

  it("keeps the clean flat workbench controls proportional", () => {
    const workbenchAction = exactBlockFor(".workbench-actions button");
    const workbenchToolGroup = blockFor(".workbench-tool-group");
    const primaryAction = exactBlockFor(".workbench-primary-action");

    expect(workbenchAction).toMatch(/height:\s*(?:var\(--workbench-control-height\)|var\(--control-height\)|32px)/);
    expect(workbenchAction).toContain("background:");
    expect(workbenchToolGroup).toContain("padding: 2px");
    expect(primaryAction).toContain("height:");
    expect(styles).not.toContain("--flat-control-height");
    expect(styles).not.toContain("--flat-control");
  });

  it("keeps count indicators quiet instead of rendering numeric badge pills", () => {
    const quietIndicators = blockFor(".quiet-count-dot,\n.quiet-count-mark");
    const primaryNavIndicators = blockFor(
      ".primary-nav-rail button > .quiet-count-dot,\n.primary-nav-rail button > .quiet-count-mark",
    );

    expect(quietIndicators).toContain("width: 6px");
    expect(quietIndicators).toContain("height: 6px");
    expect(quietIndicators).toContain("border-radius: 999px");
    expect(primaryNavIndicators).toContain("position: absolute");
    expect(primaryNavIndicators).toContain("top: 5px");
    expect(primaryNavIndicators).toContain("right: 5px");
    expect(styles).not.toMatch(/\.primary-nav-rail button\s*(?:>\s*)?span\s*\{/);
    expect(styles).not.toContain(".workbench-panel-group button strong");
    expect(styles).not.toContain(".workbench-actions button strong");
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
    const reviewEmpty = blockForContaining(".review-surface-empty", "align-self: start");

    expect(reviewEmpty).toContain("align-self: start");
    expect(reviewEmpty).toContain("min-height: 0");
    expect(reviewEmpty).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(reviewEmpty).toContain("background-image: none");
    expect(styles).not.toContain(".review-empty-lanes");
  });

  it("styles workspace scrollbars so native white rails do not dominate the shell", () => {
    const workspaceScroll = blockFor(
      ".workspace-nav-scroll,\n.terminal-stage-body,\n.inbox-section-stack,\n.observatory-surface,\n.observatory-projects,\n.observatory-session-list,\n.context-drawer,\n.agent-timeline-panel",
    );
    const scrollbarThumb = blockFor(
      ".workspace-nav-scroll::-webkit-scrollbar-thumb,\n.terminal-stage-body::-webkit-scrollbar-thumb,\n.inbox-section-stack::-webkit-scrollbar-thumb,\n.observatory-surface::-webkit-scrollbar-thumb,\n.observatory-projects::-webkit-scrollbar-thumb,\n.observatory-session-list::-webkit-scrollbar-thumb,\n.context-drawer::-webkit-scrollbar-thumb,\n.agent-timeline-panel::-webkit-scrollbar-thumb",
    );

    expect(workspaceScroll).toContain("scrollbar-width: thin");
    expect(workspaceScroll).toContain("scrollbar-color:");
    expect(scrollbarThumb).toContain("background:");
  });

  it("keeps the top chrome in one frame row with a flexible workbench title", () => {
    const frame = blockFor(".desktop-frame");
    const missionBar = exactBlockFor(".mission-bar");
    const workbenchHeader = blockFor(".mission-bar .workbench-header");
    const title = blockFor(".workbench-bar-title");
    const spacer = blockFor(".workbench-bar-spacer");

    expect(frame).toContain("grid-template-rows: 52px minmax(0, 1fr) 58px");
    expect(missionBar).toContain("display: flex");
    expect(workbenchHeader).toContain("min-width: 0");
    expect(title).toContain("white-space: nowrap");
    expect(spacer).toContain("flex: 1 1 auto");
  });

  it("drops deduped chrome selectors from the sheet", () => {
    expect(styles).not.toContain(".workbench-crumbs");
    expect(styles).not.toContain(".workbench-title-block");
    expect(styles).not.toContain(".terminal-stage-utility");
    expect(styles).not.toContain(".agent-activity-digest");
    expect(styles).not.toContain(".review-surface-stats");
  });

  it("lays the one-bar chrome and inbox rows out on the approved grids", () => {
    expect(exactBlockFor(".mission-bar")).toContain("display: flex");
    expect(blockFor(".mission-bar .workbench-header")).toContain("flex: 1");
    expect(blockFor(".review-surface-row")).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(blockFor(".review-surface-row")).toContain("grid-column: 1 / -1");
    expect(blockFor(".recovery-workspace-strip")).toContain("background: transparent");
  });

  it("keeps the final restart disclosure compact", () => {
    const restartSummary = blockFor(".review-surface-command.is-disclosure summary");

    expect(restartSummary).toContain("justify-self: start");
    expect(restartSummary).toContain("justify-content: flex-start");
    expect(restartSummary).toContain("min-height: 0");
    expect(restartSummary).toContain("padding: 0");
  });

  it("resets inherited height on the final Inbox section header", () => {
    expect(blockFor(".inbox-section > header")).toContain("min-height: 0");
  });

  it("reduces agent launch padding inside the 1240px breakpoint", () => {
    const compactChrome = mediaBlockFor("(max-width: 1240px)");
    const compactAgentLaunch = firstBlockFor(
      compactChrome,
      ".workbench-launch-group button:not(.workbench-primary-action)",
    );

    expect(compactAgentLaunch).toContain("padding: 6px 7px");
    expect(firstBlockFor(compactChrome, ".workbench-bar-title span")).toContain("display: none");
  });

  it("lays workspace title and detail out inline in the one bar", () => {
    const workspaceTitle = blockFor(".workspace-title-trigger > span");

    expect(workspaceTitle).toContain("display: flex");
    expect(workspaceTitle).toContain("flex-direction: row");
    expect(workspaceTitle).toContain("align-items: baseline");
  });

  it("uses only the disclosure caret marker for Inbox commands", () => {
    expect(styles).not.toContain(".review-surface-command summary::after");
    expect(styles).not.toContain(".review-surface-command[open] summary::after");
    expect(blockFor(".review-surface-command.is-disclosure summary::before")).toContain('content: "▸"');
    expect(blockFor(".review-surface-command.is-disclosure[open] summary::before")).toContain('content: "▾"');
  });

  it("drops Inbox selectors for markup that is no longer rendered", () => {
    expect(styles).not.toContain(".inbox-section > header div");
    expect(styles).not.toContain(".inbox-section > header span");
    expect(styles).not.toContain(".inbox-section-empty");
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

    expect(recoveryCopy).toContain("gap: 6px");
  });

  it("keeps the Arrange resize handle visually distinct", () => {
    const resizeHandle = blockFor(".tile-resize-handle");

    expect(resizeHandle).toContain("width: 32px");
    expect(resizeHandle).toContain("background-image: none");
  });

  it("keeps terminal tile chrome secondary to the xterm body", () => {
    const tile = blockForContaining(".terminal-tile", "box-shadow: none");
    const header = blockFor(".terminal-tile-header");
    const tileTitle = blockFor(".terminal-tile-header .tile-title b");
    const xtermHost = exactBlockFor(".xterm-host");
    const kindMark = blockFor(".tile-kind-mark");
    const kindMarkText = blockFor(".tile-kind-mark span");
    const primaryActions = blockFor(".tile-primary-actions");
    const primaryActionButton = blockForContaining(".tile-primary-actions .continue-button", "var(--role-active)");
    const utilities = blockFor(".tile-utility-actions,\n.tile-danger-actions");
    const utilityButtons = blockFor(".tile-utility-actions button,\n.tile-danger-actions button");
    const readyToolDot = blockFor(".terminal-tile.real-terminal.ready .tool-dot");
    const selectedToolDotRule = ruleForSelectorContaining(".terminal-tile.real-terminal.selected .tool-dot");
    const terminalChromeLayer = styles.slice(styles.indexOf(".terminal-tile.real-terminal .tool-dot"));

    expect(tile).toContain("background: var(--surface-chrome)");
    expect(tile).toContain("box-shadow: none");
    expect(header).toContain("min-height");
    expect(header).toContain("background: var(--surface-tile-header)");
    expect(header).not.toContain("linear-gradient");
    expect(tileTitle).toContain("font: 650 13px/1.12 var(--sans)");
    expect(xtermHost).toContain("background: var(--surface-terminal)");
    expect(kindMark).toContain("width: 24px");
    expect(kindMarkText).toContain("display: none");
    expect(primaryActions).toContain("opacity: 1");
    expect(primaryActions).toContain("pointer-events: auto");
    expect(primaryActionButton).toContain("var(--role-active)");
    expect(utilities).toContain("opacity: 0");
    expect(utilities).toContain("pointer-events: none");
    expect(utilityButtons).toContain("color: var(--text-faint)");
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
    const primaryAction = exactBlockFor(".workbench-primary-action");
    const readyDispatch = blockFor(".dispatch-bar[data-state=\"ready\"] .composer-send:enabled");
    const commandActivity = blockFor(".agent-activity-object.type-command,\n.agent-activity-object.type-file");
    const activeControlHover = exactBlockFor('.workbench-tool-group button[aria-pressed="true"]:hover');
    const codexHover = blockFor(".workbench-launch-group button[aria-label=\"Start Codex\"]:hover,\n.workbench-launch-group button[aria-label=\"Start Codex\"]:focus-visible");
    const claudeHover = blockFor(".workbench-launch-group button[aria-label=\"Start Claude\"]:hover,\n.workbench-launch-group button[aria-label=\"Start Claude\"]:focus-visible");

    expect(styles).toContain("--role-active: var(--signal-focus)");
    expect(styles).toContain("--role-success: var(--signal-success)");
    expect(styles).toContain("--role-control: var(--surface-control)");
    expect(styles).toContain("--role-control-hover: var(--surface-control-hover)");
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
    const finalPrimaryAction = exactBlockFor(".workbench-primary-action");

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
    const overlayBackdrop = blockFor(
      ".privacy-backdrop,\n.discard-checkout-backdrop,\n.command-palette-backdrop,\n.session-observatory-backdrop",
    );
    const commandPalette = blockFor(
      ".command-palette,\n.privacy-panel,\n.discard-checkout-dialog,\n.session-observatory-panel",
    );

    expect(overlayBackdrop).toContain("backdrop-filter: none");
    expect(overlayBackdrop).toContain("background-image: none");
    expect(commandPalette).toContain("background: var(--surface-panel)");
    expect(commandPalette).toContain("background-image: none");
  });

  it("keeps the Work chrome quiet and command-like", () => {
    const tileUtilities = blockFor(".tile-utility-actions,\n.tile-danger-actions");
    const dispatchBar = blockFor(".dispatch-bar");
    const dispatchCapsule = blockFor(".dispatch-capsule");
    const dispatchChip = blockFor(".dispatch-target-chip,\n.dispatch-bar .composer-input,\n.dispatch-bar .composer-send");

    expect(styles).toContain(".arrange-mode-label");
    expect(tileUtilities).toContain("opacity: 0");
    expect(tileUtilities).toContain("pointer-events: none");
    expect(dispatchBar).toContain("grid-template-rows: var(--control-height) 14px");
    expect(dispatchCapsule).toContain("height: var(--control-height)");
    expect(dispatchCapsule).toContain("background-image: none");
    expect(dispatchChip).toContain("background-image: none");
  });

  it("keeps workbench controls on shared sizing tokens instead of ad-hoc px heights", () => {
    const workbenchControlSizing = exactBlockFor(".workbench-actions button");
    const workbenchSegmentSizing = exactBlockFor(".workbench-tool-group button");

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
    const disclosureMarker = blockFor(".review-surface-command.is-disclosure summary::before");
    const textStyles = styles.replace(
      /\.review-surface-command\.is-disclosure summary::before\s*\{[^}]*\}/,
      "",
    );

    expect(styles).toContain("--type-micro: 10px");
    expect(disclosureMarker).toContain("font-size: 9px");
    expect(textStyles).not.toMatch(/font-size:\s*(?:8\.5|9)px/);
  });

  it("keeps Context hierarchy quiet except selected session and key signal", () => {
    const drawer = blockForContaining(".context-drawer", "background: var(--surface-panel)");
    const essentials = blockFor(".agent-context-essentials");
    const essentialsCommand = blockFor(".agent-essentials-command");
    const disclosureToggle = blockFor(".agent-disclosure-toggle");
    const factLabel = blockFor(".agent-session-facts dt");
    const factValue = blockFor(".agent-session-facts dd");
    const pulseTitle = blockFor(".agent-session-pulse strong");
    const pulseBody = blockFor(".agent-session-pulse p");
    const handoffButton = blockFor(".agent-handoff-buttons button");

    expect(drawer).toContain("background: var(--surface-panel)");
    expect(essentials).toContain("background: var(--surface-control)");
    expect(essentialsCommand).toContain("var(--mono)");
    expect(disclosureToggle).toContain("var(--sans)");
    expect(disclosureToggle).not.toContain("uppercase");
    expect(factLabel).toContain("var(--sans)");
    expect(factValue).toContain("color: var(--text-secondary)");
    expect(pulseTitle).toContain("color: var(--text-primary)");
    expect(pulseBody).toContain("color: var(--text-muted)");
    expect(handoffButton).toContain("background: var(--surface-control)");
    expect(styles).not.toContain(".agent-context-zone");
    expect(styles).not.toContain(".agent-section-heading");
  });

  it("keeps sidebar radar hierarchy quiet but readable", () => {
    const navPanel = exactBlockFor(".workspace-navigation-panel");
    const navSectionHeader = blockFor(".workspace-nav-section > header");
    const navRow = blockFor(".workspace-nav-row");
    const navRowTitle = blockFor(".workspace-nav-row strong");
    const navRowMeta = blockFor(".workspace-nav-row small");
    const inactiveWorkspaceTitle = blockFor(".workspace-button:not(.active) .workspace-button-details strong");
    const inactiveWorkspaceMeta = blockFor(".workspace-button:not(.active) .workspace-button-details span");
    const activeWorkspace = blockFor(".workspace-button.active");

    expect(navPanel).toContain("background: var(--surface-chrome)");
    expect(navSectionHeader).toContain("color: var(--text-faint)");
    expect(navSectionHeader).toContain("var(--sans)");
    expect(navRow).toContain("background: transparent");
    expect(navRow).toContain("grid-template-columns: 26px minmax(0, 1fr) auto");
    expect(navRowTitle).toContain("color: var(--text-secondary)");
    expect(navRowTitle).toContain("font: 650 13px/1.22 var(--sans)");
    expect(navRowTitle).toContain("text-overflow: ellipsis");
    expect(navRowTitle).toContain("white-space: nowrap");
    expect(navRowMeta).toContain("color: var(--text-faint)");
    expect(inactiveWorkspaceTitle).toContain("color: var(--text-secondary)");
    expect(inactiveWorkspaceTitle).toContain("font: 600 12px/1.2 var(--sans)");
    expect(inactiveWorkspaceMeta).toContain("color: var(--text-faint)");
    expect(activeWorkspace).toContain("background: color-mix(in oklab, var(--signal-focus) 3.5%, var(--surface-control))");
    expect(activeWorkspace).not.toContain("linear-gradient");
    expect(activeWorkspace).toContain("box-shadow: none");
  });

  it("keeps overlays opaque and tactical instead of glassy", () => {
    const primaryOverlayBackdrop = blockFor(
      ".privacy-backdrop,\n.discard-checkout-backdrop,\n.command-palette-backdrop",
    );
    const quickSwitchBackdrop = blockFor(".session-observatory-backdrop");
    const overlayPanels = blockFor(
      ".command-palette,\n.privacy-panel,\n.discard-checkout-dialog,\n.session-observatory-panel",
    );
    const activePaletteRow = blockFor(
      ".command-palette-list button:hover,\n.command-palette-list button:focus-visible,\n.command-palette-list button.active",
    );

    expect(primaryOverlayBackdrop).toContain("background: rgba(0, 0, 0, 0.66)");
    expect(primaryOverlayBackdrop).toContain("background-image: none");
    expect(primaryOverlayBackdrop).toContain("backdrop-filter: none");
    expect(primaryOverlayBackdrop).toContain("-webkit-backdrop-filter: none");
    expect(quickSwitchBackdrop).toContain("background: rgba(0, 0, 0, 0.54)");
    expect(quickSwitchBackdrop).toContain("backdrop-filter: none");
    expect(overlayPanels).toContain("background: var(--surface-panel)");
    expect(overlayPanels).toContain("background-image: none");
    expect(overlayPanels).toContain("border: 1px solid var(--border)");
    expect(overlayPanels).toContain("box-shadow: var(--shadow-panel)");
    expect(activePaletteRow).not.toContain("linear-gradient");
  });
});
