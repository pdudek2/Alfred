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

  it("moves menu focus with arrows Home and End and closes on Tab", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ChromeMenu
          label="Open Surfaces menu"
          title="Surfaces"
          items={[
            { id: "work", label: "Work", run: vi.fn() },
            { id: "disabled", label: "Disabled", disabled: true, run: vi.fn() },
            { id: "observatory", label: "Observatory", run: vi.fn() },
            { id: "context", label: "Context", run: vi.fn() },
          ]}
        >
          Surfaces
        </ChromeMenu>
        <button type="button">After menu</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
    expect(screen.getByRole("menuitem", { name: "Work" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Observatory" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Context" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Work" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Context" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After menu" })).toHaveFocus();
  });

  it("moves Tab outside when the first item owns focus", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ChromeMenu
          label="Open Surfaces menu"
          title="Surfaces"
          items={[
            { id: "work", label: "Work", run: vi.fn() },
            { id: "disabled", label: "Disabled", disabled: true, run: vi.fn() },
            { id: "observatory", label: "Observatory", run: vi.fn() },
            { id: "context", label: "Context", run: vi.fn() },
          ]}
        >
          Surfaces
        </ChromeMenu>
        <button type="button">After menu</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
    expect(screen.getByRole("menuitem", { name: "Work" })).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After menu" })).toHaveFocus();
  });

  it("moves Tab outside when a middle item owns focus", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ChromeMenu
          label="Open Surfaces menu"
          title="Surfaces"
          items={[
            { id: "work", label: "Work", run: vi.fn() },
            { id: "disabled", label: "Disabled", disabled: true, run: vi.fn() },
            { id: "observatory", label: "Observatory", run: vi.fn() },
            { id: "context", label: "Context", run: vi.fn() },
          ]}
        >
          Surfaces
        </ChromeMenu>
        <button type="button">After menu</button>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Open Surfaces menu" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Observatory" })).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "After menu" })).toHaveFocus();
  });

  it("moves Shift+Tab back to the trigger from the last item", async () => {
    const user = userEvent.setup();
    render(
      <ChromeMenu
        label="Open Surfaces menu"
        title="Surfaces"
        items={[
          { id: "work", label: "Work", run: vi.fn() },
          { id: "disabled", label: "Disabled", disabled: true, run: vi.fn() },
          { id: "observatory", label: "Observatory", run: vi.fn() },
          { id: "context", label: "Context", run: vi.fn() },
        ]}
      >
        Surfaces
      </ChromeMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Open Surfaces menu" });
    await user.click(trigger);
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Context" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
