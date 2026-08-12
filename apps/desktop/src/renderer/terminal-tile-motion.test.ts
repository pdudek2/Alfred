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
      { transformOrigin: "top left", transform: "translate3d(-800px, 0px, 0) scale(2, 2)" },
      { transformOrigin: "top left", transform: "none" },
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
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getRect(this: HTMLElement) {
      const dataset = this.dataset;
      const left = Number(dataset.left ?? 0);
      const top = Number(dataset.top ?? 0);
      const width = Number(dataset.width ?? 0);
      const height = Number(dataset.height ?? 0);
      return {
        x: Number(dataset.visualLeft ?? left),
        y: Number(dataset.visualTop ?? top),
        left: Number(dataset.visualLeft ?? left),
        top: Number(dataset.visualTop ?? top),
        width: Number(dataset.visualWidth ?? width),
        height: Number(dataset.visualHeight ?? height),
        right: Number(dataset.visualLeft ?? left) + Number(dataset.visualWidth ?? width),
        bottom: Number(dataset.visualTop ?? top) + Number(dataset.visualHeight ?? height),
        toJSON: () => ({}),
      } satisfies DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get() {
        return Number((this as HTMLElement).dataset.left ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return Number((this as HTMLElement).dataset.top ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return Number((this as HTMLElement).dataset.width ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return Number((this as HTMLElement).dataset.height ?? 0);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return (this as HTMLElement).parentElement;
      },
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
        { transformOrigin: "top left", transform: "translate3d(-800px, 0px, 0) scale(2, 2)" },
        { transformOrigin: "top left", transform: "none" },
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
          {
            id: "alpha",
            left: 400,
            top: 0,
            width: 400,
            height: 300,
            visualLeft: 800,
            visualTop: 0,
            visualWidth: 400,
            visualHeight: 300,
          },
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

  it("animates only tile shells when nested xterm hosts share the same session id", () => {
    const shellAnimate = vi.fn(() => ownedAnimation());
    const hostAnimate = vi.fn(() => ownedAnimation());

    const { rerender } = render(
      createElement(MotionHarness, {
        tiles: [
          {
            id: "alpha",
            left: 0,
            top: 0,
            width: 800,
            height: 600,
            hostRect: { left: 12, top: 20, width: 760, height: 560 },
          },
        ],
        registerElements: (grid) => {
          const shell = grid.querySelector<HTMLElement>('[data-testid="terminal-tile"][data-session-id="alpha"]');
          const host = grid.querySelector<HTMLElement>('[data-testid="xterm-host"][data-session-id="alpha"]');
          if (!shell || !host) throw new Error("Expected shell and nested xterm host.");
          Object.defineProperty(shell, "animate", {
            configurable: true,
            writable: true,
            value: shellAnimate,
          });
          Object.defineProperty(host, "animate", {
            configurable: true,
            writable: true,
            value: hostAnimate,
          });
        },
      }),
    );

    rerender(
      createElement(MotionHarness, {
        tiles: [
          {
            id: "alpha",
            left: 800,
            top: 0,
            width: 400,
            height: 300,
            hostRect: { left: 820, top: 16, width: 360, height: 268 },
          },
        ],
        registerElements: (grid) => {
          const shell = grid.querySelector<HTMLElement>('[data-testid="terminal-tile"][data-session-id="alpha"]');
          const host = grid.querySelector<HTMLElement>('[data-testid="xterm-host"][data-session-id="alpha"]');
          if (!shell || !host) throw new Error("Expected shell and nested xterm host.");
          Object.defineProperty(shell, "animate", {
            configurable: true,
            writable: true,
            value: shellAnimate,
          });
          Object.defineProperty(host, "animate", {
            configurable: true,
            writable: true,
            value: hostAnimate,
          });
        },
      }),
    );

    expect(shellAnimate).toHaveBeenCalledTimes(1);
    expect(shellAnimate).toHaveBeenCalledWith(
      [
        { transformOrigin: "top left", transform: "translate3d(-800px, 0px, 0) scale(2, 2)" },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: 160, easing: "cubic-bezier(0.2, 0.7, 0.1, 1)" },
    );
    expect(hostAnimate).not.toHaveBeenCalled();
  });
});

function MotionHarness({
  tiles,
  registerForeignAnimations,
  registerElements,
}: {
  tiles: Array<{
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
    visualLeft?: number;
    visualTop?: number;
    visualWidth?: number;
    visualHeight?: number;
    hostRect?: { left: number; top: number; width: number; height: number };
  }>;
  registerForeignAnimations?: (element: HTMLElement) => void;
  registerElements?: (grid: HTMLDivElement) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  useTerminalTileMotion(gridRef);

  useLayoutEffect(() => {
    if (!registerForeignAnimations) return;
    for (const element of gridRef.current?.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][data-session-id]') ?? []) {
      registerForeignAnimations(element);
    }
  });

  useLayoutEffect(() => {
    if (!gridRef.current || !registerElements) return;
    registerElements(gridRef.current);
  });

  return createElement(
    "div",
    { ref: gridRef, className: "terminal-grid three-pane" },
    ...tiles.map((tile) => createElement(
      "article",
      {
        key: tile.id,
        "data-testid": "terminal-tile",
        "data-session-id": tile.id,
        "data-left": tile.left,
        "data-top": tile.top,
        "data-width": tile.width,
        "data-height": tile.height,
        "data-visual-left": tile.visualLeft,
        "data-visual-top": tile.visualTop,
        "data-visual-width": tile.visualWidth,
        "data-visual-height": tile.visualHeight,
      },
      tile.hostRect
        ? createElement("div", {
            "data-testid": "xterm-host",
            "data-session-id": tile.id,
            "data-left": tile.hostRect.left,
            "data-top": tile.hostRect.top,
            "data-width": tile.hostRect.width,
            "data-height": tile.hostRect.height,
          })
        : null,
    )),
  );
}

function ownedAnimation(): Animation {
  return {
    cancel: vi.fn(),
    finished: Promise.resolve(),
  } as unknown as Animation;
}
