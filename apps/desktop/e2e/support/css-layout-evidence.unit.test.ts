import { describe, expect, it } from "vitest";
import {
  captureReadinessForState,
  compareCssEvidence,
  type CssStateEvidence,
} from "./css-layout-evidence";

const baseline: CssStateEvidence[] = [{
  state: "work-grid",
  viewport: { width: 1440, height: 920 },
  documentOverflowX: 0,
  nodes: [{
    name: "desktop-frame",
    selector: ".desktop-frame",
    present: true,
    rect: { x: 8, y: 8, width: 1424, height: 904 },
    computed: { display: "grid", overflow: "hidden" },
  }],
}];

describe("CSS layout evidence comparison", () => {
  it("waits for the command palette selection effect before capture", () => {
    expect(captureReadinessForState("command-palette")).toEqual({
      selector: ".command-palette-list [role='option'][aria-selected='true']",
    });
    expect(captureReadinessForState("inbox")).toBeNull();
  });

  it("accepts geometry noise up to one pixel", () => {
    const actual = structuredClone(baseline);
    actual[0]!.nodes[0]!.rect!.width += 1;
    expect(compareCssEvidence(actual, baseline, 1)).toEqual([]);
  });

  it("rejects geometry drift above one pixel", () => {
    const actual = structuredClone(baseline);
    actual[0]!.nodes[0]!.rect!.height += 1.01;
    expect(compareCssEvidence(actual, baseline, 1)).toEqual([
      expect.objectContaining({ owner: "desktop-frame", field: "rect.height" }),
    ]);
  });

  it("rejects exact computed-style drift and missing owners", () => {
    const actual = structuredClone(baseline);
    actual[0]!.nodes[0]!.computed.overflow = "auto";
    actual[0]!.nodes[0]!.present = false;
    expect(compareCssEvidence(actual, baseline, 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "present" }),
      expect.objectContaining({ field: "computed.overflow" }),
    ]));
  });

  it("rejects duplicate state entries", () => {
    const actual = [...structuredClone(baseline), ...structuredClone(baseline)];
    expect(compareCssEvidence(actual, baseline, 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: "<state>", field: "state.count", expected: 1, actual: 2 }),
    ]));
  });

  it("rejects duplicate owner entries", () => {
    const actual = structuredClone(baseline);
    actual[0]!.nodes.push(structuredClone(actual[0]!.nodes[0]!));
    expect(compareCssEvidence(actual, baseline, 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: "desktop-frame", field: "owner.count", expected: 1, actual: 2 }),
    ]));
  });
});
