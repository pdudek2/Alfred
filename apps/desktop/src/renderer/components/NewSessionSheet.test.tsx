import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NewSessionSheet, type NewSessionSheetProps } from "./NewSessionSheet";

afterEach(cleanup);
const project = { id: "alpha", label: "Alpha", rootPath: "/alpha", gitBranch: "main" };
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
  await waitFor(() => expect(props.onStart).toHaveBeenCalledOnce());
  expect(props.onClose).toHaveBeenCalledOnce();
});
it("hides the prompt for Terminal and submits Enter elsewhere", async () => {
  const { props } = setup({ kind: "terminal" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("radio", { name: /Terminal/ }), { key: "Enter" });
  await waitFor(() => expect(props.onStart).toHaveBeenCalledOnce());
});
it("disables missing projects and starts through Start", async () => {
  const { props } = setup();
  await userEvent.click(screen.getByRole("button", { name: "Choose project" }));
  expect(screen.getByRole("menuitemradio", { name: "Missing" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(props.onClose).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenCalledOnce();
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

it("blocks a missing target and allows a project without a root", () => {
  const { props, rerender } = setup({ projectId: "unknown" });
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  rerender(<NewSessionSheet {...props} projects={[{ id: "alpha", label: "Scratch" }]} projectId="alpha" />);
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
it("names the parent of a worker and offers only sessions, not a plan", () => {
  const { props, rerender } = setup({ parentTitle: "Redesign History" });
  expect(screen.getByText("Worker of", { exact: false })).toHaveTextContent("Worker of Redesign History");
  expect(screen.queryByRole("radio", { name: /^Plan with Alfred/ })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /^Codex/ })).toBeChecked();
  rerender(<NewSessionSheet {...props} parentTitle={undefined} />);
  expect(screen.queryByText("Worker of", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /^Plan with Alfred/ })).toBeInTheDocument();
});
it("starts an agent in a new worktree when asked, never a terminal", async () => {
  const { props, rerender } = setup({ initialWorktree: true });
  const worktree = screen.getByRole("checkbox", { name: /Work in a new worktree/ });
  expect(worktree).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenLastCalledWith(true);
  await userEvent.click(worktree);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenLastCalledWith(false);

  rerender(<NewSessionSheet {...props} kind="terminal" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("offers no worktree in a folder that is not a git repository", () => {
  setup({ projects: [{ id: "alpha", label: "Alpha", rootPath: "/alpha" }], initialWorktree: true });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
