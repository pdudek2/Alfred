import type { TerminalFileChange } from "../shared/terminal-ipc";
import { PAGE_PATH } from "../shared/workspace-ipc";

/** What the user did with a session's page panel: closed it, or picked a page while another one was edited last. */
export type PagePanelChoice = {
  closed?: boolean;
  picked?: { path: string; lastEdit: string };
};

/** The pages among a session's changed files, in the order of last edit (the one edited last at the end). */
export function agentPages(files: readonly TerminalFileChange[] | undefined): TerminalFileChange[] {
  return (files ?? []).filter((file) => PAGE_PATH.test(file.path));
}

/** An edit changes a file's counts, so path and counts together name one edit. */
export function lastPageEdit(pages: readonly TerminalFileChange[]): string {
  const last = pages.at(-1);
  return last ? `${last.path}\n${last.additions}\n${last.deletions}` : "";
}

/**
 * The page the panel shows, or null when it is shut. It opens with the session's first page and stays shut once
 * closed. It follows the page edited last; a pick holds until the agent edits a page again.
 */
export function pagePanelPage(
  files: readonly TerminalFileChange[] | undefined,
  choice: PagePanelChoice | undefined,
): TerminalFileChange | null {
  const pages = agentPages(files);
  if (pages.length === 0 || choice?.closed) return null;
  const picked = choice?.picked;
  const held = picked?.lastEdit === lastPageEdit(pages) ? pages.find((page) => page.path === picked.path) : undefined;
  return held ?? pages.at(-1)!;
}

export function pickedPage(files: readonly TerminalFileChange[] | undefined, path: string): PagePanelChoice {
  return { picked: { path, lastEdit: lastPageEdit(agentPages(files)) } };
}

export function fileName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}
