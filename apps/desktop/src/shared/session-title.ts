export const MAX_SESSION_TITLE_LENGTH = 80;

const ESCAPE = String.fromCharCode(0x1B);
const BEL = String.fromCharCode(0x07);
const OSC_SEQUENCE = new RegExp(`${ESCAPE}\\][\\s\\S]*?(?:${BEL}|${ESCAPE}\\\\)`, "g");
const CSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const ESCAPE_SEQUENCE = new RegExp(`${ESCAPE}(?:[ -/]*[@-~]|[78])?`, "g");
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
  const remainder = incompleteOscSequence(value)
    ?? value.match(INCOMPLETE_CSI_SEQUENCE)?.[0]
    ?? value.match(INCOMPLETE_ESCAPE_SEQUENCE)?.[0]
    ?? "";
  const text = remainder ? value.slice(0, -remainder.length) : value;
  return { text: text.replace(OSC_SEQUENCE, "").replace(CSI_SEQUENCE, "").replace(ESCAPE_SEQUENCE, ""), remainder };
}

/**
 * The OSC sequence still open at the end of the text: from the first "ESC ]" after the last terminator. A search
 * rather than a regex, which backtracks quadratically over many sequences opened before one terminator.
 */
function incompleteOscSequence(value: string): string | undefined {
  const bel = value.lastIndexOf(BEL);
  const stringTerminator = value.lastIndexOf(`${ESCAPE}\\`);
  const start = value.indexOf(`${ESCAPE}]`, Math.max(bel < 0 ? 0 : bel + 1, stringTerminator < 0 ? 0 : stringTerminator + 2));
  return start < 0 ? undefined : value.slice(start);
}

/**
 * Saved terminal output as the lines a reader sees, without running a terminal. Control sequences go, a carriage
 * return starts its line over, as a prompt or progress line redrawn in place does, and a backspace takes back the
 * character before it.
 * zsh marks output that lacks a final newline with "%" and pads the row past its width before the next prompt: on a
 * row with text the padding wraps, so the text stays on its own line; on an empty row the mark is overwritten.
 * ponytail: cursor moves and erases inside a line are dropped rather than applied, so a full-screen program reads
 * as the text of its frames; an xterm buffer would apply them.
 */
export function terminalOutputLines(value: string): string[] {
  const text = stripTerminalControlSequences(value)
    .replace(/\r\n/g, "\n")
    .replace(/(^|\n)% +\r \r/g, "$1")
    .replace(/% +\r \r/g, "\n");
  return text.split("\n").map((line) => {
    // A loop rather than /\r+$/, which backtracks quadratically over a long run of carriage returns that does not end the line.
    let end = line.length;
    while (end > 0 && line[end - 1] === "\r") end -= 1;
    const visible = line.slice(0, end);
    const characters: string[] = [];
    for (const character of visible.slice(visible.lastIndexOf("\r") + 1)) {
      if (character === "\b") characters.pop();
      else characters.push(character);
    }
    return characters.join("").trimEnd();
  });
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
