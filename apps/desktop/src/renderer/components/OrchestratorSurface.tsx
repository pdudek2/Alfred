import type { ReactNode } from "react";
import { MissionGraph } from "./MissionGraph";
import type { OrchestratorViewModel } from "../view-models/orchestrator-view-model";

type OrchestratorSurfaceProps = {
  children: ReactNode;
  viewModel: OrchestratorViewModel;
};

export function OrchestratorSurface({ children, viewModel }: OrchestratorSurfaceProps) {
  return (
    <div className="orchestrator-surface">
      <MissionGraph viewModel={viewModel} />
      {children}
    </div>
  );
}
