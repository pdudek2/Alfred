import { describe, expect, it } from "vitest";
import { controlOverflowEvidence } from "./control-overflow-evidence";

const viewport = { width: 1120, height: 720 };

describe("control overflow evidence", () => {
  it("reports top and bottom clipping for an active control without a vertical scroll owner", () => {
    expect(controlOverflowEvidence({
      viewport,
      controls: [
        { label: "Clipped top", rect: { left: 10, right: 110, top: -12, bottom: 28 }, scrollOwnerId: null },
        { label: "Clipped bottom", rect: { left: 10, right: 110, top: 700, bottom: 744 }, scrollOwnerId: null },
      ],
      scrollOwners: [],
    })).toEqual([
      {
        kind: "control",
        label: "Clipped top",
        sides: { left: 0, right: 0, top: 12, bottom: 0 },
      },
      {
        kind: "control",
        label: "Clipped bottom",
        sides: { left: 0, right: 0, top: 0, bottom: 24 },
      },
    ]);
  });

  it("allows an offscreen child only when its intentional vertical scroll owner fits", () => {
    expect(controlOverflowEvidence({
      viewport,
      controls: [{
        label: "Load more transcript",
        rect: { left: 600, right: 780, top: 2_700, bottom: 2_740 },
        scrollOwnerId: "reader",
      }],
      scrollOwners: [{
        id: "reader",
        label: "Sessions reader",
        overflowY: "auto",
        rect: { left: 500, right: 1_100, top: 90, bottom: 700 },
      }],
    })).toEqual([]);
  });

  it("reports the scroll owner sides when an offscreen child is owned but the owner clips", () => {
    expect(controlOverflowEvidence({
      viewport,
      controls: [{
        label: "Load more transcript",
        rect: { left: 600, right: 780, top: 2_700, bottom: 2_740 },
        scrollOwnerId: "reader",
      }],
      scrollOwners: [{
        id: "reader",
        label: "Sessions reader",
        overflowY: "auto",
        rect: { left: 500, right: 1_100, top: 90, bottom: 760 },
      }],
    })).toEqual([{
      kind: "scroll-owner",
      label: "Sessions reader",
      sides: { left: 0, right: 0, top: 0, bottom: 40 },
    }]);
  });

  it("rejects a claimed owner that is not an intentional vertical scroll owner", () => {
    expect(controlOverflowEvidence({
      viewport,
      controls: [{
        label: "Offscreen child",
        rect: { left: 10, right: 110, top: 900, bottom: 940 },
        scrollOwnerId: "visible-owner",
      }],
      scrollOwners: [{
        id: "visible-owner",
        label: "Visible owner",
        overflowY: "visible",
        rect: { left: 0, right: 420, top: 90, bottom: 700 },
      }],
    })).toEqual([{
      kind: "scroll-owner",
      label: "Visible owner",
      reason: "not-vertical-scroll-owner",
      sides: { left: 0, right: 0, top: 0, bottom: 0 },
    }]);
  });

  it("keeps left and right checks for children inside a vertical scroll owner", () => {
    expect(controlOverflowEvidence({
      viewport,
      controls: [{
        label: "Wide result",
        rect: { left: -4, right: 1_130, top: 2_700, bottom: 2_740 },
        scrollOwnerId: "results",
      }],
      scrollOwners: [{
        id: "results",
        label: "Sessions results",
        overflowY: "auto",
        rect: { left: 0, right: 420, top: 90, bottom: 700 },
      }],
    })).toEqual([{
      kind: "control",
      label: "Wide result",
      sides: { left: 4, right: 10, top: 0, bottom: 0 },
    }]);
  });
});
