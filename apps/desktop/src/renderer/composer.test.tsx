import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerBar } from "./composer";

afterEach(() => {
  cleanup();
});

describe("ComposerBar", () => {
  const dispatchTarget = { kind: "session" as const, id: "manual-1", label: "Manual · zsh 1" };

  it("keeps send disabled until the dispatch has text and no blocking reason", () => {
    const onSubmit = vi.fn();

    render(
      <ComposerBar
        blockedReason={undefined}
        dispatchTarget={dispatchTarget}
        thinking={false}
        disabled={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("button", { name: "Change planning scope" })).toBeInTheDocument();
    expect(screen.getByText("session")).toBeInTheDocument();
    expect(screen.getByText("Manual · zsh 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare work with Manual · zsh 1" })).toBeDisabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("Dispatch instruction")).toHaveAttribute(
      "placeholder",
      "Prepare work…",
    );
  });

  it("keeps target, input and primary action inside one dispatch capsule", () => {
    render(
      <ComposerBar
        blockedReason={undefined}
        dispatchTarget={dispatchTarget}
        thinking={false}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );

    const capsule = screen.getByTestId("dispatch-bar").querySelector(".dispatch-capsule");
    expect(capsule).not.toBeNull();
    expect(capsule).toContainElement(screen.getByRole("button", { name: "Change planning scope" }));
    expect(capsule).toContainElement(screen.getByLabelText("Dispatch instruction"));
    expect(capsule).toContainElement(screen.getByRole("button", { name: "Prepare work with Manual · zsh 1" }));
    expect(screen.getByTestId("dispatch-bar").querySelector(".alfred-mark")).toBeNull();
  });

  it("blocks submit and keeps the draft editable while a plan is staged", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ComposerBar
        blockedReason="Resolve the current Alfred plan before asking for another."
        dispatchTarget={dispatchTarget}
        thinking={false}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByLabelText("Dispatch instruction");
    expect(input).toBeEnabled();
    await user.type(input, "prepare tests");
    expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
    const sendButton = screen.getByRole("button", { name: "Prepare work with Manual · zsh 1" });
    expect(sendButton).toBeDisabled();

    await user.click(sendButton);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(input);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard(" now");
    expect(input).toHaveValue("prepare tests now");
  });

  it("submits with the keyboard when no plan is blocking Alfred", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockReturnValue(true);

    render(
      <ComposerBar
        blockedReason={undefined}
        dispatchTarget={dispatchTarget}
        thinking={false}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByLabelText("Dispatch instruction"));
    await user.keyboard("prepare dev servers");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onSubmit).toHaveBeenCalledWith("prepare dev servers");
    expect(screen.getByLabelText("Dispatch instruction")).toHaveValue("");
  });

  it("offers a blocked action when another workspace needs review", async () => {
    const user = userEvent.setup();
    const onBlockedAction = vi.fn();

    render(
      <ComposerBar
        blockedActionLabel="Open ClientApp"
        blockedReason="Review staged items in ClientApp workspace first."
        dispatchTarget={dispatchTarget}
        thinking={false}
        onBlockedAction={onBlockedAction}
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
        dispatchTarget={dispatchTarget}
        thinking={false}
        disabled
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("form", { name: "Alfred dispatch" })).toHaveAttribute("data-state", "disabled");
    expect(screen.getByRole("status")).toHaveTextContent("Dispatch paused while another Alfred panel is active.");
    expect(screen.getByLabelText("Dispatch instruction")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Prepare work with Manual · zsh 1" })).toBeDisabled();
  });

  it("does not submit when no dispatch target is selected", async () => {
    const onSubmit = vi.fn();

    render(
      <ComposerBar
        blockedReason={undefined}
        dispatchTarget={null}
        thinking={false}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/choose target/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Dispatch instruction")).toHaveAttribute(
      "placeholder",
      "Choose a planning scope first...",
    );
  });
});
