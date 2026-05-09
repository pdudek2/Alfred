import type { Rectangle } from "electron";
import type {
  DesktopWindowBounds,
  DesktopWindowState,
  PersistedDesktopStateStore,
} from "./persisted-desktop-state.js";

const MIN_WINDOW_WIDTH = 1120;
const MIN_WINDOW_HEIGHT = 720;

type WindowStateTarget = {
  getNormalBounds(): Rectangle;
  isDestroyed(): boolean;
  isMaximized(): boolean;
  maximize(): void;
  on(event: "resize" | "move" | "maximize" | "unmaximize" | "close", listener: () => void): void;
};

export type WindowStatePersistenceHandle = {
  flush(): Promise<void>;
};

export function windowOptionsFromState(state: DesktopWindowState): DesktopWindowBounds {
  const bounds = normalizeBounds(state.bounds);
  return {
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x === undefined ? {} : { x: bounds.x }),
    ...(bounds.y === undefined ? {} : { y: bounds.y }),
  };
}

export function restoreWindowPresentation(window: WindowStateTarget, state: DesktopWindowState): void {
  if (state.maximized && !window.isDestroyed()) {
    window.maximize();
  }
}

export function attachWindowStatePersistence(
  window: WindowStateTarget,
  store: PersistedDesktopStateStore,
  debounceMs = 400,
): WindowStatePersistenceHandle {
  let timer: NodeJS.Timeout | null = null;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (window.isDestroyed()) return;

    await store.updateState((current) => ({
      ...current,
      windowState: snapshotWindowState(window),
    }));
  };

  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }

    if (debounceMs <= 0) {
      void flush();
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", () => {
    void flush();
  });

  return { flush };
}

export function snapshotWindowState(window: Pick<WindowStateTarget, "getNormalBounds" | "isMaximized">): DesktopWindowState {
  return {
    bounds: normalizeBounds(window.getNormalBounds()),
    maximized: window.isMaximized(),
  };
}

function normalizeBounds(bounds: DesktopWindowBounds): DesktopWindowBounds {
  return {
    width: Math.max(Math.round(bounds.width), MIN_WINDOW_WIDTH),
    height: Math.max(Math.round(bounds.height), MIN_WINDOW_HEIGHT),
    ...(bounds.x === undefined ? {} : { x: Math.round(bounds.x) }),
    ...(bounds.y === undefined ? {} : { y: Math.round(bounds.y) }),
  };
}
