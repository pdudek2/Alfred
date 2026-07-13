import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PrepareWorkPopover } from "./PrepareWorkPopover";

afterEach(() => {
  cleanup();
});

it("autofocuses dispatch, closes on Escape, and restores the trigger", async () => {
  const user = userEvent.setup();
  const triggerRef = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(
    <>
      <button ref={triggerRef}>Launch</button>
      <PrepareWorkPopover triggerRef={triggerRef} onClose={onClose}>
        <textarea aria-label="Dispatch instruction" autoFocus />
      </PrepareWorkPopover>
    </>,
  );
  expect(screen.getByRole("textbox", { name: "Dispatch instruction" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
  expect(triggerRef.current).toHaveFocus();
});

it("closes on pointer input outside the non-modal dialog", async () => {
  const user = userEvent.setup();
  const triggerRef = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(
    <>
      <button ref={triggerRef}>Launch</button>
      <PrepareWorkPopover triggerRef={triggerRef} onClose={onClose}>
        <textarea aria-label="Dispatch instruction" />
      </PrepareWorkPopover>
      <button>Outside</button>
    </>,
  );

  await user.pointer({ keys: "[MouseLeft]", target: screen.getByRole("button", { name: "Outside" }) });
  expect(onClose).toHaveBeenCalledOnce();
  expect(triggerRef.current).toHaveFocus();
});

it("restores the previously focused element when the trigger is unavailable", async () => {
  const user = userEvent.setup();
  const triggerRef = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  const view = render(<button>Previous</button>);
  const previous = screen.getByRole("button", { name: "Previous" });
  previous.focus();

  view.rerender(
    <>
      <button>Previous</button>
      <PrepareWorkPopover triggerRef={triggerRef} onClose={onClose}>
        <textarea aria-label="Dispatch instruction" autoFocus />
      </PrepareWorkPopover>
    </>,
  );
  expect(screen.getByRole("textbox", { name: "Dispatch instruction" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Previous" })).toHaveFocus();
});
