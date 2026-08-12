import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_STATE, type DesktopStateSnapshot, type PersistedDesktopStateStore } from "./persisted-desktop-state.js";
import {
  attachWindowStatePersistence,
  restoreWindowPresentation,
  snapshotWindowState,
  windowOptionsFromState,
} from "./window-state.js";

class FakeWindow {
  bounds = { x: 20, y: 30, width: 1440, height: 920 };
  destroyed = false;
  maximized = false;
  listeners = new Map<string, Array<() => void>>();

  getNormalBounds() {
    return { ...this.bounds };
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMaximized() {
    return this.maximized;
  }

  maximize() {
    this.maximized = true;
  }

  on(event: "resize" | "move" | "maximize" | "unmaximize" | "close", listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: "resize" | "move" | "maximize" | "unmaximize" | "close") {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }
}

function fakeStore(initialState: DesktopStateSnapshot = DEFAULT_DESKTOP_STATE): PersistedDesktopStateStore {
  let state = initialState;
  return {
    getState: vi.fn(async () => state),
    setState: vi.fn(async (nextState) => {
      state = nextState;
      return state;
    }),
    updateState: vi.fn(async (updater) => {
      state = await updater(state);
      return state;
    }),
  };
}

describe("window-state", () => {
  it("builds browser window options from persisted bounds", () => {
    expect(
      windowOptionsFromState({
        bounds: { x: 12.4, y: 23.6, width: 1000, height: 600 },
        maximized: false,
      }),
    ).toEqual({ x: 12, y: 24, width: 1120, height: 720 });
  });

  it("restores maximized presentation after the window is ready", () => {
    const window = new FakeWindow();

    restoreWindowPresentation(window, {
      bounds: { width: 1440, height: 920 },
      maximized: true,
    });

    expect(window.maximized).toBe(true);
  });

  it("captures normal bounds and maximized state", () => {
    const window = new FakeWindow();
    window.maximized = true;

    expect(snapshotWindowState(window)).toEqual({
      bounds: { x: 20, y: 30, width: 1440, height: 920 },
      maximized: true,
    });
  });

  it("flushes window state into the shared desktop state store", async () => {
    const window = new FakeWindow();
    const store = fakeStore();
    const handle = attachWindowStatePersistence(window, store, 0);

    window.bounds = { x: 64, y: 48, width: 1600, height: 1000 };
    window.maximized = true;
    await handle.flush();

    expect(store.updateState).toHaveBeenCalledOnce();
    await expect(store.getState()).resolves.toEqual({
      ...DEFAULT_DESKTOP_STATE,
      windowState: {
        bounds: { x: 64, y: 48, width: 1600, height: 1000 },
        maximized: true,
      },
    });
  });

  it("contains rejected background window-state writes", async () => {
    const window = new FakeWindow();
    const store = fakeStore();
    const rejection = new Error("disk unavailable");
    vi.mocked(store.updateState).mockRejectedValue(rejection);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      attachWindowStatePersistence(window, store, 0);
      window.emit("resize");
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(
        "Failed to persist window state in background.",
        rejection,
      );
    } finally {
      process.off("unhandledRejection", unhandled);
      warning.mockRestore();
    }
  });
});
