import {
  ArrowLeft,
  ArrowRight,
  Check,
  Columns3,
  Maximize2,
  Play,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";

type TerminalTile = {
  title: string;
  accelerator: string;
  state: "active" | "needs" | "manual" | "ready" | "idle";
  body: string[];
  footerLeft: string;
  footerRight: string;
};

const terminalTiles: TerminalTile[] = [
  {
    title: "Codex · UI shell",
    accelerator: "⌘1",
    state: "active",
    body: ["Mapped repo", "apps/desktop pending", "waiting for plan gate"],
    footerLeft: "planned",
    footerRight: "worktree",
  },
  {
    title: "Claude · a11y pass",
    accelerator: "!",
    state: "needs",
    body: ["Needs you", "glass density?", "confirm before spec"],
    footerLeft: "needs you",
    footerRight: "open",
  },
  {
    title: "Manual · zsh",
    accelerator: "$",
    state: "manual",
    body: ["/Users/patryk/Desktop/Alfred", "$ codex resume", "$ ghostty ."],
    footerLeft: "manual",
    footerRight: "free control",
  },
  {
    title: "pnpm dev",
    accelerator: "✓",
    state: "ready",
    body: ["ready", "web 4300", "api 4301"],
    footerLeft: "shared",
    footerRight: "main",
  },
  {
    title: "Tests",
    accelerator: "·",
    state: "idle",
    body: ["queued checks", "pnpm test", "typecheck"],
    footerLeft: "idle",
    footerRight: "queue",
  },
  {
    title: "Review",
    accelerator: "·",
    state: "idle",
    body: ["PR notes", "browser smoke", "no trailers"],
    footerLeft: "planned",
    footerRight: "guards",
  },
];

const planSteps = [
  { state: "watch", label: "Map repo boundaries", tag: "done" },
  { state: "ask", label: "Create ui-shell worktree", tag: "review" },
  { state: "ask", label: "Launch browser preview", tag: "review" },
  { state: "run", label: "Keep manual zsh open", tag: "free" },
  { state: "block", label: "Confirm density target", tag: "open" },
];

export function App() {
  return (
    <main className="agent-space-shell">
      <header className="intro-bar">
        <div>
          <p className="eyebrow">Desktop shell foundation</p>
          <h1>Instrument Glass cockpit</h1>
          <p className="intro-copy">
            Static first slice for Alfred Agent Space: glass control layers, matte terminals, a visible
            manual path, and no fake runtime behavior.
          </p>
        </div>
        <div className="rules" aria-label="design constraints">
          <span>glass controls</span>
          <span>matte terminals</span>
          <span>44px targets</span>
          <span>manual first</span>
        </div>
      </header>

      <section className="desktop-frame" aria-label="Alfred Agent Space desktop shell">
        <div className="window-chrome">
          <div className="traffic" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="window-title">Alfred Agent Space · Workspace Alfred</div>
          <div className="window-time">Shell preview</div>
        </div>

        <div className="mission-bar">
          <div className="mission-name">
            <div className="alfred-mark">A</div>
            <div>
              <strong>Prepare UI squad for Agent Space</strong>
              <span>4 sessions staged · browser live · manual shell ready</span>
            </div>
          </div>
          <div className="mission-actions" aria-label="focus modes">
            <button type="button" aria-label="Terminal wall mode">
              <Columns3 size={17} />
            </button>
            <button type="button" aria-label="Preview focus mode">
              <Maximize2 size={17} />
            </button>
            <button className="primary-action" type="button">
              <Check size={16} />
              approve plan
            </button>
          </div>
        </div>

        <div className="workspace-layout">
          <WorkspaceRail />
          <AlfredRail />
          <TerminalGrid />
          <BrowserPane />
        </div>

        <footer className="composer-bar">
          <div className="mode-pill">
            <SquareTerminal size={16} />
            manual
          </div>
          <div className="alfred-voice">
            <b>Alfred:</b> I’ll stage the squad and ask before launch.
          </div>
          <div className="composer-input">Prepare the desktop UI shell, but keep terminals solid.</div>
          <div className="composer-actions">
            <button type="button">edit plan</button>
            <button className="primary-action" type="button">
              <Play size={16} />
              approve launch
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function WorkspaceRail() {
  return (
    <nav className="workspace-rail" aria-label="workspaces">
      <button className="workspace-button active needs-attention" type="button" aria-label="Alfred workspace needs attention">
        A
      </button>
      <button className="workspace-button" type="button" aria-label="UI workspace">
        UI
      </button>
      <button className="workspace-button" type="button" aria-label="API workspace">
        API
      </button>
      <button className="workspace-button" type="button" aria-label="Docs workspace">
        DOC
      </button>
      <div className="workspace-spacer" />
      <button className="workspace-button" type="button" aria-label="Add workspace">
        +
      </button>
    </nav>
  );
}

function AlfredRail() {
  return (
    <aside className="alfred-rail" aria-label="Alfred plan rail">
      <div className="decision-spine" />
      <div className="rail-content">
        <p className="panel-label">Alfred</p>
        <h2>
          Review before <em>launch</em>
        </h2>
        <div className="prompt-card">
          I can prepare the terminals and worktrees, but I will wait before running agents or touching shared services.
        </div>
        <div className="plan-list">
          {planSteps.map((step) => (
            <div className="plan-step" key={step.label}>
              <span className={`status-dot ${step.state}`} />
              <span>{step.label}</span>
              <span className={step.state === "ask" ? "step-tag review" : "step-tag"}>{step.tag}</span>
            </div>
          ))}
        </div>
        <p className="rail-note">Decision spine marks Alfred-owned actions only. Ordinary session state stays quiet.</p>
      </div>
    </aside>
  );
}

function TerminalGrid() {
  return (
    <section className="terminal-grid" aria-label="terminal grid">
      {terminalTiles.map((tile) => (
        <article className={`terminal-tile ${tile.state}`} key={tile.title}>
          <header className="tile-header">
            <div className="tile-title">
              <span className="tool-dot" />
              <b>{tile.title}</b>
            </div>
            <span>{tile.accelerator}</span>
          </header>
          <div className="terminal-body">
            {tile.body.map((line, index) => (
              <p key={line} className={index === 0 ? "strong-line" : undefined}>
                {line}
                {tile.state === "active" && index === tile.body.length - 1 ? <span className="cursor" /> : null}
              </p>
            ))}
          </div>
          <footer className="tile-footer">
            <span>{tile.footerLeft}</span>
            <span>{tile.footerRight}</span>
          </footer>
        </article>
      ))}
    </section>
  );
}

function BrowserPane() {
  return (
    <aside className="browser-pane" aria-label="browser preview">
      <header className="browser-header">
        <div>
          <p className="panel-label">Preview</p>
          <h2>Alfred Web</h2>
        </div>
        <div className="browser-tools" aria-label="browser controls">
          <button type="button" aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <button type="button" aria-label="Forward">
            <ArrowRight size={16} />
          </button>
          <button type="button" aria-label="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <div className="url-bar">
        <span className="live-dot" />
        <span>localhost:4300/?view=reader</span>
      </div>

      <div className="preview-surface">
        <div className="preview-top">
          <div className="preview-brand">
            <div className="alfred-mark small">A</div>
            <b>Alfred</b>
          </div>
          <span>Tuesday 10:33</span>
        </div>
        <div className="preview-content">
          <h3>Loaded runs from last 7 days</h3>
          <PreviewRun state="ask" title="Alfred · waiting on you" meta="Codex · waiting since May 05, 10:47 AM" label="needs you" />
          <PreviewRun state="block" title="patryk · interrupted session" meta="Codex · last activity 11h ago" label="problem" />
          <PreviewRun state="run" title="Alfred · completed reader shell" meta="Codex · browser smoke pending" label="done" />
        </div>
      </div>

      <footer className="review-strip">
        <span>real app state</span>
        <span>screenshot ready</span>
      </footer>
    </aside>
  );
}

function PreviewRun({
  state,
  title,
  meta,
  label,
}: {
  state: "ask" | "block" | "run";
  title: string;
  meta: string;
  label: string;
}) {
  return (
    <div className="preview-run">
      <span className={`status-dot ${state}`} />
      <div>
        <b>{title}</b>
        <span>{meta}</span>
      </div>
      <small>{label}</small>
    </div>
  );
}
