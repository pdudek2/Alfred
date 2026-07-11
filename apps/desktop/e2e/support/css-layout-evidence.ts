import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

export type CssEvidenceStateName =
  | "work-grid"
  | "focus"
  | "split"
  | "arrange"
  | "inbox"
  | "observatory"
  | "context"
  | "narrow"
  | "command-palette"
  | "privacy"
  | "session-quick-switch";

export type CssOwnerProbe = {
  name: string;
  selector: string;
  properties: string[];
  required: boolean;
};

export type CssNodeEvidence = {
  name: string;
  selector: string;
  present: boolean;
  rect: { x: number; y: number; width: number; height: number } | null;
  computed: Record<string, string>;
};

export type CssStateEvidence = {
  state: CssEvidenceStateName;
  viewport: { width: number; height: number };
  documentOverflowX: number;
  nodes: CssNodeEvidence[];
};

export type CssEvidenceMismatch = {
  state: CssEvidenceStateName;
  owner: string;
  field: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
};

type Comparable = string | number | boolean | null;

function mismatch(
  state: CssEvidenceStateName,
  owner: string,
  field: string,
  expected: Comparable,
  actual: Comparable,
): CssEvidenceMismatch {
  return { state, owner, field, expected, actual };
}

function countsFor<T>(entries: T[], name: (entry: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = name(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function compareCssEvidence(
  actual: CssStateEvidence[],
  expected: CssStateEvidence[],
  geometryTolerance: number,
): CssEvidenceMismatch[] {
  const mismatches: CssEvidenceMismatch[] = [];
  const actualStates = new Map(actual.map((entry) => [entry.state, entry]));
  const expectedStates = new Map(expected.map((entry) => [entry.state, entry]));
  const actualStateCounts = countsFor(actual, (entry) => entry.state);
  const expectedStateCounts = countsFor(expected, (entry) => entry.state);

  for (const stateName of new Set([...expectedStates.keys(), ...actualStates.keys()])) {
    const actualStateCount = actualStateCounts.get(stateName) ?? 0;
    const expectedStateCount = expectedStateCounts.get(stateName) ?? 0;
    if (actualStateCount !== expectedStateCount) {
      mismatches.push(mismatch(
        stateName,
        "<state>",
        "state.count",
        expectedStateCount,
        actualStateCount,
      ));
    }
    const actualState = actualStates.get(stateName);
    const expectedState = expectedStates.get(stateName);
    if (!expectedState || !actualState) {
      mismatches.push(mismatch(
        stateName,
        "<state>",
        "present",
        Boolean(expectedState),
        Boolean(actualState),
      ));
      continue;
    }

    for (const field of ["width", "height"] as const) {
      if (actualState.viewport[field] !== expectedState.viewport[field]) {
        mismatches.push(mismatch(
          stateName,
          "<state>",
          `viewport.${field}`,
          expectedState.viewport[field],
          actualState.viewport[field],
        ));
      }
    }
    if (actualState.documentOverflowX !== expectedState.documentOverflowX) {
      mismatches.push(mismatch(
        stateName,
        "<state>",
        "documentOverflowX",
        expectedState.documentOverflowX,
        actualState.documentOverflowX,
      ));
    }

    const actualNodes = new Map(actualState.nodes.map((node) => [node.name, node]));
    const expectedNodes = new Map(expectedState.nodes.map((node) => [node.name, node]));
    const actualOwnerCounts = countsFor(actualState.nodes, (node) => node.name);
    const expectedOwnerCounts = countsFor(expectedState.nodes, (node) => node.name);
    for (const owner of new Set([...expectedNodes.keys(), ...actualNodes.keys()])) {
      const actualOwnerCount = actualOwnerCounts.get(owner) ?? 0;
      const expectedOwnerCount = expectedOwnerCounts.get(owner) ?? 0;
      if (actualOwnerCount !== expectedOwnerCount) {
        mismatches.push(mismatch(
          stateName,
          owner,
          "owner.count",
          expectedOwnerCount,
          actualOwnerCount,
        ));
      }
      const actualNode = actualNodes.get(owner);
      const expectedNode = expectedNodes.get(owner);
      if (!expectedNode || !actualNode) {
        mismatches.push(mismatch(
          stateName,
          owner,
          "owner",
          expectedNode ? owner : null,
          actualNode ? owner : null,
        ));
        continue;
      }
      if (actualNode.present !== expectedNode.present) {
        mismatches.push(mismatch(stateName, owner, "present", expectedNode.present, actualNode.present));
      }
      if (actualNode.selector !== expectedNode.selector) {
        mismatches.push(mismatch(stateName, owner, "selector", expectedNode.selector, actualNode.selector));
      }

      if (expectedNode.rect === null || actualNode.rect === null) {
        if (expectedNode.rect !== actualNode.rect) {
          mismatches.push(mismatch(
            stateName,
            owner,
            "rect",
            expectedNode.rect === null ? null : "present",
            actualNode.rect === null ? null : "present",
          ));
        }
      } else {
        for (const field of ["x", "y", "width", "height"] as const) {
          if (Math.abs(actualNode.rect[field] - expectedNode.rect[field]) > geometryTolerance) {
            mismatches.push(mismatch(
              stateName,
              owner,
              `rect.${field}`,
              expectedNode.rect[field],
              actualNode.rect[field],
            ));
          }
        }
      }

      for (const property of new Set([
        ...Object.keys(expectedNode.computed),
        ...Object.keys(actualNode.computed),
      ])) {
        const actualValue = actualNode.computed[property] ?? null;
        const expectedValue = expectedNode.computed[property] ?? null;
        if (actualValue !== expectedValue) {
          mismatches.push(mismatch(
            stateName,
            owner,
            `computed.${property}`,
            expectedValue,
            actualValue,
          ));
        }
      }
    }
  }

  return mismatches;
}

export async function captureCssEvidence(
  page: Page,
  state: CssEvidenceStateName,
  probes: CssOwnerProbe[],
): Promise<CssStateEvidence> {
  const evidence = await page.evaluate(({ evidenceState, ownerProbes }) => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const nodes = ownerProbes.map((probe) => {
      const element = document.querySelector(probe.selector);
      if (!element) {
        return {
          name: probe.name,
          selector: probe.selector,
          required: probe.required,
          present: false,
          rect: null,
          computed: {},
        };
      }
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        name: probe.name,
        selector: probe.selector,
        required: probe.required,
        present: true,
        rect: {
          x: round(bounds.x),
          y: round(bounds.y),
          width: round(bounds.width),
          height: round(bounds.height),
        },
        computed: Object.fromEntries(
          probe.properties.map((property) => [property, style.getPropertyValue(property).trim()]),
        ),
      };
    });
    return {
      state: evidenceState,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      nodes,
    };
  }, { evidenceState: state, ownerProbes: probes });

  const absentRequired = evidence.nodes.filter((node) => node.required && !node.present);
  if (absentRequired.length > 0) {
    throw new Error(`Required CSS evidence owners absent: ${absentRequired.map((node) => node.name).join(", ")}`);
  }

  return {
    state: evidence.state,
    viewport: evidence.viewport,
    documentOverflowX: evidence.documentOverflowX,
    nodes: evidence.nodes.map(({ required: _required, ...node }) => node),
  };
}

export function assertCssEvidenceMatchesBaseline(
  actual: CssStateEvidence[],
  expected: CssStateEvidence[],
  { geometryTolerance }: { geometryTolerance: number },
): void {
  const mismatches = compareCssEvidence(actual, expected, geometryTolerance);
  expect(mismatches, JSON.stringify(mismatches, null, 2)).toEqual([]);
}

export async function readCssEvidence(directory: string): Promise<CssStateEvidence[]> {
  return JSON.parse(await readFile(join(directory, "css-layout-evidence.json"), "utf8")) as CssStateEvidence[];
}

export async function writeCssEvidence(
  testInfo: TestInfo,
  directory: string,
  states: CssStateEvidence[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, "css-layout-evidence.json");
  await writeFile(path, `${JSON.stringify(states, null, 2)}\n`, "utf8");
  await testInfo.attach("css-layout-evidence", { path, contentType: "application/json" });
}
