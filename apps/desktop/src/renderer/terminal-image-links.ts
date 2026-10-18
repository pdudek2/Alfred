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
