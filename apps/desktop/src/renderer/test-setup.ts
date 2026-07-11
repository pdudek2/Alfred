import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const originalConsoleError = console.error;
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let consoleErrors: string[];

beforeEach(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  consoleErrors = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
    originalConsoleError(...args);
  };
});

afterEach(() => {
  try {
    cleanup();
    const forbidden = consoleErrors.filter((message) =>
      /not wrapped in act|not configured to support act|unique ["']key["']|same key|duplicate key/i.test(message),
    );
    if (forbidden.length > 0) {
      throw new Error(`Forbidden React test warning:\n${forbidden.join("\n")}`);
    }
  } finally {
    console.error = originalConsoleError;
    vi.unstubAllGlobals();
  }
});
