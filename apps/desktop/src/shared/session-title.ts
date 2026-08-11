export const MAX_SESSION_TITLE_LENGTH = 80;

const OSC_SEQUENCE = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ESCAPE_SEQUENCE = /\u001b(?:[ -/]*[@-~]|[78])?/g;
const TITLE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INCOMPLETE_OSC_SEQUENCE = /\u001b\](?:(?!\u0007|\u001b\\)[\s\S])*$/;
const INCOMPLETE_CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*$/;
const INCOMPLETE_ESCAPE_SEQUENCE = /\u001b[ -/]*$/;

export type TerminalControlStripResult = {
  text: string;
  remainder: string;
};

export function stripTerminalControlSequences(value: string): string {
  return stripTerminalControlSequencesWithRemainder(value).text;
}

export function stripTerminalControlSequencesWithRemainder(value: string): TerminalControlStripResult {
  const remainder = value.match(INCOMPLETE_OSC_SEQUENCE)?.[0]
    ?? value.match(INCOMPLETE_CSI_SEQUENCE)?.[0]
    ?? value.match(INCOMPLETE_ESCAPE_SEQUENCE)?.[0]
    ?? "";
  const text = remainder ? value.slice(0, -remainder.length) : value;
  return { text: text.replace(OSC_SEQUENCE, "").replace(CSI_SEQUENCE, "").replace(ESCAPE_SEQUENCE, ""), remainder };
}

export function normalizeSessionTitle(title: string): string {
  return stripTerminalControlSequences(title).replace(TITLE_CONTROL, "").trim().replace(/\s+/g, " ").slice(0, MAX_SESSION_TITLE_LENGTH);
}
