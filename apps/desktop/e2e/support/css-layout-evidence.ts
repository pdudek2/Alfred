import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export type CssEvidenceStateName =
  | "work-grid"
  | "prepare-work"
  | "focus"
  | "split"
  | "arrange"
  | "inbox"
  | "observatory"
  | "context"
  | "narrow"
  | "narrow-inbox"
  | "command-palette"
  | "privacy";

export function captureReadinessForState(
  state: CssEvidenceStateName,
): { selector: string } | null {
  return state === "command-palette"
    ? { selector: ".command-palette-list [role='option'][aria-selected='true']" }
    : null;
}

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
