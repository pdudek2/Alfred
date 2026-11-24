import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Code, ExternalLink, FileText, Image as ImageIcon, RotateCw, X } from "lucide-react";
import type { TerminalFileChange } from "../../shared/terminal-ipc";
import { getDesktopWorkspaceApi } from "../desktop-api";
import { fileName, type PanelFile } from "../page-panel-state";
import { PDF_PATH } from "../../shared/workspace-ipc";
import { FileView } from "./FileView";
import "./page-panel.css";

// Libraries come from a CDN over https; nothing over http, from localhost, from Alfred or from files next to the page.
export const PAGE_CSP = [
  "default-src 'none'",
  "script-src https: data: blob: 'unsafe-inline' 'unsafe-eval'",
  "style-src https: data: 'unsafe-inline'",
  "img-src https: data: blob:",
  "font-src https: data:",
  "connect-src https:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

const SVG_PAGE = "<!doctype html><style>html,body{margin:0;height:100%}body{display:grid;place-items:center}svg{max-width:100%;max-height:100%}</style>";

type PageContent = { path: string; text: string; modifiedAt: number } | { path: string; text: null };

export type PagePanelProps = {
  agentLabel: string;
  folder: string;
  now: number;
  /** The page shown, unless an image or PDF is (`file`). */
  page: TerminalFileChange | null;
  pages: TerminalFileChange[];
  file: PanelFile | null;
  files: PanelFile[];
  onClose: () => void;
  onFocusTerminal: () => void;
  onPick: (path: string) => void;
  onPickFile: (file: PanelFile) => void;
  onPastePath: (path: string) => void;
};

/**
 * A page the session's agent wrote, live beside its terminal (board A); its scripts run in a sandboxed frame. Images
 * and PDFs a terminal linked to open here too.
 */
export function PagePanel({ agentLabel, file, files, folder, now, page, pages, onClose, onFocusTerminal, onPick, onPickFile, onPastePath }: PagePanelProps) {
  const [content, setContent] = useState<PageContent | null>(null);

  // An edit changes the counts, so the page is read again; the old text stays until the new one arrives.
  const pagePath = page?.path;
  const version = page ? `${page.additions}\n${page.deletions}` : "";
  useEffect(() => {
    if (!pagePath) return;
    let current = true;
    void getDesktopWorkspaceApi()?.readAgentPage({ path: pagePath, cwd: folder })
      .catch(() => ({ ok: false as const }))
      .then((result) => {
        if (current) setContent(result.ok ? { path: pagePath, text: result.text, modifiedAt: result.modifiedAt } : { path: pagePath, text: null });
      });
    return () => {
      current = false;
    };
  }, [folder, pagePath, version]);

  const shown = !file && content?.path === pagePath ? content : null;
  const tabs = [...pages].sort((a, b) => fileName(a.path).localeCompare(fileName(b.path)));
  const shownPath = file?.path ?? page?.path ?? "";
  const shownCwd = file?.cwd ?? folder;

  return (
    <section className="page-panel" aria-label={`${file ? "File" : "Page"} ${fileName(shownPath)}`}>
      <header className="page-panel-top">
        <div className="page-panel-tabs" role="tablist" aria-label="Pages and files">
          {tabs.map((tab) => (
            <button
              key={tab.path}
              type="button"
              role="tab"
              aria-selected={!file && tab.path === page?.path}
              className="page-panel-tab"
              title={tab.path}
              onClick={() => onPick(tab.path)}
            >
              <Code aria-hidden="true" size={13} />
              {fileName(tab.path)}
            </button>
          ))}
          {files.map((tab) => (
            <button
              key={`${tab.cwd}\n${tab.path}`}
              type="button"
              role="tab"
              aria-selected={tab.path === file?.path}
              className="page-panel-tab"
              title={tab.path}
              onClick={() => onPickFile(tab)}
            >
              {PDF_PATH.test(tab.path) ? <FileText aria-hidden="true" size={13} /> : <ImageIcon aria-hidden="true" size={13} />}
              {fileName(tab.path)}
            </button>
          ))}
        </div>
        {shown?.text != null && <span className="page-panel-age">{updatedLabel(shown.modifiedAt, now)}</span>}
        {file && (
          <button
            type="button"
            className="page-panel-icon"
            aria-label="Paste path into the terminal"
            title="Paste path into the terminal"
            onClick={() => onPastePath(file.path)}
          >
            <ClipboardPaste aria-hidden="true" size={13} />
          </button>
        )}
        <button
          type="button"
          className="page-panel-icon"
          aria-label={file ? "Open in Quick Look" : "Open in browser"}
          title={file ? "Open in Quick Look" : "Open in browser"}
          onClick={() => void getDesktopWorkspaceApi()?.quickLookImage({ path: shownPath, cwd: shownCwd })}
        >
          <ExternalLink aria-hidden="true" size={13} />
        </button>
        <button type="button" className="page-panel-icon" aria-label="Close page" title="Close page" onClick={onClose}>
          <X aria-hidden="true" size={13} />
        </button>
      </header>
      {file
        ? <div className="page-panel-body"><FileView file={file} /></div>
        : page && <PageBody agentLabel={agentLabel} folder={folder} page={page} shown={shown} onFocusTerminal={onFocusTerminal} />}
    </section>
  );
}

function PageBody({ agentLabel, folder, page, shown, onFocusTerminal }: {
  agentLabel: string;
  folder: string;
  page: TerminalFileChange;
  shown: PageContent | null;
  onFocusTerminal: () => void;
}) {
  const name = fileName(page.path);
  const relativePath = page.path.startsWith(`${folder}/`) ? page.path.slice(folder.length + 1) : page.path;

  return (
    <>
      <div className="page-panel-body">
        {/* A frame first shown with an empty srcdoc and then filled stays blank on screen, so it waits for the page. */}
        {shown?.text != null && (
          <PageFrame
            name={name}
            srcDoc={/\.svg$/i.test(page.path) ? SVG_PAGE + shown.text : shown.text}
            onFocusTerminal={onFocusTerminal}
          />
        )}
        {shown?.text === null && (
          <p className="page-panel-missing" role="status"><strong>{name}</strong> This page is no longer there</p>
        )}
      </div>
      <footer className="page-panel-foot">
        <RotateCw aria-hidden="true" size={12} />
        <span>Redraws when {agentLabel} edits it</span>
        <span className="page-panel-path" title={page.path}>{relativePath}</span>
      </footer>
    </>
  );
}

function PageFrame({ name, srcDoc, onFocusTerminal }: { name: string; srcDoc: string; onFocusTerminal: () => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // A page may focus itself on every load. Unless the user pointed at it or tabbed into it, the terminal keeps the keys.
  const focusTerminal = useRef(onFocusTerminal);
  focusTerminal.current = onFocusTerminal;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let pointerOver = false;
    let tabbing = false;
    let lastFocused: Element | null = null;
    const enter = () => { pointerOver = true; };
    const leave = () => { pointerOver = false; };
    const keyDown = (event: KeyboardEvent) => { tabbing = event.key === "Tab"; };
    const keyUp = () => { tabbing = false; };
    // Focus reaches the frame after the element that had it lets go (focusout), or as the window blurs; either may come.
    const taken = (event: Event) => {
      if (event.type === "focusout" && event.target !== frame) lastFocused = event.target as Element;
      setTimeout(() => {
        const intended = pointerOver || tabbing;
        tabbing = false;
        if (document.activeElement !== frame || intended) return;
        // The keyboard goes back where the user was typing: a field, a dialog, or else the terminal.
        if (lastFocused instanceof HTMLElement && lastFocused.isConnected) lastFocused.focus();
        else focusTerminal.current();
      });
    };
    frame.addEventListener("pointerenter", enter);
    frame.addEventListener("pointerleave", leave);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("blur", taken);
    document.addEventListener("focusout", taken, true);
    return () => {
      frame.removeEventListener("pointerenter", enter);
      frame.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("blur", taken);
      document.removeEventListener("focusout", taken, true);
    };
  }, []);

  return (
    <iframe
      ref={frameRef}
      className="page-panel-frame"
      title={name}
      sandbox="allow-scripts"
      // Chromium's embedded CSP: the page runs under it whatever it declares. React's types do not list it.
      {...{ csp: PAGE_CSP }}
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  );
}

function updatedLabel(modifiedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - modifiedAt) / 1000));
  if (seconds < 60) return `updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `updated ${hours}h ago` : `updated ${Math.floor(hours / 24)}d ago`;
}
