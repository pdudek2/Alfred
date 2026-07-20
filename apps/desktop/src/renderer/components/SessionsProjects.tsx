import { ChevronLeft, Folder, Layers3, MessageCircle } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { SessionsProjectInput } from "../../shared/sessions-ipc";

type SessionsProjectsProps = {
  counts: Record<string, number>;
  projectsRef: RefObject<HTMLDivElement | null>;
  selectedProjectId: string;
  workspaces: SessionsProjectInput[];
  onBackToWork: () => void;
  onScrollTopChange: (scrollTop: number) => void;
  onSelectProject: (projectId: string) => void;
};

export function SessionsProjects({
  counts,
  projectsRef,
  selectedProjectId,
  workspaces,
  onBackToWork,
  onScrollTopChange,
  onSelectProject,
}: SessionsProjectsProps) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <nav className="sessions-projects" aria-label="Projects">
      <header className="sessions-projects__header">
        <button type="button" aria-label="Back to Work" onClick={onBackToWork}>
          <ChevronLeft aria-hidden="true" size={15} />
        </button>
        <strong>Projects</strong>
      </header>
      <div
        ref={projectsRef}
        className="sessions-projects__list"
        onScroll={(event) => onScrollTopChange(event.currentTarget.scrollTop)}
      >
        <ProjectButton
          active={selectedProjectId === "all"}
          count={total}
          icon={<Layers3 aria-hidden="true" size={15} />}
          label="All projects"
          onClick={() => onSelectProject("all")}
        />
        {workspaces.filter((workspace) => (
          !isFreeChatsWorkspace(workspace)
          && ((counts[workspace.id] ?? 0) > 0 || selectedProjectId === workspace.id)
        )).map((workspace) => (
          <ProjectButton
            active={selectedProjectId === workspace.id}
            count={counts[workspace.id] ?? 0}
            icon={<Folder aria-hidden="true" size={15} />}
            key={workspace.id}
            label={workspace.label}
            onClick={() => onSelectProject(workspace.id)}
          />
        ))}
        <div className="sessions-projects__divider" />
        <ProjectButton
          active={selectedProjectId === "free-chats"}
          count={counts["free-chats"] ?? 0}
          icon={<MessageCircle aria-hidden="true" size={15} />}
          label="Free Chats"
          onClick={() => onSelectProject("free-chats")}
        />
      </div>
    </nav>
  );
}

function isFreeChatsWorkspace(workspace: SessionsProjectInput): boolean {
  return workspace.rootPath?.replaceAll("\\", "/").includes("/Documents/Codex") ?? false;
}

function ProjectButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={active ? "sessions-project active" : "sessions-project"}
      onClick={onClick}
      title={label}
    >
      <span className="sessions-project__icon">{icon}</span>
      <span className="sessions-project__label">{label}</span>
      <span className="sessions-project__count">{count}</span>
    </button>
  );
}
