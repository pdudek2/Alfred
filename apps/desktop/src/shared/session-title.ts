export const MAX_SESSION_TITLE_LENGTH = 80;

const OSC_SEQUENCE = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ESCAPE_SEQUENCE = /\u001b(?:[ -/]*[@-~]|[78])?/g;
const TITLE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function stripTerminalControlSequences(value: string): string {
  return value.replace(OSC_SEQUENCE, "").replace(CSI_SEQUENCE, "").replace(ESCAPE_SEQUENCE, "");
}

export function normalizeSessionTitle(title: string): string {
  return stripTerminalControlSequences(title).replace(TITLE_CONTROL, "").trim().replace(/\s+/g, " ").slice(0, MAX_SESSION_TITLE_LENGTH);
}
