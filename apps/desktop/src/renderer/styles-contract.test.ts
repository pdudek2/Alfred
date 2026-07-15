import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { preprocessCSS, resolveConfig } from "vite";

const stylesPath = [
  resolve(process.cwd(), "src/renderer/styles.css"),
  resolve(process.cwd(), "apps/desktop/src/renderer/styles.css"),
].find((candidate) => existsSync(candidate));

if (!stylesPath) {
  throw new Error("Unable to locate renderer styles.css");
}

const styles = readFileSync(stylesPath, "utf8");
const lightningCssConfig = resolveConfig(
  { configFile: false, css: { transformer: "lightningcss" } },
  "build",
);

async function parseWithLightningCss(source: string, filename: string): Promise<void> {
  await preprocessCSS(source, filename, await lightningCssConfig);
}

function isLiveSliceOneSelector(selector: string): boolean {
  if (
    selector.startsWith(".workspace-layout.surface-inbox")
    || selector.startsWith(".workspace-layout.surface-history")
  ) return false;

  return [
    ".agent-space-shell", ".desktop-frame", ".mission-bar", ".desktop-alert-stack",
    ".workspace-title", ".workspace-popover", ".workspace-rename-form", ".workspace-mission-form",
    ".workspace-layout", ".project-navigator", ".project-", ".free-chat-",
    ".alfred-mark", ".workbench-", ".work-surface-", ".chrome-menu", ".prepare-work-popover",
    ".desktop-save-", ".shell-action-", ".recovery-",
    ".terminal-", ".tile-", ".tool-dot", ".session-status-", ".session-rename-form",
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

function topLevelExactSelectorsIn(source: string): string[] {
  return [...topLevelStylesOnlyIn(source).matchAll(/(?<selectors>[^{}]+)\{[^{}]*\}/gm)].flatMap((match) =>
    (match.groups?.selectors ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean),
  );
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

function containerExactRuleBodies(query: string, selector: string): string[] {
  const commentlessSource = withoutComments(styles);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const containerStart = new RegExp(`@container\\s*${escapedQuery}\\s*\\{`, "g");
  const bodies: string[] = [];
  for (const match of commentlessSource.matchAll(containerStart)) {
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    bodies.push(...exactRuleBodiesIn(balancedBlockBody(commentlessSource, openingBraceIndex).body, selector));
  }
  return bodies;
}

function canonicalBaseRuleBodiesIn(source: string, selector: string): string[] {
  return topLevelExactRuleBodiesIn(source, selector);
}

function expectCanonicalBase(selector: string, requiredDeclarations: string[]): void {
  const bodies = canonicalBaseRuleBodiesIn(styles, selector);
  expect(bodies, `${selector} must have one canonical base rule`).toHaveLength(1);
  for (const declaration of requiredDeclarations) expect(bodies[0]).toContain(declaration);
}

function expectTopLevelOwnerWithin(
  selector: string,
  requiredDeclarations: string[],
  startMarker: string,
  endMarker: string,
): void {
  const bodies = topLevelExactRuleBodies(selector);
  expect(bodies, `${selector} must have one top-level owner`).toHaveLength(1);
  const start = styles.indexOf(startMarker);
  const end = styles.indexOf(endMarker, start + startMarker.length);
  expect(start, `Missing owner-region start marker ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing owner-region end marker ${endMarker}`).toBeGreaterThan(start);
  const regionalBodies = exactRuleBodiesIn(styles.slice(start, end), selector);
  expect(regionalBodies, `${selector} must be inside ${startMarker} … ${endMarker}`).toHaveLength(1);
  for (const declaration of requiredDeclarations) expect(regionalBodies[0]).toContain(declaration);
}

function expectTopLevelDeclarationOwnerWithin(
  selector: string,
  requiredDeclarations: string[],
  startMarker: string,
  endMarker: string,
): void {
  const matchingBodies = topLevelExactRuleBodies(selector).filter((body) =>
    requiredDeclarations.every((declaration) => body.includes(declaration)),
  );
  expect(matchingBodies, `${selector} must have one owner for ${requiredDeclarations.join(", ")}`).toHaveLength(1);
  const start = styles.indexOf(startMarker);
  const end = styles.indexOf(endMarker, start + startMarker.length);
  expect(start, `Missing owner-region start marker ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing owner-region end marker ${endMarker}`).toBeGreaterThan(start);
  const regionalMatchingBodies = exactRuleBodiesIn(styles.slice(start, end), selector).filter((body) =>
    requiredDeclarations.every((declaration) => body.includes(declaration)),
  );
  expect(regionalMatchingBodies, `${selector} declaration owner must be inside ${startMarker} … ${endMarker}`).toHaveLength(1);
}

type CssOwnerRegion = {
  name: string;
  startMarker: string;
  endMarker: string;
};

type ResponsiveOwnerAllowance = {
  atRule: "media" | "container";
  query: string;
  selector: string;
  region: CssOwnerRegion;
};

function expectResponsiveFamilyOwnersWithinSource(
  source: string,
  familyName: string,
  matchesFamily: (selector: string) => boolean,
  allowances: ResponsiveOwnerAllowance[],
): void {
  const commentlessSource = withoutComments(source);
  const actual: Array<{ atRule: "media" | "container"; query: string; selector: string; index: number }> = [];
  const atRuleStart = /@(media|container)\s*([^{}]+)\{/g;

  for (const match of commentlessSource.matchAll(atRuleStart)) {
    const atRule = match[1] as "media" | "container";
    const query = (match[2] ?? "").trim();
    const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf("{");
    const selectors = topLevelExactSelectorsIn(balancedBlockBody(commentlessSource, openingBraceIndex).body);
    for (const selector of selectors.filter(matchesFamily)) {
      actual.push({ atRule, query, selector, index: match.index ?? 0 });
    }
  }

  const remainingAllowances = [...allowances];
  for (const occurrence of actual) {
    const allowanceIndex = remainingAllowances.findIndex((allowance) => {
      if (
        allowance.atRule !== occurrence.atRule
        || allowance.query !== occurrence.query
        || allowance.selector !== occurrence.selector
      ) return false;
      const start = commentlessSource.indexOf(allowance.region.startMarker);
      const end = commentlessSource.indexOf(
        allowance.region.endMarker,
        start + allowance.region.startMarker.length,
      );
      expect(start, `Missing ${allowance.region.name} start marker`).toBeGreaterThanOrEqual(0);
      expect(end, `Missing ${allowance.region.name} end marker`).toBeGreaterThan(start);
      return occurrence.index > start && occurrence.index < end;
    });

    if (allowanceIndex === -1) {
      throw new Error(
        `${familyName} responsive owner is not allowed: @${occurrence.atRule} ${occurrence.query} ${occurrence.selector}`,
      );
    }
    remainingAllowances.splice(allowanceIndex, 1);
  }

  expect(remainingAllowances, `${familyName} responsive owner allowlist must be complete`).toEqual([]);
}

function expectAllTopLevelOccurrencesWithinSource(
  source: string,
  selector: string,
  allowedRegions: CssOwnerRegion[],
  expectedOccurrences: number,
): void {
  const allOccurrences = topLevelExactRuleBodiesIn(source, selector);
  expect(allOccurrences, `${selector} top-level occurrence count`).toHaveLength(expectedOccurrences);

  let allowedOccurrenceCount = 0;
  for (const region of allowedRegions) {
    const start = source.indexOf(region.startMarker);
    const end = source.indexOf(region.endMarker, start + region.startMarker.length);
    expect(start, `Missing ${region.name} start marker ${region.startMarker}`).toBeGreaterThanOrEqual(0);
    expect(end, `Missing ${region.name} end marker ${region.endMarker}`).toBeGreaterThan(start);
    allowedOccurrenceCount += topLevelExactRuleBodiesIn(source.slice(start, end), selector).length;
  }

  expect(
    allowedOccurrenceCount,
    `${selector} has a top-level occurrence outside allowed owner regions: ${allowedRegions.map((region) => region.name).join(", ")}`,
  ).toBe(allOccurrences.length);
}

function expectAllTopLevelOccurrencesWithin(
  selector: string,
  allowedRegions: CssOwnerRegion[],
  expectedOccurrences: number,
): void {
  expectAllTopLevelOccurrencesWithinSource(styles, selector, allowedRegions, expectedOccurrences);
}

function expectAllFamilyTopLevelOccurrencesWithinSource(
  source: string,
  familyName: string,
  matchesFamily: (selector: string) => boolean,
  allowedRegions: CssOwnerRegion[],
): string[] {
  const selectors = topLevelExactSelectorsIn(source).filter(matchesFamily);
  expect(selectors, `${familyName} must have protected top-level selectors`).not.toHaveLength(0);

  for (const selector of new Set(selectors)) {
    expectAllTopLevelOccurrencesWithinSource(
      source,
      selector,
      allowedRegions,
      selectors.filter((candidate) => candidate === selector).length,
    );
  }

  return [...new Set(selectors)];
}

function expectExactGroupedRule(selectors: string[], requiredDeclarations: string[]): void {
  const expectedSelectors = [...selectors].sort();
  const matches = [...withoutComments(styles).matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/gm)].filter((match) => {
    const actualSelectors = (match.groups?.selectors ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .sort();
    return (
      actualSelectors.length === expectedSelectors.length &&
      actualSelectors.every((selector, index) => selector === expectedSelectors[index])
    );
  });

  expect(matches, `Expected one exact grouped rule for ${selectors.join(", ")}`).toHaveLength(1);
  for (const declaration of requiredDeclarations) expect(matches[0]?.groups?.body ?? "").toContain(declaration);
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
  it("implements the canonical B4 Inbox visual contract without selector residue", () => {
    const root = singleTopLevelRuleBodyIn(styles, ".inbox-docket");
    const canvas = singleTopLevelRuleBodyIn(styles, ".inbox-docket__canvas");
    const row = singleTopLevelRuleBodyIn(styles, ".inbox-docket__item-row");
    const disclosure = singleTopLevelRuleBodyIn(styles, ".inbox-docket__disclosure");
    const detail = singleTopLevelRuleBodyIn(styles, ".inbox-docket__detail");
    const statusbar = singleTopLevelRuleBodyIn(styles, ".inbox-docket__statusbar");

    expect(root).toContain("font-family: var(--sans)");
    expect(root).toContain("grid-template-rows: 36px minmax(0, 1fr) 30px");
    expect(canvas).toContain("overflow-y: auto");
    expect(canvas).toContain("overflow-x: hidden");
    expect(canvas).toContain("max-width: 920px");
    expect(row).toContain("min-height: 51px");
    expect(disclosure).toMatch(/transition:\s*transform\s+(?:1[6-9]\d|20\d|210)ms\s+ease-out/);
    expect(detail).toMatch(/transition:[^;]*(?:1[6-9]\d|20\d|210)ms/);
    expect(statusbar).toContain("position: sticky");

    expect(singleTopLevelRuleBodyIn(styles, ":root")).toContain(
      '--sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    );
    expect(singleTopLevelRuleBodyIn(styles, ":root")).toContain(
      '--mono: ui-monospace, "SFMono-Regular", Menlo, monospace',
    );

    for (const selector of [".project-navigator", ".xterm-host", ".orchestrator-surface", ".surface-panel"]) {
      expect(allRulesIn(styles).filter(({ selectors }) => selectors.includes(selector)).map(({ body }) => body).join("\n"))
        .not.toMatch(/transition\s*:/);
    }

    expect(styles).not.toMatch(orphanClassTokenPattern(["project-attention", "dot"].join("-")));
    expect(styles).not.toMatch(/\.(?:review-surface|inbox-section(?:-stack)?)\b/);
    expect(styles).not.toMatch(/\.tone-(?:waiting|staged|blocked|restored|done|error)\b/);

    const waitingSignal = ruleForSelectorContaining(".inbox-docket__glyph--waiting");
    expect(waitingSignal.body).toContain("color: var(--signal)");
    const inboxDangerRules = allRulesIn(styles).filter(({ selectors, body }) =>
      selectors.some((selector) => selector.startsWith(".inbox-docket")) && body.includes("var(--signal-danger)"),
    );
    expect(inboxDangerRules.flatMap(({ selectors }) => selectors)).toEqual(expect.arrayContaining([
      ".inbox-docket__glyph--blocked",
      ".inbox-docket__state--blocked dd",
    ]));
    expect(inboxDangerRules.every(({ body }) => !/background(?:-color)?\s*:|button/.test(body))).toBe(true);

    const reducedMotion = mediaExactRuleBodies("(prefers-reduced-motion: reduce)", ".inbox-docket *");
    expect(reducedMotion).toHaveLength(1);
    expect(reducedMotion[0]).toContain("transition-duration: 0.001ms !important");
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
      "--ink-0": "#0A0C0F",
      "--ink-1": "#0E1114",
      "--ink-2": "#14181D",
      "--ink-3": "#1D2228",
      "--ink-4": "#5A6169",
      "--ink-5": "#8B929B",
      "--ink-6": "#C9CED5",
      "--ink-7": "#EDF0F3",
      "--signal": "#E29B6E",
    };

    for (const [token, value] of Object.entries(expectedTokens)) {
      expect(tokenDefinitionCount(token), `${token} definition count`).toBe(1);
      expect(rootToken(token)).toBe(value);
    }
    expect(contrastRatio(rootToken("--ink-5"), rootToken("--ink-0"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rootToken("--ink-5"), rootToken("--ink-1"))).toBeGreaterThanOrEqual(4.5);
  });

  it("owns the exact Slice 1 shell and terminal geometry", () => {
    expectCanonicalBase(".agent-space-shell", ["min-height: 100vh", "padding: 0"]);
    expectCanonicalBase(".desktop-frame", ["height: 100vh", "grid-template-rows: auto auto minmax(0, 1fr)"]);
    expectCanonicalBase(".mission-bar", ["grid-row: 1", "min-height: 40px", "padding: 0"]);
    expectCanonicalBase(".desktop-alert-stack", ["grid-row: 2", "min-height: 0"]);
    expectCanonicalBase(".shell-action-alert", ["position: fixed", "z-index: 40"]);
    expect(exactBlockFor(".shell-action-alert")).not.toMatch(/animation|transition/);
    expectCanonicalBase(".workspace-layout", ["grid-row: 3"]);
    expect(styles).not.toContain(".desktop-alert-stack:empty");
    expectCanonicalBase(".workbench-header", ["height: 40px"]);
    expectCanonicalBase(".workbench-primary-row", ["height: 40px"]);
    expectCanonicalBase(".desk-surface-panel", ["display: grid", "grid-template-rows: 36px minmax(0, 1fr)"]);
    expectCanonicalBase(".work-surface-toolbar", [
      "min-width: 0",
      "border-bottom: 1px solid var(--ink-3)",
      "background: var(--ink-0)",
      "display: flex",
      "align-items: center",
    ]);
    expectCanonicalBase(".terminal-tile.chrome-headerless", ["grid-template-rows: minmax(0, 1fr)"]);
    expectCanonicalBase(".terminal-tile-header", ["height: 30px", "min-height: 30px"]);
  });

  it("uses system type for chrome identity and mono only for technical workspace context", () => {
    const topLevelOwner = (selector: string) => topLevelExactRuleBodiesIn(styles, selector).at(-1) ?? "";

    expect(topLevelOwner(".workbench-session-context > span")).toContain("var(--sans)");
    expect(topLevelOwner(".workbench-session-context > small")).toContain("var(--sans)");
    expect(topLevelOwner(".work-surface-context")).toContain("var(--mono)");
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
      rule.selectors.some(isLiveSliceOneSelector),
    );
    const liveSelectors = liveRules.flatMap(({ selectors }) => selectors);
    const legacyColorUses = liveRules.filter(({ body }) =>
      /var\(--(?:signal-focus(?:-strong)?|signal-danger|signal-agent(?:-soft)?|signal-success|codex-blue|claude-amber|cyan|brass|role-[^)]+|surface-[^)]+|text-[^)]+|border(?:-[^)]+)?|line(?:-strong)?|panel(?:-soft)?|terminal|muted|faint|passive|ink(?:-soft)?|radius-[^)]+)\)/.test(body),
    );
    const lowContrastControlUses = liveRules.filter(({ body }) => /color:\s*var\(--ink-4\)/.test(body));
    const literalColorUses = liveRules.filter(({ body }) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(body));

    expect(liveSelectors).toEqual(expect.arrayContaining([
      ".desktop-save-banner",
      ".recovery-workspace-strip",
      ".recovery-inbox-link",
    ]));
    expect(legacyColorUses.map(({ selectors }) => selectors)).toEqual([]);
    expect(lowContrastControlUses.map(({ selectors }) => selectors)).toEqual([]);
    expect(literalColorUses.map(({ selectors }) => selectors)).toEqual([]);
  });

  it("keeps live shell and terminal material flat and reserves signal for attention", () => {
    const ownerRules = allRulesIn(styles).filter((rule) => rule.selectors.some(isLiveSliceOneSelector));
    const gradients = ownerRules.filter(({ body }) => /(?:linear|radial)-gradient/.test(body));
    const materialShadows = ownerRules.filter(({ body }) => {
      const value = body.match(/box-shadow:\s*([^;]+)/)?.[1]?.trim();
      return value !== undefined && value !== "none";
    });
    const signalUses = ownerRules.filter(({ body }) => /var\(--signal\)/.test(body));
    const oversizedRadii = ownerRules.flatMap(({ selectors, body }) =>
      [...body.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)]
        .filter((match) => Number(match[1]) > 7)
        .map((match) => ({ selectors, radius: match[1] })),
    );

    expect(gradients.map(({ selectors }) => selectors)).toEqual([]);
    expect(materialShadows.map(({ selectors }) => selectors)).toEqual([
      [".chrome-menu-popover"],
      [".prepare-work-popover"],
    ]);
    expect(oversizedRadii).toEqual([]);
    expect(signalUses.every(({ selectors }) =>
      selectors.every((selector) => selector.includes("attention") || selector.includes("waiting")),
    )).toBe(true);
  });

  it("keeps every live Slice 1 family inside its canonical owner region", () => {
    const shellRegion = [{
      name: "canonical shell/navigation/workbench",
      startMarker: ".agent-space-shell {",
      endMarker: "\n.terminal-stage {",
    }];
    const terminalRegion = [{
      name: "canonical terminal scene",
      startMarker: "\n.terminal-stage {",
      endMarker: "\n.composer-bar {",
    }];
    const composerRegion = [{
      name: "canonical composer/dispatch",
      startMarker: "\n.composer-bar {",
      endMarker: "/* Focus mode and inspector */",
    }];

    expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "Slice 1 shell",
      (selector) => isLiveSliceOneSelector(selector)
        && !selector.startsWith(".workspace-layout > .context-column")
        && (
          selector.startsWith(".prepare-work-popover")
          || !/(?:\.terminal-|\.tile-|\.tool-dot|\.session-status-|\.session-rename-form|\.split-empty-|\.staged-|\.arrange-|\.xterm-host|\.composer-|\.dispatch-)/.test(selector)
        ),
      shellRegion,
    );
    expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "Slice 1 terminal",
      (selector) => /(?:\.terminal-|\.tile-|\.tool-dot|\.session-status-|\.session-rename-form|\.split-empty-|\.staged-|\.arrange-|\.xterm-host)/.test(selector),
      terminalRegion,
    );
    expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "Slice 1 composer",
      (selector) => !selector.startsWith(".prepare-work-popover") && /(?:\.composer-|\.dispatch-)/.test(selector),
      composerRegion,
    );
  });

  it("keeps live responsive owners beside their canonical Slice 1 families", () => {
    const source = withoutComments(styles);
    const shellStart = source.indexOf(".agent-space-shell {");
    const terminalStart = source.indexOf("\n.terminal-stage {");
    const terminalEnd = source.indexOf("\n.composer-bar {", terminalStart);
    const responsiveStarts = /@(media|container)\s*([^{}]+)\{/g;
    const misplaced: string[] = [];

    for (const match of source.matchAll(responsiveStarts)) {
      const index = match.index ?? 0;
      const openingBraceIndex = index + match[0].lastIndexOf("{");
      const selectors = topLevelExactSelectorsIn(balancedBlockBody(source, openingBraceIndex).body);
      for (const selector of selectors) {
        const isTerminal = /(?:\.terminal-|\.tile-|\.tool-dot|\.session-status-|\.session-rename-form|\.split-empty-|\.staged-|\.arrange-|\.xterm-host)/.test(selector);
        const isShell = isLiveSliceOneSelector(selector) && !isTerminal && !/(?:\.composer-|\.dispatch-)/.test(selector);
        if (isTerminal && (index < terminalStart || index >= terminalEnd)) misplaced.push(selector);
        if (isShell && (index < shellStart || index >= terminalStart)) misplaced.push(selector);
      }
    }

    expect(misplaced).toEqual([]);
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
    expect(workspaceButton).toContain("font: 600 12px/1.2 var(--sans)");
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

  it("rejects a protected selector with a late top-level occurrence outside its owner region", () => {
    const fixture = `
      .owner-start { display: block; }
      .protected-state { color: cyan; }
      .owner-end { display: block; }
      .protected-state { color: red; }
    `;

    expect(() =>
      expectAllTopLevelOccurrencesWithinSource(
        fixture,
        ".protected-state",
        [{ name: "fixture canonical", startMarker: ".owner-start {", endMarker: ".owner-end {" }],
        2,
      ),
    ).toThrow(/outside allowed owner regions/);
  });

  it("rejects a late state occurrence outside a protected family owner region", () => {
    const fixture = `
      .owner-start { display: block; }
      .protected { display: grid; }
      .protected.selected { color: cyan; }
      .owner-end { display: block; }
      .protected.selected { color: red; }
    `;

    expect(() =>
      expectAllFamilyTopLevelOccurrencesWithinSource(
        fixture,
        "fixture family",
        (selector) => selector.startsWith(".protected"),
        [{ name: "fixture family", startMarker: ".owner-start {", endMarker: ".owner-end {" }],
      ),
    ).toThrow(/outside allowed owner regions/);
  });

  it("rejects a responsive family owner outside its allowed query and region", () => {
    const fixture = `
      .owner-start { display: block; }
      @media (max-width: 980px) {
        .review-surface-header { grid-template-columns: 1fr; }
      }
      .owner-end { display: block; }
      @media (max-width: 980px) {
        .review-surface-primary { display: none; }
      }
    `;
    const region = { name: "fixture responsive owner", startMarker: ".owner-start {", endMarker: ".owner-end {" };

    expect(() => expectResponsiveFamilyOwnersWithinSource(
      fixture,
      "fixture Inbox",
      (selector) => selector.startsWith(".review-surface"),
      [{ atRule: "media", query: "(max-width: 980px)", selector: ".review-surface-header", region }],
    )).toThrow(/responsive owner is not allowed/);
  });

  it("accepts an explicitly allowed container owner inside its region", () => {
    const fixture = `
      .owner-start { display: block; }
      @container terminal-tile (max-width: 520px) {
        .tile-title { min-width: 0; }
      }
      .owner-end { display: block; }
    `;
    const region = { name: "fixture container owner", startMarker: ".owner-start {", endMarker: ".owner-end {" };

    expect(() => expectResponsiveFamilyOwnersWithinSource(
      fixture,
      "fixture tile",
      (selector) => selector.startsWith(".tile-"),
      [{
        atRule: "container",
        query: "terminal-tile (max-width: 520px)",
        selector: ".tile-title",
        region,
      }],
    )).not.toThrow();
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

  it("keeps one canonical base owner for frame chrome and navigation", () => {
    const desktopFrameBodies = topLevelExactRuleBodies(".desktop-frame");
    expect(desktopFrameBodies).toHaveLength(1);
    expect(desktopFrameBodies[0]).toContain("display: grid");
    expect(desktopFrameBodies[0]).toContain("overflow: hidden");
    expect(mediaExactRuleBodies("(max-width: 980px)", ".desktop-frame")).toHaveLength(0);

    expectCanonicalBase(".mission-bar", ["display: flex", "min-height: 40px"]);
    expectCanonicalBase(".mission-name", ["display: flex", "min-width: 0"]);
    expectCanonicalBase(".workspace-title-menu", ["position: relative", "min-width: 0"]);
    expect(topLevelExactRuleBodies(".workspace-title-trigger")).toHaveLength(1);
    expect(mediaExactRuleBodies("(max-width: 980px)", ".workspace-title-trigger")).toHaveLength(1);
    expectCanonicalBase(".workbench-header", ["width: 100%", "min-width: 0", "height: 40px"]);
    expectCanonicalBase(".workbench-primary-row", ["display: grid", "grid-template-columns: auto minmax(0, 1fr) auto"]);
    expectCanonicalBase(".work-surface-toolbar", ["display: flex", "height: 36px"]);
    expectCanonicalBase(".chrome-menu-popover", ["z-index: 120", "box-shadow:"]);
    expectCanonicalBase(".prepare-work-popover", ["width: 560px", "max-width: calc(100vw - 24px)"]);

    expectCanonicalBase(".project-navigator", [
      "min-width: 0",
      "display: grid",
      "grid-template-rows: auto minmax(0, 1fr) auto",
      "width: 248px",
    ]);
    expectCanonicalBase(".project-navigator.is-collapsed", ["width: 46px"]);
    const workspaceNavScrollBodies = exactRuleBodies(".project-navigator-scroll");
    expect(workspaceNavScrollBodies).toHaveLength(1);
    expect(workspaceNavScrollBodies[0]).toContain("overflow-y: auto");
    expect(workspaceNavScrollBodies[0]).toContain("overflow-x: hidden");
    expect(workspaceNavScrollBodies[0]).toContain("scrollbar-color: var(--ink-3) transparent");
    expectCanonicalBase(".project-row-button", ["display: grid", "width: 100%"]);
    expectCanonicalBase(".project-session", ["display: grid", "width: 100%"]);
    expectCanonicalBase(".project-row-label", ["text-overflow: ellipsis", "white-space: nowrap"]);
    expectCanonicalBase(".project-session-title", ["text-overflow: ellipsis", "white-space: nowrap"]);
  });

  it("keeps one canonical owner for the Slice 2 shell", () => {
    expectCanonicalBase(".project-navigator", ["width: 248px", "overflow: hidden"]);
    expectCanonicalBase(".workbench-header", ["height: 40px"]);
    expectCanonicalBase(".work-surface-toolbar", ["display: flex"]);
    expectCanonicalBase(".context-column", ["position: absolute", "width: min(336px"]);
    expectCanonicalBase(".workspace-layout.surface-inbox", [
      "grid-template-columns: auto minmax(0, 1fr)",
      "position: relative",
    ]);
    expectCanonicalBase(".workspace-layout.surface-history", [
      "grid-template-columns: auto minmax(0, 1fr)",
      "position: relative",
    ]);
    expect(topLevelExactRuleBodies(".workspace-layout.surface-inbox.preview-visible")).toHaveLength(1);
    expect(topLevelExactRuleBodies(".workspace-layout.surface-history.preview-visible")).toHaveLength(1);

    expect(topLevelExactRuleBodies(".workspace-layout:has(.context-column.open)")).toHaveLength(0);
    expect(styles).not.toContain("grid-column: 3");
    expect(styles).not.toContain(".context-compact-status");
    expect(styles).not.toContain(".session-chrome-row");
    expect(styles).not.toContain(".workspace-rail.embedded");
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

  it("keeps the forced narrow navigator peekable and its toggle honest", () => {
    for (const selector of [
      ".workspace-layout",
      ".workspace-layout.preview-visible",
      ".workspace-layout:has(.project-navigator.is-collapsed)",
      ".workspace-layout.preview-visible:has(.project-navigator.is-collapsed)",
    ]) {
      const layout = mediaExactRuleBodies("(max-width: 1180px)", selector);
      expect(layout).toHaveLength(1);
      expect(layout[0]).toContain("grid-template-columns: 46px minmax(0, 1fr)");
    }

    const forcedRail = mediaExactRuleBodies("(max-width: 1180px)", ".project-navigator");
    expect(forcedRail).toHaveLength(1);
    expect(forcedRail[0]).toContain("width: 46px");

    const hiddenToggle = mediaExactRuleBodies("(max-width: 1180px)", ".project-navigator-collapse");
    expect(hiddenToggle).toHaveLength(1);
    expect(hiddenToggle[0]).toContain("display: none");

    const hoverPeek = mediaExactRuleBodies(
      "(max-width: 1180px)",
      ".project-navigator .project-row-button:hover::after",
    );
    const focusPeek = mediaExactRuleBodies(
      "(max-width: 1180px)",
      ".project-navigator:focus-within .project-row-button:focus-visible::after",
    );
    expect(hoverPeek).toHaveLength(1);
    expect(focusPeek).toHaveLength(1);
    expect(hoverPeek[0]).toContain("content: attr(data-label)");
    expect(focusPeek[0]).toContain("content: attr(data-label)");
  });

  it("keeps the project session disclosure focusable in both 46px navigator modes", () => {
    const manualRailDisclosure = topLevelExactRuleBodies(
      ".project-navigator.is-collapsed .project-disclosure",
    );
    expect(manualRailDisclosure).toHaveLength(1);
    expect(manualRailDisclosure[0]).toContain("display: flex");
    expect(manualRailDisclosure[0]).toContain("width: 24px");
    expect(manualRailDisclosure[0]).not.toContain("display: none");

    const forcedRailDisclosure = mediaExactRuleBodies(
      "(max-width: 1180px)",
      ".project-navigator .project-disclosure",
    );
    expect(forcedRailDisclosure).toHaveLength(1);
    expect(forcedRailDisclosure[0]).toContain("display: flex");
    expect(forcedRailDisclosure[0]).toContain("width: 24px");
    expect(forcedRailDisclosure[0]).not.toContain("display: none");
  });

  it("keeps the single workspace actions owner operable in the forced narrow rail", () => {
    const widePopover = topLevelExactRuleBodies(
      ".project-workspace-actions .workspace-popover",
    );
    expect(widePopover).toHaveLength(1);
    expect(widePopover[0]).toContain("position: fixed");

    const actions = mediaExactRuleBodies(
      "(max-width: 1180px)",
      ".project-navigator .project-workspace-actions",
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain("display: flex");
    expect(actions[0]).not.toContain("display: none");

    const popover = mediaExactRuleBodies(
      "(max-width: 1180px)",
      ".project-workspace-actions .workspace-popover",
    );
    expect(popover).toHaveLength(1);
    expect(popover[0]).toContain("position: fixed");
    expect(popover[0]).not.toMatch(/\b(?:left|top):/);
  });

  it("keeps narrow Inbox and History surfaces beside the 46px navigator at the forced-rail breakpoint", () => {
    for (const selector of [".workspace-layout.surface-inbox", ".workspace-layout.surface-history"]) {
      const layout = mediaExactRuleBodies("(max-width: 1180px)", selector);
      expect(layout).toHaveLength(1);
      expect(layout[0]).toContain("grid-template-columns: 46px minmax(0, 1fr)");
    }

    const navigatorPlacement = mediaExactRuleBodies(
      "(max-width: 980px)",
      ".workspace-layout.surface-inbox .project-navigator",
    );
    const surfacePlacement = mediaExactRuleBodies(
      "(max-width: 980px)",
      ".workspace-layout.surface-inbox > .orchestrator-surface",
    );
    expect(navigatorPlacement).toHaveLength(1);
    expect(navigatorPlacement[0]).toContain("grid-column: 1");
    expect(surfacePlacement).toHaveLength(1);
    expect(surfacePlacement[0]).toContain("grid-column: 2");
    expect(surfacePlacement[0]).toContain("min-width: 0");
  });

  it("keeps Slice A interaction winners adjacent to their canonical components", () => {
    const workspaceNavHover = topLevelExactRuleBodies(".project-row-button:hover");
    const workspaceNavFocus = topLevelExactRuleBodies(".project-row-button:focus-visible");
    expect(workspaceNavHover).toHaveLength(1);
    expect(workspaceNavFocus).toHaveLength(1);
    expect(workspaceNavHover[0]).toContain("background: var(--ink-2)");
    expectCanonicalBase(".workbench-primary-row button", ["max-height: 28px", "border-radius: 7px"]);
    expectCanonicalBase('.work-surface-toolbar button[aria-pressed="true"]', ["font-weight: 700"]);
    expectCanonicalBase(".chrome-menu-popover button", ["width: 100%"]);
  });

  it("draws a focus-only ring on project and session destinations", () => {
    const projectFocus = topLevelExactRuleBodies(".project-row-button:focus-visible");
    const sessionFocus = topLevelExactRuleBodies(".project-session:focus-visible");
    expect(projectFocus).toHaveLength(1);
    expect(sessionFocus).toHaveLength(1);
    for (const focus of [...projectFocus, ...sessionFocus]) {
      expect(focus).toContain("outline: 2px solid var(--ink-6)");
      expect(focus).toContain("outline-offset: -2px");
      expect(focus).not.toContain("outline: none");
    }

    expect(singleTopLevelRuleBodyIn(styles, '.project-row-button[aria-selected="true"]')).not.toContain(
      "outline:",
    );
    expect(singleTopLevelRuleBodyIn(styles, ".project-session.is-active")).not.toContain("outline:");
  });

  it("keeps canonical base owners for terminal Context and composer", () => {
    expectCanonicalBase(".terminal-stage", ["display: grid", "overflow: hidden"]);
    expectCanonicalBase(".terminal-stage-body", ["min-height: 0", "overflow: hidden"]);
    expectCanonicalBase(".terminal-grid-column", ["overflow-y: auto", "height: 100%"]);
    expectCanonicalBase(".terminal-grid", ["display: grid", "min-height: 0"]);
    expectCanonicalBase(".terminal-tile", ["display: grid", "overflow: hidden"]);
    expectCanonicalBase(".context-column", ["position: absolute", "pointer-events: none"]);
    expectCanonicalBase(".context-drawer", ["display: flex", "overflow: hidden"]);
    expectCanonicalBase(".composer-bar", ["display: grid", "min-width: 0"]);
    expectCanonicalBase(".composer-input", ["box-sizing: border-box", "resize: none"]);
    expectCanonicalBase(".composer-send", ["display: inline-flex", "cursor: pointer"]);
    expectCanonicalBase(".dispatch-target-chip", ["border-radius: 5px", "background-image: none"]);

    const terminalGridStart = ".terminal-stage {";
    const terminalGridEnd = ".terminal-empty-state {";
    expectTopLevelOwnerWithin(".terminal-grid.laid-out", ["--grid-bottom-safe-zone: 76px", "grid-auto-rows: 84px"], terminalGridStart, terminalGridEnd);
    expectTopLevelOwnerWithin(".terminal-grid.laid-out.dense", ["align-content: start"], terminalGridStart, terminalGridEnd);
    expectTopLevelOwnerWithin(".terminal-stage.arranging .terminal-grid-column", ["overflow-y: auto", "padding-bottom: 18px"], terminalGridStart, terminalGridEnd);

    const terminalTileStart = ".terminal-tile {";
    const terminalTileEnd = ".tile-header {";
    expectTopLevelOwnerWithin(
      ".terminal-tile.workspace-hidden",
      ["display: none"],
      terminalTileStart,
      terminalTileEnd,
    );
    expectTopLevelOwnerWithin(".terminal-stage.mode-focus .terminal-tile.focus-hidden", ["display: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile.selected", ["border-color: var(--ink-6)", "box-shadow: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile:focus-visible", ["border-color: var(--ink-6)", "box-shadow: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile:focus-within", ["outline: 1px solid var(--ink-5)", "box-shadow: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile.collapsed", ["grid-template-rows: 30px 0", "min-height: 30px"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile:not(.arranging):hover", ["border-color: var(--ink-5)", "box-shadow: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-stage.mode-split .terminal-tile.focus-hidden", ["display: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile.collapsed .xterm-host", ["height: 0", "pointer-events: none"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile.collapsed .terminal-viewport", ["min-height: 0"], terminalTileStart, terminalTileEnd);
    expectTopLevelOwnerWithin(".terminal-tile.collapsed .xterm", ["min-height: 0"], terminalTileStart, terminalTileEnd);

    const contextStart = ".context-drawer {";
    const contextEnd = ".workspace-preview-panel,\n.agent-timeline-panel {";
    expectTopLevelOwnerWithin(".context-drawer.closed", ["display: none"], contextStart, contextEnd);
    expectTopLevelOwnerWithin(".context-drawer.open", ["display: flex"], contextStart, contextEnd);
    expectTopLevelOwnerWithin(".context-column.closed", ["display: none"], contextStart, contextEnd);
    expectTopLevelOwnerWithin(".context-column.open", ["pointer-events: auto"], contextStart, contextEnd);
    expectCanonicalBase(".workspace-layout", ["grid-template-columns: 248px minmax(0, 1fr)", "position: relative"]);
    expectTopLevelOwnerWithin(
      ".context-column",
      ["position: absolute", "top: 12px", "right: 12px", "bottom: 12px", "width: min(336px, calc(100% - 24px))"],
      contextStart,
      contextEnd,
    );
    expect(styles).not.toContain(":has(.context-column.open)");
    expect(styles).not.toContain(".workspace-layout > .context-column.open");

    const composerStart = "\n.composer-bar {";
    const composerEnd = "/* Focus mode and inspector */";
    expectTopLevelOwnerWithin('.composer-bar[data-state="busy"]', ["background: transparent"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.composer-bar[data-state="blocked"]', ["background: transparent"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.composer-bar[data-state="disabled"]', ["background: transparent"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".composer-input:focus-visible", ["border-color: var(--ink-6)", "box-shadow: none"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".dispatch-bar", ["grid-template-columns: minmax(0, 1fr)", "background: transparent"], composerStart, composerEnd);
    expectTopLevelDeclarationOwnerWithin(".dispatch-bar .composer-input", ["flex: 1 1 auto"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".dispatch-bar .composer-input:focus-visible", ["border: 0", "box-shadow: none"], composerStart, composerEnd);
    expectTopLevelDeclarationOwnerWithin(".dispatch-bar .composer-send", ["min-width: 76px", "background: var(--ink-2)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".dispatch-bar .composer-send:disabled", ["color: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.dispatch-bar[data-state="ready"] .composer-send:enabled', ["background: var(--ink-2)", "border-color: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.dispatch-bar[data-state="busy"] .composer-send:enabled', ["background: var(--ink-2)", "border-color: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.composer-bar[data-state="blocked"] .composer-send:enabled', ["border-color: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.composer-bar[data-state="ready"] .composer-status-indicator', ["background: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.composer-bar[data-state="busy"] .composer-status-indicator', ["background: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin('.composer-bar[data-state="blocked"] .composer-status-indicator', ["background: var(--ink-5)"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".dispatch-bar .composer-status-row", ["grid-column: 1", "overflow: hidden"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".dispatch-bar .composer-status", ["font: 400 11px/1.2 var(--sans)", "letter-spacing: 0"], composerStart, composerEnd);
    expectTopLevelOwnerWithin(".dispatch-bar .composer-status-indicator", ["width: 6px", "border: 0"], composerStart, composerEnd);

    const terminalStageRegion: CssOwnerRegion = {
      name: "terminal stage/grid",
      startMarker: ".terminal-stage {",
      endMarker: ".terminal-empty-state {",
    };
    const terminalTileRegion: CssOwnerRegion = {
      name: "terminal tile/xterm",
      startMarker: ".terminal-tile {",
      endMarker: "\n.composer-bar {",
    };
    const terminalSemanticRoleRegion: CssOwnerRegion = {
      name: "terminal semantic role layer",
      startMarker: "/* Terminal-first color role layer. */",
      endMarker: ".agent-timeline-header strong {",
    };
    const contextRegion: CssOwnerRegion = {
      name: "Context drawer/column",
      startMarker: ".context-drawer {",
      endMarker: ".workspace-preview-panel,\n.agent-timeline-panel {",
    };
    const composerRegion: CssOwnerRegion = {
      name: "composer/dispatch",
      startMarker: "\n.composer-bar {",
      endMarker: "/* Focus mode and inspector */",
    };

    for (const [selector, expectedOccurrences] of [
      [".terminal-stage-header", 1],
      [".terminal-stage.arranging .layout-controls", 1],
    ] as const) {
      expectAllTopLevelOccurrencesWithin(selector, [terminalStageRegion], expectedOccurrences);
    }
    expectAllTopLevelOccurrencesWithin(".terminal-stage-header span", [terminalStageRegion], 1);

    for (const [selector, expectedOccurrences] of [
      [".terminal-tile:not(.arranging):hover", 1],
      [".terminal-tile .xterm", 1],
      [".terminal-tile .terminal-viewport", 1],
      [".terminal-tile .xterm-host", 1],
      [".terminal-tile.restored", 1],
      [".terminal-tile.kind-manual", 1],
      [".terminal-tile.kind-codex", 1],
      [".terminal-tile.kind-claude", 1],
      [".terminal-tile.kind-dev-server", 1],
      [".terminal-tile.real-terminal.browser", 1],
      [".terminal-tile.staged", 1],
      [".terminal-tile.selected .tool-dot", 1],
      [".terminal-tile.selected .tile-status.status-active::before", 1],
      [".terminal-tile-header .tile-title", 1],
      [".terminal-tile-header .tile-title b", 1],
      [".terminal-tile-header .tile-title small", 1],
      [".terminal-tile.real-terminal .tool-dot", 1],
      [".terminal-tile.real-terminal.ready .tool-dot", 1],
      [".terminal-tile.real-terminal.selected .tool-dot", 1],
      [".terminal-tile.real-terminal .tile-kind-mark", 1],
      [".terminal-tile.real-terminal .tile-kind-mark span", 1],
      [".terminal-tile:hover .tile-utility-actions", 1],
      [".terminal-tile:focus-within .tile-utility-actions", 1],
      [".terminal-tile-header .tile-title:has(.session-rename-form)", 1],
      [".terminal-tile-header .tile-title > div", 1],
      [".terminal-tile-header .tile-title > div:has(.session-rename-form)", 1],
      [".terminal-tile-header .session-location-value", 1],
      [".terminal-tile-header .tile-actions", 1],
      [".tile-resize-handle", 1],
      [".tile-resize-handle::before", 1],
      [".tile-actions", 1],
      [".tile-action-group", 1],
      [".tile-status-group", 1],
      [".tile-utility-actions", 1],
      [".tile-danger-actions", 1],
      [".tile-primary-actions", 1],
      [".tile-actions button", 1],
      [".terminal-status-label", 1],
      [".tile-primary-actions button", 1],
      [".tile-primary-actions button:hover", 1],
      [".tile-primary-actions button:focus-visible", 1],
      [".tile-danger-actions button", 1],
      [".tile-danger-actions button:hover", 1],
      [".tile-danger-actions button:focus-visible", 1],
      [".tile-utility-actions button", 1],
      [".tile-utility-actions button:hover", 1],
      [".tile-utility-actions button:focus-visible", 1],
      [".tile-primary-actions .continue-button", 1],
      [".tile-primary-actions .continue-button span", 1],
    ] as const) {
      expectAllTopLevelOccurrencesWithin(selector, [terminalTileRegion], expectedOccurrences);
    }

    for (const [selector, expectedOccurrences] of [
      [".terminal-status-label.tone-manual", 1],
      [".terminal-status-label.tone-shell", 1],
      [".terminal-status-label.tone-codex", 1],
      [".terminal-status-label.tone-claude", 1],
    ] as const) {
      expectAllTopLevelOccurrencesWithin(selector, [terminalTileRegion, terminalSemanticRoleRegion], expectedOccurrences);
    }

    expect(styles).not.toContain(".terminal-tile.staged::before");
    expect(styles).not.toMatch(/\.terminal-tile\.staged\.kind-[\w-]+::before/);

    for (const [selector, expectedOccurrences] of [
      [".context-drawer-header", 1],
      [".context-drawer .workspace-preview-panel", 2],
      [".context-drawer .agent-timeline-panel", 2],
      [".context-drawer .agent-timeline-body", 1],
      [".context-drawer .agent-session-pulse", 1],
    ] as const) {
      expectAllTopLevelOccurrencesWithin(selector, [contextRegion], expectedOccurrences);
    }

    for (const [selector, expectedOccurrences] of [
      [".dispatch-bar", 1],
      [".dispatch-bar .composer-input", 1],
      [".dispatch-bar .composer-input:focus-visible", 1],
      [".dispatch-bar .composer-send", 1],
      [".dispatch-bar .composer-send:disabled", 1],
      [".dispatch-bar .composer-status-row", 1],
      [".dispatch-bar .composer-status", 1],
      [".dispatch-bar .composer-status-indicator", 1],
      ['.dispatch-bar[data-state="ready"] .composer-send:enabled', 1],
      ['.dispatch-bar[data-state="busy"] .composer-send:enabled', 1],
    ] as const) {
      expectAllTopLevelOccurrencesWithin(selector, [composerRegion], expectedOccurrences);
    }
  });

  it("keeps canonical owners for Inbox Observatory and overlays", () => {
    const inboxRegions = [{
      name: "Inbox docket",
      startMarker: ".inbox-docket {",
      endMarker: ".observatory-surface {",
    }];
    const observatoryRegions = [
      {
        name: "Observatory surface",
        startMarker: ".observatory-surface {",
        endMarker: ".agent-raw-toggle {",
      },
    ];
    const commandPaletteRegions = [
      {
        name: "command palette overlay",
        startMarker: "/* Command palette and privacy modal */",
        endMarker: "@media (prefers-reduced-motion: reduce)",
      },
      {
        name: "shared overlay input typography",
        startMarker: "/* Region titles: sans for chrome, mono only where data/terminal content needs it. */",
        endMarker: ".agent-timeline-header {",
      },
    ];
    const privacyRegions = [
      {
        name: "privacy overlay",
        startMarker: "/* Command palette and privacy modal */",
        endMarker: "@media (prefers-reduced-motion: reduce)",
      },
    ];
    const surfaceResponsiveRegion = {
      name: "Inbox and Observatory responsive ownership",
      startMarker: ".inbox-docket {",
      endMarker: ".agent-timeline-panel,\n.workspace-preview-panel {",
    };

    expectCanonicalBase(".inbox-docket__canvas", ["overflow-y: auto", "overflow-x: hidden"]);
    expectCanonicalBase(".observatory-grid", ["display: grid"]);
    const primaryInboxAction = blockForContaining(".inbox-docket__primary", "background: var(--ink-6)");
    expect(primaryInboxAction).toContain("background: var(--ink-6)");
    expect(primaryInboxAction).toContain("border: 1px solid var(--ink-6)");
    expect(primaryInboxAction).toContain("color: var(--ink-0)");
    expect(primaryInboxAction).not.toContain("var(--signal-danger)");
    const inboxSelectors = expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "Inbox",
      (selector) => selector.startsWith(".inbox-docket"),
      inboxRegions,
    );
    expect(inboxSelectors).toEqual(expect.arrayContaining([
      ".inbox-docket",
      ".inbox-docket__canvas",
      ".inbox-docket__item[aria-expanded=\"true\"]",
      ".inbox-docket__item-row:focus-visible",
      ".inbox-docket__glyph--waiting",
      ".inbox-docket__glyph--blocked",
      ".inbox-docket__primary:hover",
      ".inbox-docket__statusbar",
    ]));

    const observatorySelectors = expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "Observatory",
      (selector) => selector.startsWith(".observatory-"),
      observatoryRegions,
    );
    expect(observatorySelectors).toEqual(expect.arrayContaining([
      ".observatory-project:hover",
      ".observatory-project:focus-visible",
      ".observatory-project.active",
      ".observatory-project.current:not(.active)",
      ".observatory-project.active .observatory-project-marker",
      ".observatory-project.active .observatory-project-count",
      ".observatory-project.active .observatory-project-arrow",
      ".observatory-session-row:hover",
      ".observatory-session-row:focus-visible",
      ".observatory-session-row.selected",
      ".observatory-source-badge.source-external-codex",
      ".observatory-detail-card.source-external-codex",
      ".observatory-surface-header button:disabled",
      ".observatory-surface-header button:hover",
      ".observatory-surface-header button:focus-visible",
      ".observatory-detail-card button:disabled",
      ".observatory-detail-card button:hover",
      ".observatory-detail-card button:focus-visible",
    ]));

    expectResponsiveFamilyOwnersWithinSource(
      styles,
      "Inbox and Observatory",
      (selector) => selector.startsWith(".inbox-docket")
        || selector.startsWith(".observatory-"),
      [
        { atRule: "media", query: "(max-width: 1180px)", selector: ".observatory-grid", region: surfaceResponsiveRegion },
        { atRule: "media", query: "(max-width: 1180px)", selector: ".observatory-detail", region: surfaceResponsiveRegion },
        { atRule: "media", query: "(max-width: 1120px)", selector: ".inbox-docket__detail-grid", region: surfaceResponsiveRegion },
        { atRule: "media", query: "(max-width: 1120px)", selector: ".inbox-docket__facts", region: surfaceResponsiveRegion },
        { atRule: "media", query: "(max-width: 980px)", selector: ".observatory-surface-header", region: surfaceResponsiveRegion },
        { atRule: "media", query: "(max-width: 980px)", selector: ".observatory-grid", region: surfaceResponsiveRegion },
        { atRule: "media", query: "(prefers-reduced-motion: reduce)", selector: ".inbox-docket *", region: surfaceResponsiveRegion },
      ],
    );

    expect(exactRuleBodies(".history-surface"), ".history-surface must remain an unstyled semantic hook").toHaveLength(0);

    const commandPaletteSelectors = expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "command palette",
      (selector) => selector === ".command-palette" || selector.startsWith(".command-palette-"),
      commandPaletteRegions,
    );
    expect(commandPaletteSelectors).toEqual(expect.arrayContaining([
      ".command-palette-backdrop",
      ".command-palette-search input:focus-visible",
      ".command-palette-list button.active",
      ".command-palette-list button:hover",
      ".command-palette-list button:focus-visible",
      ".command-palette-list button:disabled",
      ".command-palette-group",
      ".command-palette-empty",
    ]));

    const privacySelectors = expectAllFamilyTopLevelOccurrencesWithinSource(
      styles,
      "privacy",
      (selector) => selector.startsWith(".privacy-"),
      privacyRegions,
    );
    expect(privacySelectors).toEqual(expect.arrayContaining([
      ".privacy-panel-close:hover",
      ".privacy-panel-close:focus-visible",
      '.privacy-segmented button[aria-pressed="true"]',
      ".privacy-panel-status.error",
      ".privacy-panel-status.error button",
      ".privacy-control-row",
      ".privacy-action-row",
      ".privacy-action-button.danger",
      ".privacy-confirm-actions .danger",
    ]));

    expectExactGroupedRule(
      [".privacy-backdrop", ".discard-checkout-backdrop", ".command-palette-backdrop"],
      ["background: rgba(0, 0, 0, 0.66)", "backdrop-filter: none"],
    );
    expectExactGroupedRule(
      [".command-palette", ".privacy-panel", ".discard-checkout-dialog"],
      ["background: var(--surface-panel)", "box-shadow: var(--shadow-panel)"],
    );
    expectAllTopLevelOccurrencesWithin(".privacy-backdrop", privacyRegions, 2);
    expectAllTopLevelOccurrencesWithin(".command-palette-backdrop", commandPaletteRegions, 1);
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

    expect(rootToken("--surface-chrome")).toBe("#07090b");
    expect(rootToken("--surface-control")).toBe("#090d11");
    expect(rootToken("--surface-control-hover")).toBe("#10151a");
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

    expect(styles.match(/(?:-webkit-)?backdrop-filter:\s*blur\([^)]*\)/gi)).toEqual([
      "backdrop-filter: blur(18px)",
      "-webkit-backdrop-filter: blur(18px)",
    ]);
    expect(styles).not.toMatch(/--glass:/);
  });

  it("keeps the CSS terminal surface on the approved graphite material", () => {
    const xtermHost = blockFor(".terminal-tile .xterm-host");

    expect(rootToken("--ink-0")).toBe("#0A0C0F");
    expect(xtermHost).toContain("background: var(--ink-0)");
  });

  it("routes operational colors through signal tokens", () => {
    expect(styles).not.toMatch(/rgba\(83,\s*199,\s*216,/);
    expect(styles).not.toMatch(/rgba\(217,\s*174,\s*70,/);
    expect(styles).not.toMatch(/#(?:35d47f|37d884|3ee68a)/i);
    expect(rootToken("--signal-agent")).toBe("#e0b75b");
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

  it("keeps the B4 docket heading quiet and information-bearing", () => {
    const inboxHeader = blockFor(".inbox-docket__header");

    expect(inboxHeader).toContain("display: flex");
    expect(inboxHeader).toContain("justify-content: space-between");
    expect(blockFor(".inbox-docket__header p")).toContain("white-space: nowrap");
  });

  it("keeps one Inbox scroll owner and no historical lane chrome", () => {
    const canvas = blockFor(".inbox-docket__canvas");

    expect(canvas).toContain("overflow-x: hidden");
    expect(canvas).toContain("overflow-y: auto");
    expect(styles).not.toContain(".inbox-section");
    expect(styles).not.toContain(".review-surface");
  });

  it("keeps the adaptive workbench controls compact", () => {
    const workbenchAction = exactBlockFor(".workbench-primary-row button");

    expect(workbenchAction).toContain("max-height: 28px");
    expect(workbenchAction).toContain("border-radius: 7px");
    expect(workbenchAction).toContain("background: var(--ink-1)");
    expect(styles).not.toContain("--flat-control-height");
    expect(styles).not.toContain("--flat-control");
  });

  it("keeps the live attention count compact", () => {
    const attentionCount = exactBlockFor(".workbench-attention-count");

    expect(attentionCount).toContain("background: var(--ink-2)");
    expect(attentionCount).toContain("border-radius: 7px");
    expect(attentionCount).not.toContain("var(--signal)");
    expect(styles).not.toMatch(/\.quiet-count-(?:dot|mark)/);
  });

  it("keeps legacy gradients out of the main clean flat surfaces", () => {
    const workspacePopover = singleTopLevelRuleBodyIn(styles, ".workspace-popover");
    const terminalTile = exactBlockFor(".terminal-tile");
    const activeWorkspace = exactBlockFor('.project-row-button[aria-selected="true"]');

    expect(workspacePopover).toContain("background:");
    expect(workspacePopover).not.toContain("linear-gradient");
    expect(terminalTile).toContain("background: var(--ink-0)");
    expect(terminalTile).not.toContain("linear-gradient");
    expect(activeWorkspace).toContain("background:");
    expect(styles).not.toContain("--flat-");
  });

  it("floats Context over the terminal scene without resizing the workbench", () => {
    const closedLayout = singleTopLevelRuleBodyIn(styles, ".workspace-layout");
    const contextColumn = singleTopLevelRuleBodyIn(styles, ".context-column");
    const contextDrawer = singleTopLevelRuleBodyIn(styles, ".context-drawer");

    expect(closedLayout).toContain("grid-template-columns: 248px minmax(0, 1fr)");
    expect(closedLayout).toContain("position: relative");
    expect(contextColumn).toContain("position: absolute");
    expect(contextColumn).toContain("width: min(336px, calc(100% - 24px))");
    expect(contextDrawer).toContain("max-height: 100%");
    expect(styles).not.toContain(":has(.context-column.open)");
    expect(styles).not.toContain(".workspace-layout > .context-column.open");
  });

  it("keeps the Inbox empty state as a compact line instead of a dashboard card", () => {
    const inboxEmpty = blockFor(".inbox-docket__empty");

    expect(inboxEmpty).toContain("min-height: 76px");
    expect(inboxEmpty).toContain("border-top: 1px solid var(--ink-3)");
    expect(inboxEmpty).not.toContain("border-radius");
    expect(inboxEmpty).not.toContain("box-shadow");
  });

  it("styles workspace scrollbars so native white rails do not dominate the shell", () => {
    const workspaceScroll = exactBlockFor(".project-navigator-scroll");
    const inboxScroll = exactBlockFor(".inbox-docket__canvas");
    const observatoryScroll = exactBlockFor(".observatory-surface");
    const scrollbarThumb = blockFor(".inbox-docket__canvas::-webkit-scrollbar-thumb");

    expect(workspaceScroll).toContain("scrollbar-width: thin");
    expect(workspaceScroll).toContain("scrollbar-color:");
    expect(inboxScroll).toContain("scrollbar-width: thin");
    expect(observatoryScroll).toContain("scrollbar-width: thin");
    expect(scrollbarThumb).toContain("background:");
  });

  it("keeps the top chrome on adaptive frame rows", () => {
    const frame = blockFor(".desktop-frame");
    const missionBar = exactBlockFor(".mission-bar");
    const primaryRow = exactBlockFor(".workbench-primary-row");

    expect(frame).toContain("grid-template-rows: auto auto minmax(0, 1fr)");
    expect(missionBar).toContain("display: flex");
    expect(primaryRow).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
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
    expect(exactBlockFor(".workbench-header")).toContain("width: 100%");
    expect(blockFor(".inbox-docket__item-row")).toContain("grid-template-columns: 18px minmax(0, 1fr) auto 16px");
    expect(blockFor(".inbox-docket")).toContain("grid-template-rows: 36px minmax(0, 1fr) 30px");
    expect(blockFor(".recovery-workspace-strip")).toContain("background: transparent");
  });

  it("keeps the Recovery disclosure compact and subordinate", () => {
    const recoveryToggle = blockFor(".inbox-docket__recovery-toggle");

    expect(recoveryToggle).toContain("min-height: 41px");
    expect(recoveryToggle).toContain("background: transparent");
    expect(recoveryToggle).toContain("grid-template-columns: 15px minmax(0, 1fr) auto");
  });

  it("keeps the resting docket row at the B4 density", () => {
    expect(blockFor(".inbox-docket__item-row")).toContain("min-height: 51px");
  });

  it("preserves surface identity while hiding nonessential technical chrome at 1120px", () => {
    expect(mediaExactRuleBodies("(max-width: 1120px)", ".workbench-session-context > span")).toHaveLength(0);
    expect(mediaExactRuleBodies("(max-width: 1120px)", ".workbench-session-context > small")).toHaveLength(0);
    expect(mediaExactRuleBodies("(max-width: 1120px)", ".workbench-right-zone kbd")).toHaveLength(1);
    expect(mediaExactRuleBodies("(max-width: 1120px)", ".work-surface-context")).toHaveLength(1);
  });

  it("keeps workspace actions compact inside the active project row", () => {
    const workspaceTitle = blockFor(".project-workspace-actions .workspace-title-trigger");

    expect(workspaceTitle).toContain("width: 28px");
    expect(workspaceTitle).toContain("height: 28px");
    expect(blockFor(".project-workspace-actions .workspace-title-trigger > span")).toContain("display: none");
  });

  it("uses the real disclosure glyph without decorative pseudo-markers", () => {
    expect(styles).not.toMatch(/\.inbox-docket__disclosure::(?:before|after)/);
    expect(singleTopLevelRuleBodyIn(styles, ".inbox-docket__disclosure")).toContain(
      "transition: transform 190ms ease-out",
    );
    expect(blockFor('.inbox-docket__item[aria-expanded="true"] .inbox-docket__disclosure')).toContain(
      "transform: rotate(90deg)",
    );
  });

  it("drops Inbox selectors for markup that is no longer rendered", () => {
    expect(styles).not.toContain(".inbox-section > header div");
    expect(styles).not.toContain(".inbox-section > header span");
    expect(styles).not.toContain(".inbox-section-empty");
  });

  it("makes the context drawer itself scrollable instead of clipping the lower timeline", () => {
    const contextColumn = singleTopLevelRuleBodyIn(styles, ".context-column");
    const contextDrawer = singleTopLevelRuleBodyIn(styles, ".context-drawer");
    const timelinePanel = blockFor(".context-drawer .agent-timeline-panel");

    expect(contextColumn).toContain("display: block");
    expect(contextDrawer).toContain("overflow: hidden");
    expect(contextDrawer).toContain("flex-direction: column");
    expect(timelinePanel).toContain("overflow: auto");
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
    const kindMark = exactBlockFor(".terminal-tile.real-terminal .tile-kind-mark");
    const kindMarkText = exactBlockFor(".terminal-tile.real-terminal .tile-kind-mark span");
    const primaryActions = blockForContaining(".tile-primary-actions", "opacity: 1");
    const primaryActionButton = exactBlockFor(".tile-primary-actions .continue-button");
    const utilities = blockForContaining(".tile-utility-actions", "opacity: 0");
    const dangerActions = blockForContaining(".tile-danger-actions", "opacity: 0");
    const utilityButtons = blockFor(".tile-utility-actions button,\n.tile-danger-actions button");
    const readyToolDot = blockFor(".terminal-tile.real-terminal.ready .tool-dot");
    const selectedToolDotRule = ruleForSelectorContaining(".terminal-tile.real-terminal.selected .tool-dot");

    expect(tile).toContain("background: var(--ink-0)");
    expect(tile).toContain("box-shadow: none");
    expect(header).toContain("min-height");
    expect(header).toContain("background: var(--ink-0)");
    expect(header).not.toContain("linear-gradient");
    expect(tileTitle).toContain("font: 650 13px/1.12 var(--sans)");
    expect(xtermHost).toContain("background: var(--ink-0)");
    expect(kindMark).toContain("width: 24px");
    expect(kindMarkText).toContain("display: none");
    expect(primaryActions).toContain("opacity: 1");
    expect(primaryActions).toContain("pointer-events: auto");
    expect(primaryActionButton).toContain("border-color: var(--ink-5)");
    expect(utilities).toContain("opacity: 0");
    expect(utilities).toContain("pointer-events: none");
    expect(dangerActions).toContain("opacity: 0");
    expect(dangerActions).toContain("pointer-events: none");
    expect(utilityButtons).toContain("color: var(--ink-5)");
    expect(readyToolDot).not.toContain("var(--green)");
    expect(selectedToolDotRule.selectors).toContain(".terminal-tile.real-terminal.selected .tool-dot");
    expect(selectedToolDotRule.selectors).toContain(".terminal-tile.real-terminal.session-waiting .tool-dot");
    expect(selectedToolDotRule.selectors).toContain(".terminal-tile.real-terminal.error .tool-dot");
  });

  it("keeps terminal tile titles readable before action chrome under constrained width", () => {
    const title = blockFor(".terminal-tile-header .tile-title");
    const titleText = blockFor(".terminal-tile-header .tile-title > div");
    const titleLabel = blockFor(".terminal-tile-header .tile-title b");
    const actions = blockFor(".terminal-tile-header .tile-actions");
    const primaryAction = blockFor(".tile-primary-actions .continue-button");
    const primaryActionText = blockFor(".tile-primary-actions .continue-button span");
    const statusText = singleTopLevelRuleBodyIn(styles, ".terminal-status-text");
    const constrainedStatusText = containerExactRuleBodies("terminal-tile (max-width: 520px)", ".terminal-status-text");

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
    expect(constrainedStatusText).toHaveLength(1);
    expect(constrainedStatusText[0]).toContain("display: none");
  });

  it("keeps shell and terminal identity achromatic", () => {
    const identityDots = blockFor(".tool-dot.manual,\n.tool-dot.codex,\n.tool-dot.claude,\n.tool-dot.dev-server,\n.tool-dot.shell");
    const readyDispatch = blockFor(".dispatch-bar[data-state=\"ready\"] .composer-send:enabled");

    expect(identityDots).toContain("background: var(--ink-5)");
    expect(identityDots).not.toMatch(/--(?:codex-blue|claude-amber|role-attention)/);
    expect(readyDispatch).toContain("background: var(--ink-2)");
    expect(readyDispatch).not.toMatch(/--(?:signal-focus|role-active|role-success)/);
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

  it("reserves the signal color for Alfred's four-point waiting glyph", () => {
    const startingGlyphRule = ruleForSelectorContaining(".session-status-glyph.status-starting");
    const waitingGlyphRule = ruleForSelectorContaining(".session-status-glyph.status-waiting");
    const inboxSignalRule = ruleForSelectorContaining(".inbox-docket__glyph--waiting");
    const projectSignalRule = singleTopLevelRuleBodyIn(styles, ".project-attention-signal");

    expect(startingGlyphRule.selectors).toContain(".session-status-glyph.status-checking");
    expect(startingGlyphRule.selectors).toContain(".session-status-glyph.status-runtime");
    expect(startingGlyphRule.body).toContain("color: var(--ink-5)");
    expect(waitingGlyphRule.body).toContain("color: var(--ink-5)");
    expect(inboxSignalRule.body).toContain("color: var(--signal)");
    expect(projectSignalRule).toContain("color: var(--signal)");
  });

  it("keeps overlay surfaces flat instead of glassy", () => {
    const overlayBackdrop = blockFor(".privacy-backdrop,\n.discard-checkout-backdrop,\n.command-palette-backdrop");
    const commandPalette = blockFor(
      ".command-palette,\n.privacy-panel,\n.discard-checkout-dialog",
    );

    expect(overlayBackdrop).toContain("backdrop-filter: none");
    expect(overlayBackdrop).toContain("background-image: none");
    expect(commandPalette).toContain("background: var(--surface-panel)");
    expect(commandPalette).toContain("background-image: none");
  });

  it("keeps the Work chrome quiet and command-like", () => {
    const tileUtilities = blockForContaining(".tile-utility-actions", "opacity: 0");
    const tileDangerActions = blockForContaining(".tile-danger-actions", "opacity: 0");
    const dispatchBar = blockFor(".dispatch-bar");
    const dispatchCapsule = blockFor(".dispatch-capsule");
    const dispatchChip = exactBlockFor(".dispatch-target-chip");

    expect(styles).toContain(".arrange-mode-label");
    expect(tileUtilities).toContain("opacity: 0");
    expect(tileUtilities).toContain("pointer-events: none");
    expect(tileDangerActions).toContain("opacity: 0");
    expect(tileDangerActions).toContain("pointer-events: none");
    expect(dispatchBar).toContain("grid-template-rows: var(--control-height) 14px");
    expect(dispatchCapsule).toContain("height: var(--control-height)");
    expect(dispatchCapsule).toContain("background: var(--ink-0)");
    expect(dispatchChip).toContain("background-image: none");
  });

  it("keeps live workbench controls within the 7px radius ceiling", () => {
    const workbenchControl = exactBlockFor(".workbench-primary-row button");
    const sessionControl = exactBlockFor(".work-surface-toolbar button");

    expect(workbenchControl).toContain("border-radius: 7px");
    expect(sessionControl).toContain("border-radius: 7px");
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
    "command-palette-button",
    "context-toggle-button",
    "mission-actions",
    "new-terminal-button",
    "workspace-title-main",
  ])("does not retain proven orphan selector .%s", (className) => {
    expect(styles).not.toMatch(orphanClassTokenPattern(className));
  });

  it("keeps passive chrome text readable against the dark panel surface", () => {
    expect(contrastRatio(rootToken("--text-faint"), rootToken("--surface-panel"))).toBeGreaterThanOrEqual(4.0);
  });

  it("keeps chrome microcopy on a readable type floor", () => {
    const summary = blockFor(".inbox-docket__summary");

    expect(styles).toContain("--type-micro: 10px");
    expect(summary).toContain("font: 500 9px/1 var(--mono)");
    expect(styles).not.toMatch(/font-size:\s*(?:8|8\.5)px/);
  });

  it("keeps Context hierarchy quiet except selected session and key signal", () => {
    const drawer = singleTopLevelRuleBodyIn(styles, ".context-drawer");
    const essentials = blockFor(".agent-context-essentials");
    const essentialsCommand = blockFor(".agent-essentials-command");
    const disclosureToggle = blockFor(".agent-disclosure-toggle");
    const factLabel = blockFor(".agent-session-facts dt");
    const factValue = blockFor(".agent-session-facts dd");
    const pulseTitle = blockFor(".agent-session-pulse strong");
    const pulseBody = blockFor(".agent-session-pulse p");
    const handoffButton = blockFor(".agent-handoff-buttons button");

    expect(drawer).toContain("background: var(--ink-1)");
    expect(drawer).toContain("background: color-mix(in oklab, var(--ink-1) 92%, transparent)");
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

  it("keeps project navigator hierarchy quiet but readable", () => {
    const navPanel = singleTopLevelRuleBodyIn(styles, ".project-navigator");
    const navSectionHeader = singleTopLevelRuleBodyIn(styles, ".free-chat-section > header");
    const navRow = singleTopLevelRuleBodyIn(styles, ".project-row-button");
    const navRowTitle = blockFor(".project-row-label,\n.project-session-title");
    const activeWorkspace = blockFor('.project-row-button[aria-selected="true"]');

    expect(navPanel).toContain("background: var(--ink-1)");
    expect(navSectionHeader).toContain("color: var(--ink-5)");
    expect(navSectionHeader).toContain("var(--sans)");
    expect(navRow).toContain("background: transparent");
    expect(navRow).toContain("grid-template-columns: 18px minmax(0, 1fr) auto auto");
    expect(navRowTitle).toContain("text-overflow: ellipsis");
    expect(navRowTitle).toContain("white-space: nowrap");
    expect(activeWorkspace).toContain("background:");
    expect(activeWorkspace).not.toContain("linear-gradient");
    expect(activeWorkspace).toContain("color: var(--ink-7)");
  });

  it("keeps overlays opaque and tactical instead of glassy", () => {
    const primaryOverlayBackdrop = blockFor(
      ".privacy-backdrop,\n.discard-checkout-backdrop,\n.command-palette-backdrop",
    );
    const overlayPanels = blockFor(
      ".command-palette,\n.privacy-panel,\n.discard-checkout-dialog",
    );
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
});
