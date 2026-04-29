import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Sigil } from "../components/sigil";

describe("Sigil", () => {
  afterEach(() => cleanup());

  it("renders the Alfred monogram with accessible label", () => {
    render(<Sigil />);

    expect(screen.getByRole("img", { name: /alfred monogram/i })).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("uses the prefixed sigil class for styling", () => {
    render(<Sigil />);

    expect(screen.getByRole("img", { name: /alfred monogram/i })).toHaveClass("alfred-sigil");
  });
});
