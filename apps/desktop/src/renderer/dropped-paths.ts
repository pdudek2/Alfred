// The characters a POSIX shell (zsh included) would read as syntax, escaped the way Ghostty and Terminal.app do on drop.
const SHELL_SPECIAL = /[\\ '"`!#$&;|*?()[\]{}<>~=^]/g;
// A newline or other control byte in a file name would run the line in a shell without bracketed paste.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;
// Inside double quotes cmd still expands % and !, and PowerShell expands $ and `.
const WINDOWS_LIVE_IN_QUOTES = /["%!$`]/;

/**
 * The text a file drop types at the prompt: each path escaped, separated by spaces, with a trailing
 * space so you can keep typing. Paths without a filesystem location (""), or that cannot be typed
 * safely, are skipped.
 */
export function droppedPathsText(paths: readonly string[]): string {
  const words = paths.flatMap((path) => {
    if (!path || CONTROL.test(path)) return [];
    // ponytail: Windows quoting is unverified (contract §9); double quotes suit cmd and PowerShell for other paths.
    if (/^(?:[A-Za-z]:\\|\\\\)/.test(path)) return WINDOWS_LIVE_IN_QUOTES.test(path) ? [] : [`"${path}"`];
    return [path.replace(SHELL_SPECIAL, "\\$&")];
  });
  return words.length === 0 ? "" : `${words.join(" ")} `;
}
