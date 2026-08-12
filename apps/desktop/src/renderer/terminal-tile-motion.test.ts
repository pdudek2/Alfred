import { render } from "@testing-library/react";
import { createElement, useLayoutEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tileEntryKeyframes, tileFlipKeyframes, useTerminalTileMotion } from "./terminal-tile-motion";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("tileFlipKeyframes", () => {
  it("returns FLIP transform keyframes for a shared tile whose geometry changed", () => {
    expect(tileFlipKeyframes(
      { left: 0, top: 0, width: 800, height: 600 },
      { left: 800, top: 0, width: 400, height: 300 },
    )).toEqual([
      { transform: "translate3d(-800px, 0px, 0) scale(2, 2)" },
      { transform: "none" },
    ]);
  });

  it("returns null when the tile geometry did not change", () => {
    expect(tileFlipKeyframes(
      { left: 24, top: 16, width: 500, height: 320 },
      { left: 24, top: 16, width: 500, height: 320 },
    )).toBeNull();
  });
});

describe("tileEntryKeyframes", () => {
  it("returns restrained entry keyframes for a newly visible tile", () => {
    expect(tileEntryKeyframes()).toEqual([
      { opacity: 0, transform: "translate3d(0px, 12px, 0)" },
      { opacity: 1, transform: "none" },
    ]);
  });
});

describe("useTerminalTileMotion", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect() {
      const element = this as HTMLElement;
      const left = Number(element.dataset.left ?? 0);
      const top = Number(element.dataset.top ?? 0);
      const width = Number(element.dataset.width ?? 0);
      const height = Number(element.dataset.height ?? 0);
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      } satisfies DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ownedAnimation()),
    });
  });

  it("animates a shared visible tile from prior geometry", () => {
    const animate = vi.fn(() => ownedAnimation());
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });

    const { rerender } = render(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 0, top: 0, width: 800, height: 600 },
        ],
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 800, top: 0, width: 400, height: 300 },
        ],
      }),
    );

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translate3d(-800px, 0px, 0) scale(2, 2)" },
        { transform: "none" },
      ],
      { duration: 160, easing: "cubic-bezier(0.2, 0.7, 0.1, 1)" },
    );
  });

  it("animates a newly visible tile with restrained entry keyframes", () => {
    const animate = vi.fn(() => ownedAnimation());
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });

    const { rerender } = render(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 0, top: 0, width: 800, height: 600 },
        ],
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 0, top: 0, width: 800, height: 600 },
          { id: "beta", left: 800, top: 0, width: 400, height: 300 },
        ],
      }),
    );

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [
        { opacity: 0, transform: "translate3d(0px, 12px, 0)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 160, easing: "cubic-bezier(0.2, 0.7, 0.1, 1)" },
    );
  });

  it("bypasses WAAPI when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const animate = vi.fn(() => ownedAnimation());
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });

    const { rerender } = render(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 0, top: 0, width: 800, height: 600 },
        ],
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 800, top: 0, width: 400, height: 300 },
        ],
      }),
    );

    expect(animate).not.toHaveBeenCalled();
  });

  it("cancels only its own prior animation before starting a new one", () => {
    const firstOwned = ownedAnimation();
    const secondOwned = ownedAnimation();
    const foreign = ownedAnimation();
    const animate = vi
      .fn()
      .mockReturnValueOnce(firstOwned)
      .mockReturnValueOnce(secondOwned);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });

    const { rerender } = render(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 0, top: 0, width: 800, height: 600 },
        ],
        registerForeignAnimations: (element: HTMLElement) => {
          Object.defineProperty(element, "getAnimations", {
            configurable: true,
            writable: true,
            value: vi.fn(() => [firstOwned, foreign] as Animation[]),
          });
        },
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 800, top: 0, width: 400, height: 300 },
        ],
        registerForeignAnimations: (element: HTMLElement) => {
          Object.defineProperty(element, "getAnimations", {
            configurable: true,
            writable: true,
            value: vi.fn(() => [firstOwned, foreign] as Animation[]),
          });
        },
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 400, top: 0, width: 400, height: 300 },
        ],
        registerForeignAnimations: (element: HTMLElement) => {
          Object.defineProperty(element, "getAnimations", {
            configurable: true,
            writable: true,
            value: vi.fn(() => [secondOwned, foreign] as Animation[]),
          });
        },
      }),
    );

    expect(firstOwned.cancel).toHaveBeenCalledTimes(1);
    expect(foreign.cancel).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("keeps its running animation on a same-geometry rerender", () => {
    const firstOwned = ownedAnimation();
    const animate = vi.fn().mockReturnValue(firstOwned);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });

    const { rerender } = render(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 0, top: 0, width: 800, height: 600 },
        ],
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 800, top: 0, width: 400, height: 300 },
        ],
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          { id: "alpha", left: 800, top: 0, width: 400, height: 300 },
        ],
      }),
    );

    expect(animate).toHaveBeenCalledTimes(1);
    expect(firstOwned.cancel).not.toHaveBeenCalled();
  });
});

function MotionHarness({
  tiles,
  registerForeignAnimations,
}: {
  tiles: Array<{ id: string; left: number; top: number; width: number; height: number }>;
  registerForeignAnimations?: (element: HTMLElement) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  useTerminalTileMotion(gridRef);

  useLayoutEffect(() => {
    if (!registerForeignAnimations) return;
    for (const element of gridRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? []) {
      registerForeignAnimations(element);
    }
  });

  return createElement(
    "div",
    { ref: gridRef, className: "terminal-grid three-pane" },
    ...tiles.map((tile) => createElement("article", {
      key: tile.id,
      "data-session-id": tile.id,
      "data-left": tile.left,
      "data-top": tile.top,
      "data-width": tile.width,
      "data-height": tile.height,
    })),
  );
}

function ownedAnimation(): Animation {
  return {
    cancel: vi.fn(),
    finished: Promise.resolve(),
  } as unknown as Animation;
}
