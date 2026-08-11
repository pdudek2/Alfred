export const MAX_SESSION_TITLE_LENGTH = 80;

const ESCAPE = String.fromCharCode(0x1B);
const BEL = String.fromCharCode(0x07);
const OSC_SEQUENCE = new RegExp(`${ESCAPE}\\][\\s\\S]*?(?:${BEL}|${ESCAPE}\\\\)`, "g");
const CSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const ESCAPE_SEQUENCE = new RegExp(`${ESCAPE}(?:[ -/]*[@-~]|[78])?`, "g");
const INCOMPLETE_OSC_SEQUENCE = new RegExp(`${ESCAPE}\\](?:(?!${BEL}|${ESCAPE}\\\\)[\\s\\S])*$`);
const INCOMPLETE_CSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*$`);
const INCOMPLETE_ESCAPE_SEQUENCE = new RegExp(`${ESCAPE}[ -/]*$`);

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

export function stripTitleControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x08 || (code >= 0x0B && code <= 0x0C) || (code >= 0x0E && code <= 0x1F) || (code >= 0x7F && code <= 0x9F)
      ? ""
      : character;
  }).join("");
}

export function normalizeSessionTitle(title: string): string {
  return stripTitleControlCharacters(stripTerminalControlSequences(title)).trim().replace(/\s+/g, " ").slice(0, MAX_SESSION_TITLE_LENGTH);
}
