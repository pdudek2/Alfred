import type { PrimarySurface } from "./WorkbenchHeader";

type SurfaceSwitcherProps = {
  activeSurface: Extract<PrimarySurface, "inbox" | "history">;
  onSelectSurface: (surface: PrimarySurface) => void;
};

const SURFACES: Array<{ id: PrimarySurface; label: string }> = [
  { id: "work", label: "Work" },
  { id: "inbox", label: "Inbox" },
  { id: "history", label: "Observatory" },
];

export function SurfaceSwitcher({ activeSurface, onSelectSurface }: SurfaceSwitcherProps) {
  return (
    <div className="surface-switcher" role="toolbar" aria-label="Primary surfaces">
      {SURFACES.map((surface) => (
        <button
          type="button"
          aria-pressed={activeSurface === surface.id}
          key={surface.id}
          onClick={() => onSelectSurface(surface.id)}
        >
          {surface.label}
        </button>
      ))}
    </div>
  );
}
