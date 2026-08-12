import { useLayoutEffect, useRef, type RefObject } from "react";

const MOTION_DURATION_MS = 160;
const MOTION_EASING = "cubic-bezier(0.2, 0.7, 0.1, 1)";
const GEOMETRY_EPSILON = 0.5;

type TileRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TileAnimation = Pick<Animation, "cancel">;

export function tileFlipKeyframes(previous: TileRect, current: TileRect): Keyframe[] | null {
  const deltaX = previous.left - current.left;
  const deltaY = previous.top - current.top;
  const scaleX = current.width === 0 ? 1 : previous.width / current.width;
  const scaleY = current.height === 0 ? 1 : previous.height / current.height;

  if (
    nearlyEqual(deltaX, 0)
    && nearlyEqual(deltaY, 0)
    && nearlyEqual(scaleX, 1)
    && nearlyEqual(scaleY, 1)
  ) {
    return null;
  }

  return [
    {
      transformOrigin: "top left",
      transform: `translate3d(${formatMotionNumber(deltaX)}px, ${formatMotionNumber(deltaY)}px, 0) scale(${formatMotionNumber(scaleX)}, ${formatMotionNumber(scaleY)})`,
    },
    { transformOrigin: "top left", transform: "none" },
  ];
}

export function tileEntryKeyframes(): Keyframe[] {
  return [
    { opacity: 0, transform: "translate3d(0px, 12px, 0)" },
    { opacity: 1, transform: "none" },
  ];
}

export function useTerminalTileMotion(gridRef: RefObject<HTMLElement | null>): void {
  const rectsRef = useRef(new Map<string, TileRect>());
  const animationsRef = useRef(new Map<HTMLElement, TileAnimation>());

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const visibleTiles = collectVisibleTiles(grid);
    if (!shouldAnimateGrid(grid)) {
      cancelOwnedAnimations(animationsRef);
      rectsRef.current = snapshotRects(visibleTiles);
      return;
    }

    if (rectsRef.current.size === 0) {
      rectsRef.current = snapshotRects(visibleTiles);
      return;
    }

    for (const [element, animation] of animationsRef.current) {
      if (visibleTiles.includes(element)) continue;
      animation.cancel();
      animationsRef.current.delete(element);
    }

    const nextRects = new Map<string, TileRect>();
    for (const tile of visibleTiles) {
      const sessionId = tile.dataset.sessionId;
      if (!sessionId) continue;

      const committedRect = readCommittedTileRect(tile);
      nextRects.set(sessionId, committedRect);

      const previousRect = rectsRef.current.get(sessionId);
      const ownedAnimation = animationsRef.current.get(tile);
      if (!previousRect) {
        if (typeof tile.animate !== "function") continue;
        const animation = tile.animate(tileEntryKeyframes(), { duration: MOTION_DURATION_MS, easing: MOTION_EASING });
        animationsRef.current.set(tile, animation);
        continue;
      }

      const layoutChanged = tileFlipKeyframes(previousRect, committedRect);
      if (!layoutChanged) continue;
      if (typeof tile.animate !== "function") continue;

      const visualRect = ownedAnimation ? readVisualTileRect(tile) : previousRect;
      const keyframes = tileFlipKeyframes(visualRect, committedRect);
      ownedAnimation?.cancel();
      if (!keyframes) {
        animationsRef.current.delete(tile);
        continue;
      }
      const animation = tile.animate(keyframes, { duration: MOTION_DURATION_MS, easing: MOTION_EASING });
      animationsRef.current.set(tile, animation);
    }

    rectsRef.current = nextRects;
  });
}

function collectVisibleTiles(grid: HTMLElement): HTMLElement[] {
  return Array.from(grid.querySelectorAll<HTMLElement>('[data-testid="terminal-tile"][data-session-id]'))
    .filter((tile) => !isHiddenTile(tile));
}

function shouldAnimateGrid(grid: HTMLElement): boolean {
  if (grid.classList.contains("arranging") || !grid.classList.contains("three-pane")) return false;
  if (typeof grid.animate !== "function") return false;
  if (grid.closest("[aria-hidden=\"true\"], [hidden], [inert]")) return false;
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  return true;
}

function snapshotRects(tiles: HTMLElement[]): Map<string, TileRect> {
  const rects = new Map<string, TileRect>();
  for (const tile of tiles) {
    const sessionId = tile.dataset.sessionId;
    if (!sessionId) continue;
    rects.set(sessionId, readCommittedTileRect(tile));
  }
  return rects;
}

function cancelOwnedAnimations(animationsRef: { current: Map<HTMLElement, TileAnimation> }): void {
  for (const animation of animationsRef.current.values()) {
    animation.cancel();
  }
  animationsRef.current.clear();
}

function readVisualTileRect(tile: HTMLElement): TileRect {
  const { left, top, width, height } = tile.getBoundingClientRect();
  return { left, top, width, height };
}

function readCommittedTileRect(tile: HTMLElement): TileRect {
  const offsetParent = tile.offsetParent;
  const anchorRect = offsetParent instanceof HTMLElement
    ? offsetParent.getBoundingClientRect()
    : { left: 0, top: 0 };
  return {
    left: anchorRect.left + tile.offsetLeft,
    top: anchorRect.top + tile.offsetTop,
    width: tile.offsetWidth,
    height: tile.offsetHeight,
  };
}

function isHiddenTile(tile: HTMLElement): boolean {
  return tile.getAttribute("aria-hidden") === "true" || tile.closest("[aria-hidden=\"true\"], [hidden], [inert]") !== null;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= GEOMETRY_EPSILON;
}

function formatMotionNumber(value: number): string {
  return String(Number.parseFloat(value.toFixed(4)));
}
