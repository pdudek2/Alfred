import type { OrchestratorViewModel } from "../view-models/orchestrator-view-model";
import { tileKindMeta } from "../tile-kind";

type MissionGraphProps = {
  viewModel: OrchestratorViewModel;
};

export function MissionGraph({ viewModel }: MissionGraphProps) {
  return (
    <section className="mission-graph" aria-label="Mission graph">
      <header className="mission-graph-header">
        <div>
          <strong>Mission: {viewModel.missionTitle}</strong>
          <span>{viewModel.missionDetail}</span>
        </div>
        <div className="mission-graph-counts" aria-label="Mission graph counts">
          <span>{viewModel.counts.live} live</span>
          <span>{viewModel.counts.staged} staged</span>
          <span>{viewModel.counts.terminals} total</span>
        </div>
      </header>
      <ol className="mission-graph-nodes" aria-label={`${viewModel.graphNodes.length} mission graph nodes`}>
        {viewModel.graphNodes.map((node) => {
          const kind = tileKindMeta(node.kind);

          return (
            <li
              className={`mission-graph-node kind-${kind.className} tone-${node.tone}`}
              key={node.id}
              aria-label={`${node.title}, ${kind.label}, ${node.tone}, ${node.detail}`}
            >
              <span className="mission-graph-node-mark" aria-hidden="true">
                {kind.shortLabel}
              </span>
              <span className="mission-graph-node-copy">
                <strong>{node.title}</strong>
                <span>{node.detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
