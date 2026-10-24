import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { preprocessCSS, resolveConfig } from "vite";
import { ghosttyVesperTerminalProfile } from "./terminal-visual-profile";

const stylesPath = [
  resolve(process.cwd(), "src/renderer/styles.css"),
  resolve(process.cwd(), "apps/desktop/src/renderer/styles.css"),
].find((candidate) => existsSync(candidate));

if (!stylesPath) {
  throw new Error("Unable to locate renderer styles.css");
}

const styles = readFileSync(stylesPath, "utf8");
const productCssPaths = [
  "styles.css",
  "components/needs-you-popover.css",
  "components/workspace-preview.css",
  "components/worktree-diff-panel.css",
  "components/plan-line.css",
  "components/history.css",
  "components/new-session-sheet.css",
].map((relativePath) => [
  resolve(process.cwd(), "src/renderer", relativePath),
  resolve(process.cwd(), "apps/desktop/src/renderer", relativePath),
].find((candidate) => existsSync(candidate)));

if (productCssPaths.some((path) => !path)) throw new Error("Unable to locate product CSS");
const productStyles = productCssPaths.map((path) => readFileSync(path!, "utf8")).join("\n");
const previewStylesPath = productCssPaths[2]!;
const previewStyles = readFileSync(productCssPaths[2]!, "utf8");
const historyStyles = readFileSync(productCssPaths[5]!, "utf8");
const lightningCssConfig = resolveConfig(
  { configFile: false, css: { transformer: "lightningcss" } },
  "build",
);

async function parseWithLightningCss(source: string, filename: string): Promise<void> {
  await preprocessCSS(source, filename, await lightningCssConfig);
}

function isLiveShellSelector(selector: string): boolean {
  if (
    selector.startsWith(".workspace-layout.surface-sessions")
  ) return false;

  return [
    ".agent-space-shell", ".desktop-frame", ".mission-bar", ".desktop-alert-stack",
    ".workspace-title", ".workspace-popover", ".workspace-rename-form", ".workspace-mission-form",
    ".workspace-layout", ".project-navigator", ".project-", ".free-chat-",
    ".alfred-mark", ".workbench-", ".work-surface-", ".chrome-menu", ".prepare-work-popover",
    ".desktop-save-", ".shell-action-", ".recovery-",
    ".terminal-", ".tile-", ".tool-dot", ".session-status-", ".session-rename-form", ".session-strip",
    ".split-empty-", ".staged-", ".arrange-", ".xterm-host", ".composer-", ".dispatch-",
  ].some((prefix) => selector.includes(prefix));
}

function orphanClassTokenPattern(className: string): RegExp {
  const escapedClassName = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${escapedClassName}(?:[^a-zA-Z0-9_-]|$)`);
}

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "gm"))];
  return matches.at(-1)?.groups?.body ?? "";
}

function declaredMinHeightPx(body: string): number {
  return Number(body.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
}

function exactBlockFor(selector: string): string {
  // A comment above a rule would otherwise be read as part of its selector.
  const matches = [...withoutComments(styles).matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gm)].filter((match) =>
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

function topLevelStylesOnlyIn(source: string): string {
  const commentlessSource = withoutComments(source);
  let topLevelStyles = "";
  let cursor = 0;
  const nestedAtRuleStart = /@(media|container)\s*[^{}]+\{/g;
  for (const match of commentlessSource.matchAll(nestedAtRuleStart)) {
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    const block = balancedBlockBody(commentlessSource, openingBraceIndex);
    topLevelStyles += commentlessSource.slice(cursor, match.index);
    topLevelStyles += "\n".repeat(commentlessSource.slice(match.index, block.end + 1).split("\n").length - 1);
    cursor = block.end + 1;
  }
  topLevelStyles += commentlessSource.slice(cursor);
  return topLevelStyles;
}

function topLevelExactRuleBodiesIn(source: string, selector: string): string[] {
  return exactRuleBodiesIn(topLevelStylesOnlyIn(source), selector);
}

function topLevelRulesIn(source: string): Array<{ selectors: string[]; body: string }> {
  return [...topLevelStylesOnlyIn(source).matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gm)].map((match) => ({
    selectors: (match.groups?.selectors ?? "").split(",").map((selector) => selector.trim()).filter(Boolean),
    body: match.groups?.body ?? "",
  }));
}

function allRulesIn(source: string): Array<{ selectors: string[]; body: string }> {
  const rules = topLevelRulesIn(source);
  const commentlessSource = withoutComments(source);
  const nestedAtRuleStart = /@(media|container)\s*[^{}]+\{/g;
  for (const match of commentlessSource.matchAll(nestedAtRuleStart)) {
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    rules.push(...allRulesIn(balancedBlockBody(commentlessSource, openingBraceIndex).body));
  }
  return rules;
}

function topLevelExactRuleBodies(selector: string): string[] {
  return topLevelExactRuleBodiesIn(styles, selector);
}

function singleTopLevelRuleBodyIn(source: string, selector: string): string {
  const bodies = topLevelExactRuleBodiesIn(source, selector);
  if (bodies.length !== 1) {
    throw new Error(`${selector} must have one top-level rule body; found ${bodies.length}`);
  }
  return bodies[0] ?? "";
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
  const match = styles.match(new RegExp(`${name}:\\s*([^;]+);`, "i"));
  return match?.[1] ?? "";
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
  it("gives Preview one component stylesheet owner and no dock", async () => {
    expect(styles).not.toMatch(/\.workspace-preview-/);
    expect(previewStyles).toContain(".workspace-preview-panel");
    // Preview shares the terminal's grid cell in the focused box instead of docking beside it.
    expect(previewStyles).toMatch(/\.terminal-tile-preview \{\s+grid-area: 1 \/ 1;/);
    expect(styles).toMatch(/\.terminal-tile > \.xterm-host \{\s+grid-area: 1 \/ 1;/);
    expect(productStyles).not.toMatch(/workspace-preview-(dock|split|divider|width-hud)/);
    await expect(parseWithLightningCss(previewStyles, previewStylesPath)).resolves.toBeUndefined();
  });

  it("keeps shared surface typography and terminal transitions quiet", () => {
    expect(singleTopLevelRuleBodyIn(styles, ":root")).toContain(
      '--sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    );
    expect(singleTopLevelRuleBodyIn(styles, ":root")).not.toContain(["--", "mono"].join(""));

    for (const selector of [".xterm-host", ".orchestrator-surface", ".surface-panel"]) {
      expect(allRulesIn(styles).filter(({ selectors }) => selectors.includes(selector)).map(({ body }) => body).join("\n"))
        .not.toMatch(/transition\s*:/);
    }

    expect(styles).not.toMatch(orphanClassTokenPattern(["project-attention", "dot"].join("-")));
    expect(styles).not.toMatch(/\.tone-(?:waiting|staged|blocked|restored|done|error)\b/);
  });

  it("keeps the complete stylesheet compatible with Lightning CSS minification", async () => {
    const invalidFixture = `
      .fixture-one,
      .fixture-two {
      .fixture-three { color: red; }
      @keyframes fixture-motion { from { opacity: 0; } to { opacity: 1; } }
    `;

    await expect(parseWithLightningCss(invalidFixture, "invalid-fixture.css")).rejects.toThrow(/Unknown at rule/);
    await expect(parseWithLightningCss(styles, stylesPath)).resolves.toBeUndefined();
  });

  it("defines the approved achromatic material ramp exactly once", () => {
    const expectedTokens = {
      "--ink-0": "#050506",
      "--ink-1": "#0A0A0B",
      "--ink-2": "#111113",
      "--ink-3": "#1B1B1E",
      "--ink-4": "#64646B",
      "--ink-5": "#929299",
      "--ink-6": "#CECED2",
      "--ink-7": "#F3F3F4",
      "--signal": "#E29B6E",
      "--surface-terminal": "#101010",
      "--surface-canvas": "#060607",
      "--surface-panel": "#0E0E10",
      "--surface-raised": "#151518",
      "--surface-chrome": "#0C0C0E",
      "--surface-control": "#151518",
      "--surface-control-hover": "#1C1C20",
      "--text-primary": "#F0F0F2",
      "--text-secondary": "#CACACF",
      "--text-muted": "#96969E",
      "--text-faint": "#7E7E87",
      "--border": "rgba(255, 255, 255, 0.05)",
      "--border-strong": "rgba(255, 255, 255, 0.082)",
    };

    for (const [token, value] of Object.entries(expectedTokens)) {
      expect(tokenDefinitionCount(token), `${token} definition count`).toBe(1);
      expect(rootToken(token)).toBe(value);
    }
    expect(rootToken("--signal-focus")).toBe("#4DA8B5");
    const root = singleTopLevelRuleBodyIn(styles, ":root");
    expect(root).toContain("--radius-control: 10px");
    expect(root).toContain("--radius-panel: 14px");
    expect(contrastRatio(rootToken("--ink-5"), rootToken("--ink-0"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rootToken("--ink-5"), rootToken("--ink-1"))).toBeGreaterThanOrEqual(4.5);
  });

  it("uses macOS system type for visible app chrome and technical content", () => {
    for (const selector of [
      ".project-navigator-header",
      ".project-row-button",
      ".project-session",
      ".project-navigator-surfaces button",
      ".workbench-breadcrumb-parent",
      ".workbench-session-title",
      ".workbench-actions button",
      ".session-strip",
      ".session-strip-action",
      ".session-strip .continue-button",
      ".session-rename-form input",
    ]) {
      const bodies = allRulesIn(styles).filter(({ selectors }) => selectors.includes(selector));
      expect(bodies.length, selector).toBeGreaterThan(0);
      expect(bodies.some(({ body }) => body.includes("var(--sans)")), selector).toBe(true);
    }

    expect(topLevelExactRuleBodies(".workbench-actions kbd").at(-1)).toContain("var(--sans)");
  });

  it("keeps all product typography on the shared sans token", () => {
    const prohibitedFontFragments = [
      ["--", "mono"].join(""),
      ["ui-", "mono", "space"].join(""),
      ["SF", "Mono"].join(""),
      ["SF ", "Mono"].join(""),
      ["Men", "lo"].join(""),
      ["Mona", "co"].join(""),
      ["Conso", "las"].join(""),
      ["Liberation ", "Mono"].join(""),
      ["mono", "space"].join(""),
    ];

    expect(productStyles).not.toMatch(new RegExp(prohibitedFontFragments.join("|"), "i"));
    for (const selector of [
      ".xterm-host",
      ".plan-line__sub code",
      ".workbench-actions kbd",
      ".sessions-run-details dd.technical",
      ".worktree-diff-panel__files code",
      ".worktree-diff-panel__line",
      ".workspace-preview-fallback code",
    ]) {
      const bodies = allRulesIn(productStyles).filter(({ selectors }) => selectors.includes(selector));
      expect(bodies.length, selector).toBeGreaterThan(0);
      expect(bodies.some(({ body }) => body.includes("var(--sans)")), selector).toBe(true);
    }
  });

  it("drops deleted navigation and migration-era selector families", () => {
    expect(styles).not.toMatch(orphanClassTokenPattern("primary-nav-rail"));
    expect(styles).not.toMatch(orphanClassTokenPattern("primary-nav-brand"));
    expect(styles).not.toMatch(orphanClassTokenPattern("primary-nav-stack"));
    expect(styles).not.toMatch(orphanClassTokenPattern("primary-nav-bottom"));
    expect(styles).not.toMatch(orphanClassTokenPattern("focus-session-strip"));
    expect(styles).not.toMatch(orphanClassTokenPattern("workbench-session-row"));
    expect(styles).not.toMatch(/\.session-chrome-/);
    expect(styles).not.toMatch(orphanClassTokenPattern("terminal-host"));
  });

  it("keeps live shell and terminal owners on the achromatic material", () => {
    const liveRules = allRulesIn(styles).filter((rule) =>
      rule.selectors.some(isLiveShellSelector),
    );
    const liveSelectors = liveRules.flatMap(({ selectors }) => selectors);
    const legacyColorUses = liveRules.filter(({ body }) =>
      /var\(--(?:signal-focus-strong|signal-danger|signal-agent(?:-soft)?|signal-success|codex-blue|claude-amber|cyan|brass|role-[^)]+|line(?:-strong)?|panel(?:-soft)?|terminal|muted|faint|passive|ink(?:-soft)?)\)/.test(body),
    );
    const focusSignalUses = liveRules.filter(({ body }) => body.includes("var(--signal-focus)"));
    const lowContrastControlUses = liveRules.filter(({ body }) => /color:\s*var\(--ink-4\)/.test(body));
    const literalColorUses = liveRules.filter(({ body }) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(body));

    expect(liveSelectors).toEqual(expect.arrayContaining([
      ".desktop-save-banner",
    ]));
    expect(legacyColorUses.map(({ selectors }) => selectors)).toEqual([]);
    expect(focusSignalUses.every(({ selectors }) =>
      selectors.every((selector) =>
        selector.includes("selected")
        || selector.includes("is-active")
        || selector.includes("focus")
        || selector.includes("aria-current")
        || selector.includes("aria-pressed"),
      ),
    )).toBe(true);
    expect(lowContrastControlUses.map(({ selectors }) => selectors)).toEqual([]);
    expect(literalColorUses.map(({ selectors }) => selectors)).toEqual([
      ['html[data-alfred-window-material="native"] .mission-bar'],
      ['html[data-alfred-window-material="native"] .project-navigator'],
    ]);
  });

  it("keeps live shell and terminal material quiet and reserves signal for attention", () => {
    const ownerRules = allRulesIn(styles).filter((rule) => rule.selectors.some(isLiveShellSelector));
    const gradients = ownerRules.filter(({ body }) => /(?:linear|radial)-gradient/.test(body));
    const materialShadows = ownerRules.filter(({ body }) => {
      const value = body.match(/box-shadow:\s*([^;]+)/)?.[1]?.trim();
      return value !== undefined && value !== "none";
    });
    const signalUses = ownerRules.filter(({ body }) => /var\(--signal\)/.test(body));
    const oversizedRadii = ownerRules.flatMap(({ selectors, body }) =>
      [...body.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)]
        .filter((match) => Number(match[1]) > 16)
        .map((match) => ({ selectors, radius: match[1] })),
    );

    expect(gradients.map(({ selectors }) => selectors)).toEqual([]);
    expect(materialShadows.map(({ selectors }) => selectors)).toEqual(expect.arrayContaining([
      [".chrome-menu-popover"],
      ['html[data-alfred-window-material="native"] .mission-bar'],
      [".terminal-tile:focus-visible"],
      [".project-session.is-active"],
      // The session strip is the one raised card in the deck, with hairlines on its controls (v4 canvas).
      [".session-strip"],
      [".session-strip .continue-button"],
      [".session-strip-menu .chrome-menu-popover"],
      [".session-rename-form input"],
      [".session-rename-form input:focus-visible"],
      // The hairline of the drop overlay over a dragged-on terminal (v4 Drop board).
      [".terminal-drop-overlay"],
    ]));
    expect(materialShadows).toHaveLength(10);
    expect(oversizedRadii).toEqual([]);
    expect(signalUses.every(({ selectors }) =>
      selectors.every((selector) =>
        selector.includes("attention")
        || selector.includes("waiting")
        || selector.includes("needs-you"),
      ),
    )).toBe(true);
  });

  it("drops dead migration hooks from the live shell", () => {
    expect(styles).not.toMatch(/\.quiet-count-(?:dot|mark)/);
    expect(styles).not.toContain("--workbench-control-height");
    expect(styles).not.toContain("--workbench-segment-height");
    expect(styles).not.toContain("--workbench-control-radius");
    expect(styles).not.toContain(".workspace-rail");
    expect(styles).not.toContain(".workspace-nav-");
  });

  it("keeps one winning project row weight declaration", () => {
    const workspaceButton = singleTopLevelRuleBodyIn(styles, ".project-row-button");

    expect(workspaceButton.match(/font:/g)).toHaveLength(1);
    expect(workspaceButton).toContain("font: 400 13px/18px var(--sans)");
  });

  it("drops proven orphan compatibility families", () => {
    expect(styles).not.toMatch(/\.session-observatory-/);
    expect(styles).not.toMatch(/\.(?:review-queue|review-item-|decision-detail)/);
    expect(styles).not.toMatch(/\.(?:review-launch|review-clear|review-safety-note)/);
    expect(styles).not.toMatch(/\.(?:review-modal-header|recovery-banner|empty-workspace-card)/);
  });

  it("keeps one canonical body owner on the ink canvas", () => {
    const bodyRules = topLevelExactRuleBodies("body");

    expect(bodyRules).toHaveLength(1);
    expect(bodyRules[0]).toContain("background: var(--ink-0)");
    expect(bodyRules[0]).toContain("min-width: 0");
    expect(bodyRules[0]).not.toContain("gradient");
    expect(bodyRules[0]).not.toContain("background-size");
  });

  it("keeps one canonical root owner without unused late material tokens", () => {
    const rootRules = topLevelExactRuleBodies(":root");

    expect(rootRules).toHaveLength(1);
    expect(rootRules[0]).toContain("--role-active: var(--signal-focus)");
    for (const token of [
      "--type-region", "--type-panel-title", "--type-ui", ["--tone", "waiting"].join("-"), "--tone-active",
      "--role-attention", "--role-success", "--role-neutral-marker", "--role-control", "--role-control-hover",
    ]) {
      expect(styles).not.toContain(`${token}:`);
    }
  });

  it("does not retain token definitions without runtime consumers", () => {
    for (const token of [
      "--surface-workbench",
      "--surface-tile-header",
      "--surface-chrome-soft",
      "--panel",
      "--panel-raised",
      "--panel-soft",
      "--terminal",
      "--codex-blue",
      "--alert-red",
      "--highlight-soft",
      "--shadow-soft",
      "--accent-press",
      "--accent",
      "--accent-primary",
      "--accent-focus",
      "--accent-soft",
      "--accent-strong",
      "--signal-focus-soft",
      "--amber",
      "--coral",
      "--green",
      "--accent-halo",
      "--on-accent",
      "--depth-raised",
    ]) {
      expect(tokenDefinitionCount(token)).toBe(0);
    }
  });

  it("rejects duplicate top-level rule bodies instead of accepting the last match", () => {
    const fixture = `
      .review-surface-primary { background: black; }
      .review-surface-primary { background: cyan; }
    `;

    expect(() => singleTopLevelRuleBodyIn(fixture, ".review-surface-primary")).toThrow(
      /must have one top-level rule body; found 2/,
    );
  });

  it("does not treat a media-only fixture as a canonical top-level base", () => {
    const fixture = `@media (max-width: 980px) { .fixture-owner { display: grid; } }`;
    expect(canonicalBaseRuleBodiesIn(fixture, ".fixture-owner")).toHaveLength(0);
  });

  it("does not discover media owners inside comments", () => {
    const fixture = `/* @media (max-width: 980px) { .fixture-owner { display: none; } } */`;
    expect(mediaExactRuleBodiesIn(fixture, "(max-width: 980px)", ".fixture-owner")).toHaveLength(0);
  });

  it("keeps terminal ancestors motionless and honors reduced motion", () => {
    const terminalAncestorPattern = /^(?:\.terminal-stage|\.terminal-stage-body|\.terminal-grid-column|\.terminal-grid|\.terminal-tile|\.xterm-host)(?:$|[. :>])/;
    const motionOwners = allRulesIn(styles).filter(({ selectors, body }) =>
      selectors.some((selector) => terminalAncestorPattern.test(selector))
      && /(?:animation|transition)(?:-[a-z-]+)?\s*:/.test(body),
    );
    expect(motionOwners.map(({ selectors }) => selectors)).toEqual([]);

    const reducedMotion = mediaExactRuleBodies("(prefers-reduced-motion: reduce)", "*");
    expect(reducedMotion).toHaveLength(1);
    expect(reducedMotion[0]).toContain("transition-duration: 0.001ms !important");
  });

  it("keeps the Work empty state unboxed", () => {
    const emptyState = singleTopLevelRuleBodyIn(styles, ".terminal-empty-state");

    expect(emptyState).toContain("border: 0");
    expect(emptyState).toContain("background: transparent");
    expect(emptyState).toContain("box-shadow: none");
    expect(emptyState).toContain("text-align: left");
  });

  it("keeps the Sandboxes group indented with a quiet tabular count", () => {
    expect(singleTopLevelRuleBodyIn(styles, ".project-sandbox-list")).toContain("padding-left: 12px");
    const count = singleTopLevelRuleBodyIn(styles, ".project-sandbox-count");
    expect(count).toContain("color: var(--text-faint)");
    expect(count).toContain("font-variant-numeric: tabular-nums");
  });

  it("draws one visible focus ring across Work destinations and controls", () => {
    const buttonFocus = singleTopLevelRuleBodyIn(styles, "button:focus-visible");
    const recentFocus = topLevelExactRuleBodies(".project-recent-result:focus-visible");
    const projectFocus = topLevelExactRuleBodies(".project-row-button:focus-visible");
    const sessionFocus = topLevelExactRuleBodies(".project-session:focus-visible");
    expect(styles).toContain("--focus-border: var(--signal-focus)");
    expect(buttonFocus).toContain("outline: 2px solid var(--focus-border)");
    expect(buttonFocus).toContain("outline-offset: 2px");
    expect(singleTopLevelRuleBodyIn(styles, ".project-navigator-add:focus-visible")).not.toContain("outline: none");
    expect(recentFocus).toHaveLength(2);
    expect(projectFocus).toHaveLength(1);
    expect(sessionFocus).toHaveLength(1);
    for (const focus of [recentFocus[1]!, ...projectFocus, ...sessionFocus]) {
      expect(focus).toContain("outline: 2px solid var(--focus-border)");
      expect(focus).toContain("outline-offset: -2px");
      expect(focus).not.toContain("outline: none");
    }

    expect(singleTopLevelRuleBodyIn(styles, '.project-row-button[aria-current="location"]')).not.toContain(
      "outline:",
    );
    expect(singleTopLevelRuleBodyIn(styles, ".project-session.is-active")).not.toContain("outline:");
  });

  it("keeps the selected project recognizable at every window width", () => {
    expect(singleTopLevelRuleBodyIn(styles, ".project-row.is-active")).toContain("background: var(--surface-control)");
    expect(styles).not.toMatch(/@media[^{]*\{[^}]*\.project-row\.is-active/);
  });

  it("uses one canonical tactical-dark token hierarchy", () => {
    expect(tokenDefinitionCount("--surface-terminal")).toBe(1);
    expect(tokenDefinitionCount("--surface-canvas")).toBe(1);
    expect(tokenDefinitionCount("--surface-panel")).toBe(1);
    expect(tokenDefinitionCount("--surface-raised")).toBe(1);
    expect(tokenDefinitionCount("--surface-chrome")).toBe(1);
    expect(tokenDefinitionCount("--surface-control")).toBe(1);
    expect(tokenDefinitionCount("--surface-control-hover")).toBe(1);
    expect(tokenDefinitionCount("--text-primary")).toBe(1);
    expect(tokenDefinitionCount("--text-muted")).toBe(1);
    expect(tokenDefinitionCount("--text-faint")).toBe(1);

    expect(rootToken("--surface-chrome")).toBe("#0C0C0E");
    expect(rootToken("--surface-control")).toBe("#151518");
    expect(rootToken("--surface-control-hover")).toBe("#1C1C20");
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

    const blurredRules = allRulesIn(styles).filter((rule) =>
      /(?:-webkit-)?backdrop-filter:\s*blur\([^)]*\)/i.test(rule.body),
    );
    expect(blurredRules).toHaveLength(3);
    expect(blurredRules.map(({ selectors }) => selectors)).toEqual(expect.arrayContaining([
      [".privacy-backdrop"],
      ['html[data-alfred-window-material="native"] .mission-bar'],
      ['html[data-alfred-window-material="native"] .project-navigator'],
    ]));
    expect(styles).not.toMatch(/--glass:/);
  });

  it("paints the terminal's box in the terminal theme's own background", () => {
    const tile = exactBlockFor(".terminal-tile");
    const xtermHost = blockFor(".terminal-tile .xterm-host");
    const standaloneXtermHost = exactBlockFor(".xterm-host");

    // The padding around xterm shows the box, so any other colour draws a frame around the terminal.
    expect(rootToken("--surface-terminal").toLowerCase()).toBe(ghosttyVesperTerminalProfile.theme.background);
    expect(rootToken("--ink-0")).toBe("#050506");
    expect(tile).toContain("background: var(--surface-terminal)");
    expect(xtermHost).toContain("background: var(--surface-terminal)");
    expect(standaloneXtermHost).toContain("background: var(--surface-terminal)");
    // xterm's own viewport default is black; it must not frame the terminal inside its box.
    expect(exactBlockFor(".terminal-tile .xterm-host .xterm-viewport")).toContain("background-color: var(--surface-terminal)");
  });

  it("routes operational colors through signal tokens", () => {
    expect(styles).not.toMatch(/rgba\(83,\s*199,\s*216,/);
    expect(styles).not.toMatch(/rgba\(217,\s*174,\s*70,/);
    expect(styles).not.toMatch(/#(?:35d47f|37d884|3ee68a)/i);
    expect(rootToken("--signal-agent")).toBe("#e0b75b");
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
    // One terminal fills the column, so no gutter is reserved: it would push the box off the canvas gutter.
    expect(gridColumn).not.toContain("scrollbar-gutter");
  });

  it("keeps orphan attention count markers out of the stylesheet", () => {
    expect(styles).not.toMatch(/\.quiet-count-(?:dot|mark)/);
  });

  it("keeps legacy gradients out of the main clean flat surfaces", () => {
    const workspacePopover = singleTopLevelRuleBodyIn(styles, ".workspace-popover");
    const terminalTile = exactBlockFor(".terminal-tile");
    const activeWorkspace = exactBlockFor(".project-row.is-active");

    expect(workspacePopover).toContain("background:");
    expect(workspacePopover).not.toContain("linear-gradient");
    expect(terminalTile).toContain("background: var(--surface-terminal)");
    expect(terminalTile).not.toContain("linear-gradient");
    expect(activeWorkspace).toContain("background:");
    expect(styles).not.toContain("--flat-");
  });

  it("draws History after the canvas from one stylesheet of its own", () => {
    expect(styles).not.toMatch(/\.sessions-/);
    // 380px of list on the canvas, plus the column's 16px padding and hairline.
    expect(singleTopLevelRuleBodyIn(historyStyles, ".sessions-navigator")).toContain("width: 397px");
    const row = singleTopLevelRuleBodyIn(historyStyles, ".sessions-result");
    expect(row).toContain("height: 34px");
    expect(row).toContain("border-radius: 9px");
    // 760px of text on the canvas, plus the article's 36px and 8px side padding.
    expect(singleTopLevelRuleBodyIn(historyStyles, ".sessions-transcript")).toContain("max-width: 804px");
    // The old back button, heading and time filter have no styles left to come back to.
    expect(historyStyles).not.toMatch(/sessions-navigator__heading/);
    // The window cannot be narrower than 1120px, so History carries no phone layout.
    expect(historyStyles).not.toContain("max-width: 720px");
  });

  it("styles workspace scrollbars so native white rails do not dominate the shell", () => {
    const workspaceScroll = exactBlockFor(".project-navigator-scroll");
    const sessionsResultsScroll = singleTopLevelRuleBodyIn(historyStyles, ".sessions-results");
    const sessionsReaderScroll = singleTopLevelRuleBodyIn(historyStyles, ".sessions-reader__scroll");

    expect(workspaceScroll).toContain("scrollbar-width: thin");
    expect(workspaceScroll).toContain("scrollbar-color:");
    expect(sessionsResultsScroll).toContain("scrollbar-width: thin");
    expect(sessionsReaderScroll).toContain("scrollbar-width: thin");
  });

  it("drops deduped chrome selectors from the sheet", () => {
    expect(styles).not.toContain(".workbench-crumbs");
    expect(styles).not.toContain(".workbench-title-block");
    expect(styles).not.toContain(".terminal-stage-utility");
    expect(styles).not.toContain(".agent-activity-digest");
    expect(styles).not.toContain(".review-surface-stats");
  });

  it("keeps the Details timeline scrollable without clipping the lower timeline", () => {
    const contextColumn = singleTopLevelRuleBodyIn(styles, ".context-column");
    const contextDrawer = singleTopLevelRuleBodyIn(styles, ".context-drawer");
    const timelineBody = blockFor(".context-drawer .agent-timeline-body");

    expect(contextColumn).toContain("display: block");
    expect(contextDrawer).toContain("overflow: hidden");
    expect(contextDrawer).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(blockFor(".context-drawer .agent-timeline-panel")).toContain("animation: none");
    expect(timelineBody).toContain("overflow-y: auto");
  });

  it("keeps dark scroll owners on the shared chrome rhythm", () => {
    const commandPalette = exactBlockFor(".command-palette-list");
    const paletteScrollbar = exactBlockFor(".command-palette-list::-webkit-scrollbar");
    const paletteThumb = exactBlockFor(".command-palette-list::-webkit-scrollbar-thumb");
    const selectedSession = exactBlockFor(".project-session.is-active");

    expect(commandPalette).toContain("scrollbar-width: thin");
    expect(commandPalette).toContain("scrollbar-color: var(--ink-3) transparent");
    expect(paletteScrollbar).toContain("width: 8px");
    expect(paletteThumb).toContain("background: var(--ink-3)");
    expect(selectedSession).toContain("box-shadow: inset 0 0 0 1px");
    expect(selectedSession).toContain("var(--signal-focus) 10%");
  });

  it("keeps the New sheet picker inline and lets native controls inherit the app scheme", () => {
    const sheet = readFileSync(productCssPaths.at(-1)!, "utf8");
    expect(singleTopLevelRuleBodyIn(styles, ":root")).toContain("color-scheme: dark");
    expect(singleTopLevelRuleBodyIn(sheet, ".new-session-sheet")).toContain("color-scheme: inherit");
    const header = singleTopLevelRuleBodyIn(sheet, ".new-session-sheet header");
    expect(header).toContain("align-items: baseline");
    expect(header).toContain("font: 500 15px/20px var(--sans)");
    const picker = singleTopLevelRuleBodyIn(sheet, ".new-session-sheet .chrome-menu-trigger");
    expect(picker).toContain("display: inline-flex");
    expect(picker).toContain("width: auto");
    expect(picker).toContain("font: 500 15px/20px var(--sans)");
    expect(picker).toContain("color: var(--text-primary)");
    expect(singleTopLevelRuleBodyIn(sheet, ".new-session-sheet .chrome-menu-trigger > svg")).toContain("opacity: 0.7");
  });

  it("keeps the New sheet prompt at three rows with a hairline and the standard focus ring", () => {
    const sheet = readFileSync(productCssPaths.at(-1)!, "utf8");
    const prompt = singleTopLevelRuleBodyIn(sheet, ".new-session-prompt textarea");
    expect(prompt).toContain("resize: none");
    expect(prompt).toContain("overflow-y: auto");
    expect(prompt).toContain("border: 0");
    expect(prompt).toContain("box-shadow: inset 0 0 0 1px var(--border)");
    const focus = singleTopLevelRuleBodyIn(sheet, ".new-session-sheet textarea:focus-visible");
    expect(focus).toContain("outline: none");
    expect(focus).toContain("var(--border-focus)");
    expect(focus).toContain("var(--focus-border)");
  });

  it("keeps the New sheet action neutral and uses the panel surface", () => {
    const sheet = readFileSync(productCssPaths.at(-1)!, "utf8");
    expect(sheet).toContain("background: var(--surface-panel)");
    expect(sheet).toContain("var(--shadow-panel)");
    expect(sheet).toContain("background: var(--text-primary)");
    expect(sheet).not.toMatch(/--signal/);
  });

  it("keeps legacy neon success greens from winning the primary action cascade", () => {
    expect(styles).not.toMatch(/background:\s*#(?:35d47f|37d884)\s*!important/i);
    expect(styles).not.toMatch(/#(?:35d47f|37d884)/i);
  });

  it("keeps live workbench controls free of important cascade overrides", () => {
    const importantRules = rulesForSelectorContaining(".workbench-primary-row button")
      .filter(({ body }) => /(background|border-color|box-shadow|color|padding):[^;]+!important/i.test(body));

    expect(importantRules).toEqual([]);
  });

  it("reserves the signal color for the Needs you and Your turn glyphs", () => {
    const glyphStyles = readFileSync(
      [
        resolve(process.cwd(), "src/renderer/components/session-status-glyph.css"),
        resolve(process.cwd(), "apps/desktop/src/renderer/components/session-status-glyph.css"),
      ].find((candidate) => existsSync(candidate))!,
      "utf8",
    );
    const signalRules = allRulesIn(glyphStyles).filter(({ body }) => body.includes("var(--signal)"));
    const dangerRules = allRulesIn(glyphStyles).filter(({ body }) => body.includes("var(--signal-danger)"));

    expect(singleTopLevelRuleBodyIn(styles, ".session-status-glyph")).toContain("color: var(--text-faint)");
    expect(styles).not.toMatch(/\.session-status-glyph\.status-/);
    expect(signalRules.map(({ selectors }) => selectors.join(","))).toEqual([
      ".session-status-glyph:is(.status-needs-you,.status-your-turn)",
    ]);
    expect(dangerRules.map(({ selectors }) => selectors)).toEqual([[".session-status-glyph.status-failed"]]);
    expect(singleTopLevelRuleBodyIn(glyphStyles, ".session-status-glyph.status-working svg")).toContain("animation:");
    expect(mediaExactRuleBodiesIn(glyphStyles, "(prefers-reduced-motion: reduce)", ".session-status-glyph.status-working svg"))
      .toEqual([expect.stringContaining("animation: none")]);
  });

  it("keeps overlay surfaces flat instead of glassy", () => {
    const overlayBackdrop = blockFor(".discard-checkout-backdrop,\n.command-palette-backdrop");
    const commandPalette = blockFor(".command-palette,\n.discard-checkout-dialog");

    expect(overlayBackdrop).toContain("backdrop-filter: none");
    expect(overlayBackdrop).toContain("background-image: none");
    expect(commandPalette).toContain("background: var(--surface-panel)");
    expect(commandPalette).toContain("background-image: none");
  });

  it("keeps Privacy as one flat settings list", () => {
    const panel = singleTopLevelRuleBodyIn(styles, ".privacy-panel");
    const body = singleTopLevelRuleBodyIn(styles, ".privacy-panel-body");
    const rows = blockFor(".privacy-control-row,\n.privacy-action-row");

    expect(panel).toContain("width: min(640px, calc(100vw - 88px))");
    expect(panel).toContain("background: var(--ink-1)");
    expect(body).toContain("overflow: auto");
    expect(body).toContain("background: var(--ink-1)");
    expect(rows).toContain("border-bottom: 1px solid var(--ink-3)");
    expect(rows).toContain("border-radius: 0");
    expect(rows).toContain("background: var(--ink-1)");
    const controls = blockFor(
      ".privacy-segmented button,\n.privacy-action-button,\n.privacy-confirm-actions button,\n.privacy-panel-status button",
    );
    const toggle = singleTopLevelRuleBodyIn(styles, ".privacy-toggle");
    expect(controls).toContain("min-height: 32px");
    expect(controls).toContain("font-size: 13px");
    expect(toggle).toContain("min-height: 32px");
    const privacyRuleBodies = allRulesIn(styles)
      .filter((rule) => rule.selectors.some((selector) =>
        selector.startsWith(".privacy-"),
      ))
      .map((rule) => rule.body)
      .join("\n");
    expect(privacyRuleBodies).not.toContain(`font-family: ${["var(--", "mono)"].join("")}`);
    const blurredRules = allRulesIn(styles).filter((rule) =>
      /(?:-webkit-)?backdrop-filter:\s*blur\([^)]*\)/i.test(rule.body),
    );
    expect(blurredRules).toHaveLength(3);
    expect(blurredRules.map(({ selectors }) => selectors)).toEqual(expect.arrayContaining([
      [".privacy-backdrop"],
      ['html[data-alfred-window-material="native"] .mission-bar'],
      ['html[data-alfred-window-material="native"] .project-navigator'],
    ]));
  });

  it.each([
    ["comma", ","],
    ["opening brace", "{"],
    ["child combinator", ">"],
    ["adjacent-sibling combinator", "+"],
    ["general-sibling combinator", "~"],
    ["class chaining", "."],
    ["pseudo-class", ":"],
    ["ID", "#"],
    ["attribute", "["],
    ["whitespace", " "],
    ["EOF", ""],
  ])("matches a complete class token before %s", (_label, suffix) => {
    expect(`.mission-actions${suffix}`).toMatch(orphanClassTokenPattern("mission-actions"));
  });

  it.each([
    [".workspace-mission-actions", "mission-actions"],
    [".new-terminal-button-extra", "new-terminal-button"],
  ])("does not match a longer class identifier: %s", (candidate, className) => {
    expect(candidate).not.toMatch(orphanClassTokenPattern(className));
  });

  it.each([
    "agent-launch-buttons",
    "agent-launch-button",
    "arrange-button",
    "arrange-handle",
    "tile-resize-handle",
    "split-empty-state",
    "recovery-workspace-strip",
    "work-surface-context",
    "project-navigator-collapse",
    "project-navigator-footer",
    "project-session-disclosure",
    "project-session-list",
    "project-overflow-button",
    "project-folder-icon",
    "project-attention-signal",
    "project-agent-signal",
    "project-row-signals",
    "project-section-heading",
    "command-palette-button",
    "context-toggle-button",
    "mission-actions",
    "new-terminal-button",
    "surface-switcher",
    "workspace-title-main",
  ])("does not retain proven orphan selector .%s", (className) => {
    expect(styles).not.toMatch(orphanClassTokenPattern(className));
  });

  it("keeps passive chrome text readable against the dark panel surface", () => {
    expect(contrastRatio(rootToken("--text-faint"), rootToken("--surface-panel"))).toBeGreaterThanOrEqual(4.0);
  });

  it("keeps chrome microcopy on a readable type floor", () => {
    expect(styles).toContain("--type-micro: 11px");
    expect(styles).not.toMatch(/font-size:\s*(?:8|8\.5)px/);
  });

  it("keeps Details hierarchy quiet with canvas sections and selectable sans paths", () => {
    // Details sits on the canvas as the right column, so the drawer paints no panel of its own.
    expect(singleTopLevelRuleBodyIn(styles, ".context-drawer")).not.toContain("background:");
    expect(singleTopLevelRuleBodyIn(styles, ".context-drawer .details-section h2")).toContain("font: 500 12px/16px var(--sans)");
    const facts = singleTopLevelRuleBodyIn(styles, ".details-location-path");
    expect(facts).toContain("font: 400 12px/17px var(--sans)");
    expect(facts).toContain("user-select: text");
    expect(facts).toContain("white-space: nowrap");
    const activityRow = singleTopLevelRuleBodyIn(styles, ".context-drawer .agent-activity-list li");
    expect(activityRow).toContain("display: flex");
    expect(activityRow).toContain("background: transparent");
    expect(singleTopLevelRuleBodyIn(styles, ".details-actions button")).toContain("background: var(--surface-control)");
    expect(styles).not.toContain(".agent-context-zone");
    expect(styles).not.toContain(".agent-section-heading");
  });

  it("keeps each Details activity on one line, cut with an ellipsis", () => {
    const activityText = singleTopLevelRuleBodyIn(styles, ".context-drawer .details-activity-text");
    const sentence = singleTopLevelRuleBodyIn(styles, ".details-activity-sentence");

    expect(activityText).toContain("display: flex");
    expect(activityText).not.toContain("overflow-wrap");
    expect(sentence).toContain("white-space: nowrap");
    expect(sentence).toContain("overflow: hidden");
    expect(sentence).toContain("text-overflow: ellipsis");
    expect(styles).not.toContain(".agent-status-pill");
  });

  it("keeps project navigator hierarchy quiet but readable", () => {
    const navPanel = singleTopLevelRuleBodyIn(styles, ".project-navigator");
    const navSectionHeader = singleTopLevelRuleBodyIn(styles, ".free-chat-section > header");
    const projectRow = singleTopLevelRuleBodyIn(styles, ".project-row");
    const navRow = singleTopLevelRuleBodyIn(styles, ".project-row-button");
    const navRowTitle = blockFor(".project-row-label,\n.project-session-title");
    const activeWorkspace = exactBlockFor('.project-row-button[aria-current="location"]');
    const calmRow = singleTopLevelRuleBodyIn(styles, ".project-row-button.is-calm");

    expect(navPanel).toContain("background: var(--surface-chrome)");
    expect(navSectionHeader).toContain("color: var(--ink-5)");
    expect(navSectionHeader).toContain("var(--sans)");
    expect(navRow).toContain("background: transparent");
    expectCanonicalBase(".project-row-button", [
      "height: 30px",
      "border-radius: 8px",
      "gap: 10px",
    ]);
    expectCanonicalBase(".project-session", [
      "min-height: 44px",
      "border-radius: 10px",
    ]);
    expect(projectRow).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(navRow).toContain("color: var(--text-secondary)");
    expect(navRow).toContain("font: 400 13px/18px var(--sans)");
    expect(calmRow).toContain("color: var(--text-muted)");
    expect(navRowTitle).toContain("text-overflow: ellipsis");
    expect(navRowTitle).toContain("white-space: nowrap");
    expect(activeWorkspace).toContain("color: var(--text-primary)");
    expect(activeWorkspace).toContain("font-weight: 500");
  });

  it("keeps overlays opaque and tactical instead of glassy", () => {
    const primaryOverlayBackdrop = blockFor(".discard-checkout-backdrop,\n.command-palette-backdrop");
    const overlayPanels = blockFor(".command-palette,\n.discard-checkout-dialog");
    const activePaletteRow = blockFor(
      ".command-palette-list button:hover,\n.command-palette-list button:focus-visible,\n.command-palette-list button.active",
    );

    expect(primaryOverlayBackdrop).toContain("background: rgba(0, 0, 0, 0.66)");
    expect(primaryOverlayBackdrop).toContain("background-image: none");
    expect(primaryOverlayBackdrop).toContain("backdrop-filter: none");
    expect(primaryOverlayBackdrop).toContain("-webkit-backdrop-filter: none");
    expect(overlayPanels).toContain("background: var(--surface-panel)");
    expect(overlayPanels).toContain("background-image: none");
    expect(overlayPanels).toContain("border: 1px solid var(--border)");
    expect(overlayPanels).toContain("box-shadow: var(--shadow-panel)");
    expect(activePaletteRow).not.toContain("linear-gradient");
  });

  it("keeps support-surface operations on the product type and control floors", () => {
    const expectedFonts = [
      [".renderer-crash-kicker", "font: 650 13px/1.2 var(--sans)"],
      [".workspace-popover button strong", "font: 600 13px/1.2 var(--sans)"],
      [".workspace-popover button small", "font: 500 12px/1.35 var(--sans)"],
      [".workspace-rename-form label span", "font: 600 12px/1.2 var(--sans)"],
      [".workspace-mission-form label span", "font: 600 12px/1.2 var(--sans)"],
      [".command-palette-group", "font: 650 12px/1.2 var(--sans)"],
      [".command-palette-list button small", "font: 500 12px/1.35 var(--sans)"],
      [".command-palette-empty", "font: 500 12px/1.35 var(--sans)"],
      [".discard-checkout-header span", "font: 650 13px/1.2 var(--sans)"],
      [".discard-checkout-actions button", "font: 650 13px/1 var(--sans)"],
    ] as const;

    for (const [selector, font] of expectedFonts) {
      expect(topLevelExactRuleBodies(selector).at(-1), selector).toContain(font);
    }

    for (const selector of [
      ".renderer-crash-card button",
      ".workspace-rename-form > div button",
      ".workspace-mission-actions button",
      ".command-palette-list button",
      ".discard-checkout-actions button",
    ]) {
      const body = topLevelExactRuleBodies(selector).find((candidate) => candidate.includes("min-height:")) ?? "";
      expect(body, selector).toContain("min-height:");
      expect(declaredMinHeightPx(body), selector).toBeGreaterThanOrEqual(32);
    }
  });

  it("keeps support surfaces free of prototype gradients and nested cards", () => {
    for (const selector of [
      ".renderer-crash-shell",
      ".renderer-crash-card",
      ".discard-checkout-dialog",
    ]) {
      const bodies = topLevelExactRuleBodies(selector);
      expect(bodies.length, selector).toBeGreaterThan(0);
      expect(bodies.every((body) => !body.includes("linear-gradient")), selector).toBe(true);
    }

    for (const selector of [
      ".discard-checkout-body dl div",
      ".discard-checkout-body li",
    ]) {
      const row = singleTopLevelRuleBodyIn(styles, selector);
      expect(row, selector).toContain("border-radius: 0");
      expect(row, selector).toContain("background: transparent");
      expect(row, selector).not.toContain("box-shadow");
    }
  });
});
