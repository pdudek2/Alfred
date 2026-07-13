import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeMenu } from "./ChromeMenu";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
});

describe("ChromeMenu", () => {
  it("opens, focuses the first item, runs it, and restores focus", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <ChromeMenu
        label="Open Surfaces menu"
        title="Surfaces"
        items={[
          { id: "work", label: "Work", run },
          { id: "observatory", label: "Observatory", run: vi.fn() },
        ]}
      >
        Surfaces
      </ChromeMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Open Surfaces menu" });
    trigger.focus();
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Work" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(run).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and outside pointer input without running an item", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <div>
        <ChromeMenu
          label="Open launch menu"
          title="New"
          items={[{ id: "manual", label: "New manual terminal", run }]}
        >
          +
        </ChromeMenu>
        <button type="button">Outside</button>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Open launch menu" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
});
