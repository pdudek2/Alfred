import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NewSessionSheet, type NewSessionSheetProps } from "./NewSessionSheet";

afterEach(cleanup);
const project = { id: "alpha", label: "Alpha", rootPath: "/alpha" };
function setup(overrides: Partial<NewSessionSheetProps> = {}) {
  const props: NewSessionSheetProps = { projects: [project, { id: "missing", label: "Missing", rootStatus: "missing" }], projectId: project.id, kind: "codex", draft: "", onProjectChange: vi.fn(), onKindChange: vi.fn(), onDraftChange: vi.fn(), onStart: vi.fn().mockResolvedValue(true), onClose: vi.fn(), ...overrides };
  return { ...render(<NewSessionSheet {...props} />), props };
}
it("autofocuses the prompt and restores the opener on Escape", async () => {
  const opener = document.createElement("button"); document.body.append(opener); opener.focus();
  const { props } = setup();
  expect(screen.getByLabelText("First prompt")).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(opener).toHaveFocus(); opener.remove();
});
it("dismisses through the backdrop and suspends dismissal for another panel", () => {
  const { props, rerender } = setup({ disabled: true });
  fireEvent.pointerDown(screen.getByTestId("new-session-backdrop"));
  expect(props.onClose).not.toHaveBeenCalled();
  rerender(<NewSessionSheet {...props} disabled={false} />);
  fireEvent.pointerDown(screen.getByTestId("new-session-backdrop"));
  expect(props.onClose).toHaveBeenCalledOnce();
});
it("requires a goal, displays a blocking reason, and keeps blocked drafts editable", () => {
  const { props, rerender } = setup({ kind: "plan" });
  expect(screen.getByLabelText("Goal")).toBeRequired();
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  rerender(<NewSessionSheet {...props} draft="Test" blockedReason="Resolve the current Alfred plan" />);
  expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
  expect(screen.getByLabelText("Goal")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
});
it("submits with command Enter but allows a plain newline", async () => {
  const { props } = setup({ draft: "Fix tests" });
  fireEvent.keyDown(screen.getByLabelText("First prompt"), { key: "Enter" });
  expect(props.onStart).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("First prompt"), { key: "Enter", metaKey: true });
  await waitFor(() => expect(props.onStart).toHaveBeenCalledWith(false));
  expect(props.onClose).toHaveBeenCalledOnce();
});
it("hides prompt and isolation for Terminal and submits Enter elsewhere", async () => {
  const { props } = setup({ kind: "terminal" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("radio", { name: /Terminal/ }), { key: "Enter" });
  await waitFor(() => expect(props.onStart).toHaveBeenCalledWith(false));
});
it("disables missing projects and sends isolation through Start", async () => {
  const { props } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Choose project" }));
  expect(screen.getByRole("menuitemradio", { name: "Missing" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(props.onClose).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenCalledWith(true);
});
it("keeps the sheet open while thinking and after a failed request", async () => {
  let finish!: (result: boolean) => void;
  const { props } = setup({ kind: "plan", draft: "Goal", onStart: vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })) });
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  finish(false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
  expect(props.onClose).not.toHaveBeenCalled();
});

it("cycles native radios with arrows and traps Tab inside the dialog", async () => {
  const { props } = setup();
  const codex = screen.getByRole("radio", { name: /^Codex/ });
  codex.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(props.onKindChange).toHaveBeenCalledWith("claude");
  screen.getByRole("button", { name: "Start" }).focus();
  expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Choose project" })).toHaveFocus();
  await userEvent.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
});

it("blocks a missing target and hides isolation without a root", () => {
  const { props, rerender } = setup({ projectId: "unknown" });
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  rerender(<NewSessionSheet {...props} projects={[{ id: "alpha", label: "Scratch" }]} projectId="alpha" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
});

it("shows errors and retains the draft for retry", async () => {
  const { props, rerender } = setup({ kind: "plan", draft: "Try this", requestError: "Network unavailable" });
  expect(screen.getByRole("status")).toHaveTextContent("Network unavailable");
  expect(screen.getByLabelText("Goal")).toHaveValue("Try this");
  rerender(<NewSessionSheet {...props} onStart={() => Promise.reject(new Error("Launch failed"))} />);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByText("Launch failed")).toBeInTheDocument();
  expect(props.onClose).not.toHaveBeenCalled();
});

it("does not dismiss a newer sheet when an abandoned request finishes", async () => {
  let finish!: (result: boolean) => void;
  const { props, unmount } = setup({ kind: "plan", draft: "Goal", onStart: () => new Promise<boolean>((resolve) => { finish = resolve; }) });
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  unmount();
  await act(async () => finish(true));
  expect(props.onClose).not.toHaveBeenCalled();
});

it("submits command Enter even when Cancel has focus", async () => {
  const { props } = setup();
  screen.getByRole("button", { name: "Cancel" }).focus();
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  expect(props.onStart).toHaveBeenCalledOnce();
});
