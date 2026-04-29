import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeyboardShortcut } from "../lib/use-keyboard-shortcut";

function Probe({ binding, onTrigger }: { binding: string; onTrigger: () => void }) {
  useKeyboardShortcut(binding, onTrigger);
  return <div>probe</div>;
}

function DispatchKeyInLayoutEffect({
  eventKey,
  fireOn,
  metaKey = false,
}: {
  eventKey: string;
  fireOn: number;
  metaKey?: boolean;
}) {
  useLayoutEffect(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: eventKey, metaKey, cancelable: true }));
  }, [eventKey, fireOn, metaKey]);

  return null;
}

function DispatchEscapeAndEnterInLayoutEffect({
  fireOn,
  onDispatch,
}: {
  fireOn: number;
  onDispatch: (events: { enter: KeyboardEvent; escape: KeyboardEvent }) => void;
}) {
  useLayoutEffect(() => {
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });

    window.dispatchEvent(escape);
    window.dispatchEvent(enter);
    onDispatch({ enter, escape });
  }, [fireOn, onDispatch]);

  return null;
}

describe("useKeyboardShortcut", () => {
  afterEach(() => cleanup());

  it("calls handler when matching Meta key combination is pressed", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="mod+o" onTrigger={onTrigger} />);

    await user.keyboard("{Meta>}o{/Meta}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("matches Ctrl as well as Meta for mod", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="mod+o" onTrigger={onTrigger} />);

    await user.keyboard("{Control>}o{/Control}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated keys", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="escape" onTrigger={onTrigger} />);

    await user.keyboard("a");

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("triggers Escape", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="escape" onTrigger={onTrigger} />);

    await user.keyboard("{Escape}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("triggers Enter", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="enter" onTrigger={onTrigger} />);

    await user.keyboard("{Enter}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("triggers named navigation keys", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="arrowleft" onTrigger={onTrigger} />);

    await user.keyboard("{ArrowLeft}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("triggers Tab by named binding", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<Probe binding="tab" onTrigger={onTrigger} />);

    await user.keyboard("{Tab}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    const { unmount } = render(<Probe binding="escape" onTrigger={onTrigger} />);

    unmount();
    await user.keyboard("{Escape}");

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("triggers Escape from inside an input", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(
      <>
        <Probe binding="escape" onTrigger={onTrigger} />
        <input data-testid="probe-input" />
      </>,
    );

    const input = document.querySelector("[data-testid='probe-input']") as HTMLInputElement;
    input.focus();
    await user.keyboard("{Escape}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("prevents default only when the shortcut matches", () => {
    const onTrigger = vi.fn();
    render(<Probe binding="mod+o" onTrigger={onTrigger} />);

    const unrelated = new KeyboardEvent("keydown", { key: "x", cancelable: true });
    const matching = new KeyboardEvent("keydown", { key: "o", metaKey: true, cancelable: true });

    window.dispatchEvent(unrelated);
    window.dispatchEvent(matching);

    expect(unrelated.defaultPrevented).toBe(false);
    expect(matching.defaultPrevented).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handler immediately after rerender", () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const { rerender } = render(<Probe binding="mod+o" onTrigger={firstHandler} />);

    rerender(
      <>
        <Probe binding="mod+o" onTrigger={secondHandler} />
        <DispatchKeyInLayoutEffect eventKey="o" fireOn={1} metaKey />
      </>,
    );

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it("replaces the active binding when binding changes", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    const { rerender } = render(<Probe binding="escape" onTrigger={onTrigger} />);

    rerender(<Probe binding="enter" onTrigger={onTrigger} />);
    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("uses the latest binding immediately after rerender", () => {
    const onTrigger = vi.fn();
    const events: Partial<{ enter: KeyboardEvent; escape: KeyboardEvent }> = {};
    const { rerender } = render(<Probe binding="escape" onTrigger={onTrigger} />);

    rerender(
      <>
        <Probe binding="enter" onTrigger={onTrigger} />
        <DispatchEscapeAndEnterInLayoutEffect
          fireOn={1}
          onDispatch={(dispatchedEvents) => Object.assign(events, dispatchedEvents)}
        />
      </>,
    );

    expect(events.escape?.defaultPrevented).toBe(false);
    expect(events.enter?.defaultPrevented).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
