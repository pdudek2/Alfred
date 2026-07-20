import type { PrimarySurface } from "./WorkbenchHeader";

type SurfaceSwitcherProps = {
  activeSurface: Extract<PrimarySurface, "inbox" | "sessions">;
  onSelectSurface: (surface: PrimarySurface) => void;
};

const SURFACES: Array<{ id: PrimarySurface; label: string }> = [
  { id: "work", label: "Work" },
  { id: "inbox", label: "Inbox" },
  { id: "sessions", label: "Sessions" },
];

export function SurfaceSwitcher({ activeSurface, onSelectSurface }: SurfaceSwitcherProps) {
  return (
    <nav className="surface-switcher" aria-label="Primary surfaces">
      {SURFACES.map((surface) => (
        <button
          type="button"
          aria-current={activeSurface === surface.id ? "page" : undefined}
          key={surface.id}
          onClick={() => onSelectSurface(surface.id)}
        >
          {surface.label}
        </button>
      ))}
    </nav>
  );
}
