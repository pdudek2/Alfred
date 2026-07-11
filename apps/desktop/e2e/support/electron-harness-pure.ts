const ELECTRON_42_CSP_WARNING = [
  "Electron Security Warning (Insecure Content-Security-Policy)",
  "This renderer process has either no Content Security Policy set or a policy with \"unsafe-eval\" enabled.",
  "This exposes users of this app to unnecessary security risks.",
  "For more information and help, consult https://electronjs.org/docs/tutorial/security.",
  "This warning will not show up once the app is packaged.",
].join(" ");

const PLAYWRIGHT_INSPECTOR_SHUTDOWN =
  /^Debugger ending on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\nFor help, see: https:\/\/nodejs\.org\/en\/docs\/inspector\n?$/;
const MACOS_BACKUPD_XPC_LINE =
  String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} Electron Helper\[\d+:\d+\] XPC error for connection com\.apple\.backupd\.sandbox\.xpc: Connection invalid`;
const MACOS_BACKUPD_XPC_OUTPUT = new RegExp(
  String.raw`^(?:${MACOS_BACKUPD_XPC_LINE})(?:\r?\n${MACOS_BACKUPD_XPC_LINE})*\r?\n?$`,
);

export function isAllowedElectronWarning(text: string): boolean {
  return normalizeElectronConsoleText(text) === ELECTRON_42_CSP_WARNING;
}

export function isAllowedElectronMainOutput(source: string, text: string): boolean {
  return source === "main-stderr" &&
    (PLAYWRIGHT_INSPECTOR_SHUTDOWN.test(text) || MACOS_BACKUPD_XPC_OUTPUT.test(text));
}

export function isPgrepNoChildren(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 1;
}

function normalizeElectronConsoleText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^%cElectron Security Warning \(Insecure Content-Security-Policy\) font-weight: bold; /,
      "Electron Security Warning (Insecure Content-Security-Policy) ",
    );
}
