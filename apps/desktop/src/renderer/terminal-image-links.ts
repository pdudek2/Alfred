import { ATTACHABLE_IMAGE_PATH } from "../shared/workspace-ipc";

/** The image file an OSC 8 link points at, or null for any other link. */
export function imagePathFromLink(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || (url.host !== "" && url.host !== "localhost")) return null;
    const path = decodeURIComponent(url.pathname);
    return ATTACHABLE_IMAGE_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

export type LineImagePath = { start: number; end: number; path: string };

// Runs of non-space characters, where "\ " (an escaped space, as a file drop pastes it) also counts.
const PATH_TOKEN = /(?:\\ |\S)+/g;
const LEADING_WRAP = /^["'`(<[]+/;
const TRAILING_WRAP = /["'`)>\],.:;!?]+$/;

/**
 * Image paths written out in one line of terminal text: absolute, ~/…, or relative with a folder,
 * as agents print them. `start` and `end` are string offsets of the path, without quotes around it.
 */
export function imagePathsInLine(line: string): LineImagePath[] {
  return [...line.matchAll(PATH_TOKEN)].flatMap((match) => {
    const lead = LEADING_WRAP.exec(match[0])?.[0].length ?? 0;
    const trail = TRAILING_WRAP.exec(match[0].slice(lead))?.[0].length ?? 0;
    const token = match[0].slice(lead, match[0].length - trail);
    const start = match.index + lead;
    const path = token.includes("://") ? imagePathFromLink(token) : token.replace(/\\(.)/g, "$1");
    if (!path || !path.includes("/") || !ATTACHABLE_IMAGE_PATH.test(path)) return [];
    return [{ start, end: start + token.length, path }];
  });
}

export type LinePlaceholder = { start: number; end: number; placeholder: string };

const PLACEHOLDER = /\[Image #\d+\]/g;
const CODEX_MESSAGE_START = "› ";

/** "[Image #N]" placeholders in one line of terminal text, as Codex shows an image. */
export function imagePlaceholdersInLine(line: string): LinePlaceholder[] {
  return [...line.matchAll(PLACEHOLDER)].map((match) => ({ start: match.index, end: match.index + match[0].length, placeholder: match[0] }));
}

/**
 * The text of the sent Codex message that buffer row `y` belongs to, or null. Codex 0.163 draws a sent message
 * with "› " on its first row and a two-space indent on the rows after it. The last message drawn that way is
 * its composer, which holds what you have not sent yet.
 */
export function codexSentMessageAt(row: (y: number) => string, y: number, rowCount: number): string | null {
  const continues = (text: string) => text.startsWith("  ") && text.trim() !== "";
  let start = y;
  while (!row(start).startsWith(CODEX_MESSAGE_START)) {
    if (start === 0 || !continues(row(start))) return null;
    start -= 1;
  }
  let end = start + 1;
  while (end < rowCount && continues(row(end))) end += 1;
  let next = end;
  while (next < rowCount && !row(next).startsWith(CODEX_MESSAGE_START)) next += 1;
  if (next === rowCount) return null;
  return Array.from({ length: end - start }, (_, offset) => row(start + offset)).join("\n").slice(CODEX_MESSAGE_START.length);
}
