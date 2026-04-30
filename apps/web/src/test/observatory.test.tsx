import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Observatory } from "../components/observatory";
import { runFixture } from "./fixtures";

describe("Observatory", () => {
  afterEach(() => cleanup());

  const runs = [
    { ...runFixture, id: "r1", project_name: "alfred-runner", status: "running" },
    { ...runFixture, id: "r2", project_name: "alfred-runner", status: "completed" },
    { ...runFixture, id: "r3", project_name: "alfred-web", status: "waiting" },
  ];

  it("renders one node per run and one ellipse per project", () => {
    render(<Observatory runs={runs} now={new Date("2026-04-29T12:00:00.000Z")} onSelectRun={() => {}} />);

    expect(document.querySelectorAll("[data-node-run-id]").length).toBe(3);
    expect(document.querySelectorAll("[data-cluster-label]").length).toBe(2);
  });

  it("calls onSelectRun when a node is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Observatory runs={runs} now={new Date("2026-04-29T12:00:00.000Z")} onSelectRun={onSelect} />);

    const node = document.querySelector("[data-node-run-id='r1']") as Element;
    await user.click(node);

    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("toggles time scope on pill click", async () => {
    const user = userEvent.setup();
    render(<Observatory runs={runs} now={new Date("2026-04-29T12:00:00.000Z")} onSelectRun={() => {}} />);

    expect(screen.getByRole("button", { name: /^7d$/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /^today$/ }));

    expect(screen.getByRole("button", { name: /^today$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a signal legend for status colors", () => {
    render(<Observatory runs={runs} now={new Date("2026-04-29T12:00:00.000Z")} onSelectRun={() => {}} />);

    const legend = screen.getByLabelText("Signal legend");
    expect(legend).toHaveTextContent("live");
    expect(legend).toHaveTextContent("needs you");
    expect(legend).toHaveTextContent("failed");
    expect(legend).toHaveTextContent("quiet");
  });
});
