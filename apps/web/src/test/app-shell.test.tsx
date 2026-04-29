import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell, type AppShellMode } from "../components/app-shell";
import { runFixture } from "./fixtures";

function Harness({ initialMode = "reader" }: { initialMode?: AppShellMode }) {
  const [mode, setMode] = useState<AppShellMode>(initialMode);

  return (
    <AppShell
      mode={mode}
      now={new Date("2026-04-29T11:00:00.000Z")}
      onModeChange={setMode}
      runs={[runFixture]}
    />
  );
}

describe("AppShell", () => {
  afterEach(() => cleanup());

  it("renders Reader by default", () => {
    render(<Harness />);

    expect(screen.getByRole("region", { name: /run feed/i })).toBeInTheDocument();
  });

  it("switches to Observatory when Cmd+O is pressed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.keyboard("{Meta>}o{/Meta}");

    expect(document.querySelector(".observatory")).not.toBeNull();
  });

  it("uses controlled mode prop", () => {
    render(<Harness initialMode="observatory" />);

    expect(document.querySelector(".observatory")).not.toBeNull();
  });
});
