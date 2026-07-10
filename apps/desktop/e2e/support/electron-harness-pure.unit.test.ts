import { describe, expect, it } from "vitest";
import {
  isAllowedElectronMainOutput,
  isAllowedElectronWarning,
  isPgrepNoChildren,
} from "./electron-harness-pure";

const canonicalCspWarning = `%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold;
This renderer process has either no Content Security Policy set or a policy with "unsafe-eval" enabled. This exposes users of
this app to unnecessary security risks.

For more information and help, consult
https://electronjs.org/docs/tutorial/security.
This warning will not show up
once the app is packaged.`;

describe("Electron harness pure guards", () => {
  it("allows only the normalized canonical Electron 42 CSP warning", () => {
    expect(isAllowedElectronWarning(canonicalCspWarning)).toBe(true);
    expect(isAllowedElectronWarning(`${canonicalCspWarning} attacker-controlled suffix`)).toBe(false);
    expect(isAllowedElectronWarning("Electron Security Warning (Insecure Content-Security-Policy)")).toBe(false);
  });

  it("treats only pgrep exit code 1 as no descendants", () => {
    expect(isPgrepNoChildren({ code: 1 })).toBe(true);
    expect(isPgrepNoChildren({ code: "ENOENT" })).toBe(false);
    expect(isPgrepNoChildren({ code: 2 })).toBe(false);
    expect(isPgrepNoChildren(new Error("permission denied"))).toBe(false);
  });

  it("allows only Playwright's exact inspector shutdown message from Electron main", () => {
    const inspectorShutdown = `Debugger ending on ws://127.0.0.1:62487/b3c0e65a-f123-47df-9774-6c8a4d671ebd
For help, see: https://nodejs.org/en/docs/inspector
`;
    expect(isAllowedElectronMainOutput("main-stderr", inspectorShutdown)).toBe(true);
    expect(isAllowedElectronMainOutput("main-stdout", inspectorShutdown)).toBe(false);
    expect(isAllowedElectronMainOutput("main-stderr", `${inspectorShutdown}unexpected output`)).toBe(false);
    expect(
      isAllowedElectronMainOutput(
        "main-stderr",
        inspectorShutdown.replace("b3c0e65a-f123-47df-9774-6c8a4d671ebd", "b3c0e65a-f123"),
      ),
    ).toBe(false);
    expect(isAllowedElectronMainOutput("main-stderr", "Debugger ending on ws://attacker.example/abc")).toBe(false);
  });
});
