import type { TerminalFileChange } from "../../shared/terminal-ipc";
import { agentPages, fileName } from "../page-panel-state";

/** The HTML and SVG pages an agent changed, the one edited last first; a click opens one beside the terminal. */
export function DetailsPages({ files, onOpenPage }: { files: TerminalFileChange[] | undefined; onOpenPage: (path: string) => void }) {
  const pages = agentPages(files).reverse();
  if (pages.length === 0) return null;
  return (
    <section className="details-section" aria-label="Pages">
      <header className="details-section-heading"><h2>Pages</h2></header>
      <ul className="agent-activity-list">
        {pages.map((page) => (
          <li key={page.path}>
            <button className="details-activity-text" type="button" title={page.path} onClick={() => onOpenPage(page.path)}>
              <span className="details-activity-sentence">{fileName(page.path)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
