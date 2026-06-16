import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerBar } from "./composer";

afterEach(() => {
  cleanup();
});

describe("ComposerBar", () => {
  it("blocks submit and keeps the draft editable while a plan is staged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <ComposerBar
        blockedReason="Resolve the current Alfred plan before asking for another."
        thinking={false}
        value="prepare tests"
        workspaceName="Alfred"
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByLabelText("Alfred prompt");
    expect(input).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
    const sendButton = screen.getByRole("button", { name: "Send prompt to Alfred" });
    expect(sendButton).toBeDisabled();

    await user.click(sendButton);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(input);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard(" now");
    expect(onChange).toHaveBeenCalled();
  });

  it("submits with the keyboard when no plan is blocking Alfred", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ComposerBar
        blockedReason={undefined}
        thinking={false}
        value="prepare dev servers"
        workspaceName="Alfred"
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByLabelText("Alfred prompt"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("offers a blocked action when another workspace needs review", async () => {
    const user = userEvent.setup();
    const onBlockedAction = vi.fn();

    render(
      <ComposerBar
        blockedActionLabel="Open ClientApp"
        blockedReason="Review staged items in ClientApp workspace first."
        thinking={false}
        value="prepare dev servers"
        workspaceName="Alfred"
        onBlockedAction={onBlockedAction}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Review staged items in ClientApp workspace first.");
    await user.click(screen.getByRole("button", { name: "Open ClientApp" }));

    expect(onBlockedAction).toHaveBeenCalledOnce();
  });

  it("shows a disabled status without changing form semantics", () => {
    render(
      <ComposerBar
        blockedReason={undefined}
        thinking={false}
        disabled
        value=""
        workspaceName="Alfred"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("form", { name: "Alfred composer" })).toHaveAttribute("data-state", "disabled");
    expect(screen.getByRole("status")).toHaveTextContent("Composer paused.");
    expect(screen.getByLabelText("Alfred prompt")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send prompt to Alfred" })).toBeDisabled();
  });
});
