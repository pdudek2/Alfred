import type { TerminalFileChange } from "../shared/terminal-ipc";
import { PAGE_PATH } from "../shared/workspace-ipc";

/** An image or PDF a terminal linked to, as it printed the path, with the folder a relative path starts from. */
export type PanelFile = { path: string; cwd: string };

/**
 * What the user did with a session's page panel: closed it, picked a page while another one was edited last, or
 * opened images and PDFs from the terminal (`files`, in the order opened; `file` is the one shown).
 */
export type PagePanelChoice = {
  closed?: boolean;
  picked?: { path: string; lastEdit: string };
  files?: PanelFile[];
  file?: { path: string; lastEdit: string };
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

export function pickedPage(files: readonly TerminalFileChange[] | undefined, path: string, choice?: PagePanelChoice): PagePanelChoice {
  return { ...(choice?.files ? { files: choice.files } : {}), picked: { path, lastEdit: lastPageEdit(agentPages(files)) } };
}

/** The image or PDF the panel shows instead of a page; the agent's next page edit takes the panel back. */
export function pagePanelFile(files: readonly TerminalFileChange[] | undefined, choice: PagePanelChoice | undefined): PanelFile | null {
  if (!choice?.file || choice.closed || choice.file.lastEdit !== lastPageEdit(agentPages(files))) return null;
  const shown = choice.file.path;
  return choice.files?.find((file) => file.path === shown) ?? null;
}

export function openedFile(files: readonly TerminalFileChange[] | undefined, choice: PagePanelChoice | undefined, file: PanelFile): PagePanelChoice {
  const opened = (choice?.closed ? [] : choice?.files ?? []).filter((item) => item.path !== file.path);
  return { files: [...opened, file], file: { path: file.path, lastEdit: lastPageEdit(agentPages(files)) } };
}

export function fileName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}
