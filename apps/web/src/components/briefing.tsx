import type { BriefingVM } from "../lib/briefing";

type BriefingProps = {
  vm: BriefingVM;
  onHighlight: (runId: string) => void;
};

export function Briefing({ vm, onHighlight }: BriefingProps) {
  return (
    <p className={`reader-briefing reader-briefing--${vm.voice}`} aria-live="polite">
      {vm.pieces.map((piece, index) => {
        if (piece.kind === "text") {
          return <span key={`text-${index}`}>{piece.value}</span>;
        }

        return (
          <button
            key={`highlight-${index}`}
            className="reader-briefing__highlight"
            type="button"
            onClick={() => onHighlight(piece.runId)}
          >
            {piece.value}
          </button>
        );
      })}
    </p>
  );
}
