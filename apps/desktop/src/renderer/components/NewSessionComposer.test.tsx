import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NewSessionComposer, type NewSessionComposerProps } from "./NewSessionComposer";

afterEach(cleanup);
const project = { id: "alpha", label: "Alpha", rootPath: "/alpha", gitBranch: "main" };
function setup(overrides: Partial<NewSessionComposerProps> = {}) {
  const props: NewSessionComposerProps = { expanded: true, projects: [project, { id: "missing", label: "Missing", rootStatus: "missing" }], projectId: project.id, kind: "codex", draft: "", onProjectChange: vi.fn(), onKindChange: vi.fn(), onDraftChange: vi.fn(), onStart: vi.fn().mockResolvedValue(true), onClose: vi.fn(), ...overrides };
  return { ...render(<NewSessionComposer {...props} />), props };
}
it("autofocuses the prompt and restores the opener on Escape", async () => {
  const opener = document.createElement("button"); document.body.append(opener); opener.focus();
  const { props } = setup();
  expect(screen.getByLabelText("First prompt")).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(opener).toHaveFocus(); opener.remove();
});
it("rests as one line that expands on click and leaves Escape in the terminal to the terminal", async () => {
  const onExpand = vi.fn();
  const { props, rerender } = setup({ expanded: false, onExpand });
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "New session" }));
  expect(onExpand).toHaveBeenCalledOnce();
  rerender(<NewSessionComposer {...props} expanded autoFocus={false} />);
  expect(screen.getByLabelText("First prompt")).not.toHaveFocus();
  const terminal = document.createElement("textarea"); document.body.append(terminal); terminal.focus();
  fireEvent.keyDown(terminal, { key: "Escape" });
  expect(props.onClose).not.toHaveBeenCalled();
  terminal.remove();
});
it("leaves focus in the terminal when another panel closes after you left the composer", () => {
  const { props, rerender } = setup();
  const terminal = document.createElement("textarea"); document.body.append(terminal);
  terminal.focus();
  rerender(<NewSessionComposer {...props} disabled />);
  rerender(<NewSessionComposer {...props} disabled={false} />);
  expect(terminal).toHaveFocus();
  terminal.remove();
});
it("ignores Escape and Enter while another panel suspends it", () => {
  const { props } = setup({ disabled: true, draft: "Fix tests" });
  fireEvent.keyDown(screen.getByLabelText("First prompt"), { key: "Escape" });
  fireEvent.keyDown(screen.getByLabelText("First prompt"), { key: "Enter" });
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onStart).not.toHaveBeenCalled();
});
it("requires a goal, displays a blocking reason, and keeps blocked drafts editable", () => {
  const { props, rerender } = setup({ kind: "plan" });
  expect(screen.getByLabelText("Goal")).toBeRequired();
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  rerender(<NewSessionComposer {...props} draft="Test" blockedReason="Resolve the current Alfred plan" />);
  expect(screen.getByRole("status")).toHaveTextContent("Resolve the current Alfred plan");
  expect(screen.getByLabelText("Goal")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
});
it("starts on Enter and keeps Shift Enter for a newline", async () => {
  const { props } = setup({ draft: "Fix tests" });
  fireEvent.keyDown(screen.getByLabelText("First prompt"), { key: "Enter", shiftKey: true });
  expect(props.onStart).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("First prompt"), { key: "Enter" });
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
it("keeps the composer open while thinking and after a failed request", async () => {
  let finish!: (result: boolean) => void;
  const { props } = setup({ kind: "plan", draft: "Goal", onStart: vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })) });
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(screen.getByRole("status")).toHaveTextContent("Thinking");
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  finish(false);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
  expect(props.onClose).not.toHaveBeenCalled();
});

it("cycles native radios with arrows", async () => {
  const { props } = setup();
  screen.getByRole("radio", { name: /^Codex/ }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(props.onKindChange).toHaveBeenCalledWith("claude");
});

it("blocks a missing target and allows a project without a root", () => {
  const { props, rerender } = setup({ projectId: "unknown" });
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  rerender(<NewSessionComposer {...props} projects={[{ id: "alpha", label: "Scratch" }]} projectId="alpha" />);
  expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
});

it("shows errors and retains the draft for retry", async () => {
  const { props, rerender } = setup({ kind: "plan", draft: "Try this", requestError: "Network unavailable" });
  expect(screen.getByRole("status")).toHaveTextContent("Network unavailable");
  expect(screen.getByLabelText("Goal")).toHaveValue("Try this");
  rerender(<NewSessionComposer {...props} onStart={() => Promise.reject(new Error("Launch failed"))} />);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(await screen.findByText("Launch failed")).toBeInTheDocument();
  expect(props.onClose).not.toHaveBeenCalled();
});

it("does not dismiss a newer composer when an abandoned request finishes", async () => {
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
  rerender(<NewSessionComposer {...props} parentTitle={undefined} />);
  expect(screen.queryByText("Worker of", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /^Plan with Alfred/ })).toBeInTheDocument();
});
it("starts an agent in a new worktree when asked, never a terminal", async () => {
  const { props, rerender } = setup({ initialWorktree: true });
  const worktree = screen.getByRole("checkbox", { name: /New worktree/ });
  expect(worktree).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenLastCalledWith(true);
  await userEvent.click(worktree);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenLastCalledWith(false);

  rerender(<NewSessionComposer {...props} kind="terminal" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("leaves a worktree unticked, and says why, while Claude does not trust the folder", async () => {
  const { props, rerender } = setup({ kind: "claude", initialWorktree: true, claudeTrusted: false });
  const worktree = screen.getByRole("checkbox", { name: /New worktree/ });
  expect(worktree).not.toBeChecked();
  expect(screen.getByText(/Claude asks to trust Alpha first/)).toBeVisible();
  // Codex asks for trust itself, so only Claude's worktree waits for it.
  rerender(<NewSessionComposer {...props} kind="codex" />);
  expect(worktree).toBeChecked();
  expect(worktree.closest("label")).toHaveAttribute("title", "Alpha stays untouched until you merge");

  rerender(<NewSessionComposer {...props} />);
  await userEvent.click(worktree);
  await userEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(props.onStart).toHaveBeenLastCalledWith(true);
});
it("offers no worktree in a folder that is not a git repository", () => {
  setup({ projects: [{ id: "alpha", label: "Alpha", rootPath: "/alpha" }], initialWorktree: true });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
