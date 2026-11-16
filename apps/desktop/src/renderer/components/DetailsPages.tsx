import { useEffect, useState } from "react";
import type { TerminalFileChange } from "../../shared/terminal-ipc";
import { PAGE_PATH } from "../../shared/workspace-ipc";
import { getDesktopWorkspaceApi } from "../desktop-api";
import "./details-pages.css";

// Each page is drawn in a hidden window for up to 8 s, and a web project can change dozens of them.
const MAX_PAGES = 3;

/** The pages among a session's changed files, the one edited last first. Changed files lists it last. */
export function pagesToShow(files: TerminalFileChange[] | undefined): TerminalFileChange[] {
  return (files ?? []).filter((file) => PAGE_PATH.test(file.path)).reverse().slice(0, MAX_PAGES);
}

/** The HTML and SVG pages an agent changed, drawn as a browser shows them; a click opens one full size. */
export function DetailsPages({ files, folder }: { files: TerminalFileChange[] | undefined; folder: string }) {
  const pages = pagesToShow(files);
  if (pages.length === 0) return null;
  return (
    <section className="details-section" aria-label="Pages">
      <header className="details-section-heading"><h2>Pages</h2></header>
      <ul className="details-pages">
        {pages.map((page) => <li key={page.path}><PageCard page={page} folder={folder} /></li>)}
      </ul>
    </section>
  );
}

function PageCard({ page, folder }: { page: TerminalFileChange; folder: string }) {
  const [picture, setPicture] = useState<{ path: string; dataUrl: string } | null>(null);
  // An edit changes the counts, so the page is drawn again. The last picture stays until the new one comes, and a
  // drawing asked for before the edit never replaces one asked for after it.
  const version = `${page.additions}\n${page.deletions}`;
  useEffect(() => {
    let current = true;
    void getDesktopWorkspaceApi()?.imageThumbnail({ path: page.path, cwd: folder }).then((result) => {
      if (current && result.ok) setPicture({ path: page.path, dataUrl: result.dataUrl });
    });
    return () => {
      current = false;
    };
  }, [folder, page.path, version]);
  const name = page.path.split("/").at(-1);
  return (
    <button
      className="details-page"
      type="button"
      title={page.path}
      onClick={() => void getDesktopWorkspaceApi()?.quickLookImage({ path: page.path, cwd: folder })}
    >
      {picture?.path === page.path && <img src={picture.dataUrl} alt="" />}
      <span>{name}</span>
    </button>
  );
}
