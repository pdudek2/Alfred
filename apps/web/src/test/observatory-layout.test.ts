import { describe, expect, it } from "vitest";

import { computeObservatoryLayout } from "../lib/observatory-layout";
import { runFixture } from "./fixtures";

const viewport = { width: 800, height: 600 };

describe("computeObservatoryLayout", () => {
  it("groups runs into project clusters", () => {
    const runs = [
      { ...runFixture, id: "r1", project_name: "alfred-runner" },
      { ...runFixture, id: "r2", project_name: "alfred-runner" },
      { ...runFixture, id: "r3", project_name: "alfred-web" },
    ];

    const layout = computeObservatoryLayout(runs, viewport);

    expect(layout.clusters.map((cluster) => cluster.label).sort()).toEqual(["alfred-runner", "alfred-web"]);
    expect(layout.clusters.find((cluster) => cluster.label === "alfred-runner")?.nodes).toHaveLength(2);
  });

  it("produces deterministic positions for identical inputs", () => {
    const runs = [{ ...runFixture, id: "r1", project_name: "alfred-runner" }];

    const first = computeObservatoryLayout(runs, viewport);
    const second = computeObservatoryLayout(runs, viewport);

    expect(second).toEqual(first);
  });

  it("draws an edge between parent and child runs in the same cluster", () => {
    const runs = [
      { ...runFixture, id: "parent", project_name: "alfred-runner" },
      { ...runFixture, id: "child", parent_run_id: "parent", project_name: "alfred-runner" },
    ];

    const layout = computeObservatoryLayout(runs, viewport);

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.crossCluster).toBe(false);
  });

  it("marks cross-cluster edges", () => {
    const runs = [
      { ...runFixture, id: "parent", project_name: "alfred-runner" },
      { ...runFixture, id: "child", parent_run_id: "parent", project_name: "alfred-web" },
    ];

    const layout = computeObservatoryLayout(runs, viewport);

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.crossCluster).toBe(true);
  });

  it("places clusters within viewport bounds", () => {
    const runs = Array.from({ length: 4 }, (_, index) => ({
      ...runFixture,
      id: `r${index}`,
      project_name: `project-${index}`,
    }));

    const layout = computeObservatoryLayout(runs, viewport);

    for (const cluster of layout.clusters) {
      expect(cluster.center.x).toBeGreaterThanOrEqual(0);
      expect(cluster.center.x).toBeLessThanOrEqual(viewport.width);
      expect(cluster.center.y).toBeGreaterThanOrEqual(0);
      expect(cluster.center.y).toBeLessThanOrEqual(viewport.height);
    }
  });

  it("places every node within viewport bounds", () => {
    const runs = Array.from({ length: 16 }, (_, index) => ({
      ...runFixture,
      id: `r${index}`,
      project_name: `project-${index % 4}`,
    }));

    const layout = computeObservatoryLayout(runs, viewport);

    for (const cluster of layout.clusters) {
      for (const node of cluster.nodes) {
        expect(node.position.x).toBeGreaterThanOrEqual(0);
        expect(node.position.x).toBeLessThanOrEqual(viewport.width);
        expect(node.position.y).toBeGreaterThanOrEqual(0);
        expect(node.position.y).toBeLessThanOrEqual(viewport.height);
      }
    }
  });
});
