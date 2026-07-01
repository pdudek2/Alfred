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

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "gm"))];
  return matches.at(-1)?.groups?.body ?? "";
}

function firstBlockFor(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "m"))?.groups?.body ?? "";
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

  it("keeps Inbox section titles separated from explanatory copy", () => {
    const inboxHeader = blockFor(".inbox-section > header");
    const inboxHeaderCopy = blockFor(".inbox-section > header div");
    const emptyCopy = blockFor(".inbox-section-empty");

    expect(inboxHeader).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(inboxHeaderCopy).toContain("display: grid");
    expect(inboxHeaderCopy).toContain("gap: 4px");
    expect(emptyCopy).toContain("font: 500 13px/1.4 var(--sans)");
  });

  it("keeps the clean flat workbench controls proportional", () => {
    expect(flatStyles).toContain(".workbench-actions button,");
    expect(flatStyles).toContain("height: var(--flat-control-height)");
    expect(flatStyles).toContain("background: var(--flat-control)");
    expect(flatStyles).toContain(".workbench-tool-group");
    expect(flatStyles).toContain("padding: 2px");
    expect(flatStyles).toContain(".workbench-primary-action");
    expect(flatStyles).toContain("background-image: none !important");
  });

  it("keeps header counts quiet instead of rendering badge bubbles", () => {
    const panelGroup = blockFor(".workbench-panel-group button strong");
    const quietDot = blockFor(".quiet-count-dot,\n.quiet-count-mark");

    expect(panelGroup).toContain("display: none");
    expect(quietDot).toContain("border-radius: 999px");
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

  it("keeps the workspace title in the normal top row so it cannot overlap the workbench", () => {
    const frame = blockFor(".desktop-frame");
    const missionBar = blockFor(".mission-bar");

    expect(frame).toContain("grid-template-rows: 52px minmax(0, 1fr) 58px");
    expect(missionBar).toContain("position: static");
    expect(missionBar).toContain("height: 52px");
    expect(polishStyles).toContain(".mission-bar .mission-name {");
    expect(polishStyles).toContain("position: static");
    expect(polishStyles).toContain("max-width: min(420px, 48vw)");
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
    expect(polishStyles).toContain(".session-observatory-stat");
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
    const readyToolDot = blockFor(".terminal-tile.ready .tool-dot");

    expect(header).toContain("min-height");
    expect(header).not.toContain("linear-gradient");
    expect(kindMark).toContain("width: 24px");
    expect(kindMarkText).toContain("display: none");
    expect(primaryActions).toContain("opacity: 1");
    expect(primaryActions).toContain("pointer-events: auto");
    expect(utilities).toContain("opacity: 0");
    expect(utilities).toContain("pointer-events: none");
    expect(readyToolDot).not.toContain("var(--green)");
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
  });
});
