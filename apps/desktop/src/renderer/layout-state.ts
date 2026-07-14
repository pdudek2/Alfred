import type { TileLayout } from "../shared/layout-ipc";

export type LayoutPreset = "focus" | "grid" | "two-up";
export type { TileLayout };

export const GRID_COLUMNS = 12;
export const MIN_COL_SPAN = 3;
export const MAX_COL_SPAN = GRID_COLUMNS;
export const MIN_ROW_SPAN = 2;
const DEFAULT_COL_SPAN = 6;
const FULL_WIDTH_ROW_SPAN = 8;
const SPLIT_VIEW_ROW_SPAN = 8;
const TILED_ROW_SPAN = 6;

type LayoutSession = {
  id: string;
};

export function ensureTileLayouts(
  sessions: LayoutSession[],
  existing: Record<string, TileLayout>,
): Record<string, TileLayout> {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const existingIds = Object.keys(existing);
  const matchingExistingCount = existingIds.filter((tileId) => sessionIds.has(tileId)).length;
  const exactSameMembership = existingIds.length === sessions.length && matchingExistingCount === sessions.length;

  if (!exactSameMembership) {
    return defaultLayouts(sessions);
  }

  const next: Record<string, TileLayout> = {};

  sessions.forEach((session, index) => {
    const layout = existing[session.id];
    next[session.id] = layout
      ? normalizeLayout(layout)
      : defaultLayout(session.id, index, sessions.length);
  });

  for (const tileId of Object.keys(next)) {
    if (!sessionIds.has(tileId)) delete next[tileId];
  }

  return next;
}

export function moveTileLayout(
  layouts: Record<string, TileLayout>,
  tileId: string,
  deltaCol: number,
  deltaRow: number,
): Record<string, TileLayout> {
  const layout = layouts[tileId];
  if (!layout) return layouts;

  return {
    ...layouts,
    [tileId]: normalizeLayout({
      ...layout,
      col: layout.col + deltaCol,
      row: layout.row + deltaRow,
    }),
  };
}

export function resizeTileLayout(
  layouts: Record<string, TileLayout>,
  tileId: string,
  deltaColSpan: number,
  deltaRowSpan: number,
): Record<string, TileLayout> {
  const layout = layouts[tileId];
  if (!layout) return layouts;

  return {
    ...layouts,
    [tileId]: normalizeLayout({
      ...layout,
      colSpan: layout.colSpan + deltaColSpan,
      rowSpan: layout.rowSpan + deltaRowSpan,
    }),
  };
}

export function applyLayoutPreset(
  sessions: LayoutSession[],
  preset: LayoutPreset,
  selectedSessionId?: string | null,
): Record<string, TileLayout> {
  switch (preset) {
    case "focus":
      return Object.fromEntries(
        selectedFirstSessions(sessions, selectedSessionId).map((session, index) => [
          session.id,
          normalizeLayout({
            tileId: session.id,
            col: 1,
            row: index * FULL_WIDTH_ROW_SPAN + 1,
            colSpan: GRID_COLUMNS,
            rowSpan: FULL_WIDTH_ROW_SPAN,
          }),
        ]),
      );
    case "two-up":
      return Object.fromEntries(
        selectedFirstSessions(sessions, selectedSessionId).map((session, index) => [
          session.id,
          normalizeLayout({
            tileId: session.id,
            col: index % 2 === 0 ? 1 : 7,
            row: Math.floor(index / 2) * SPLIT_VIEW_ROW_SPAN + 1,
            colSpan: 6,
            rowSpan: SPLIT_VIEW_ROW_SPAN,
          }),
        ]),
      );
    case "grid":
      return defaultLayouts(sessions);
  }
}

function defaultLayouts(sessions: LayoutSession[]): Record<string, TileLayout> {
  return Object.fromEntries(
    sessions.map((session, index) => [session.id, defaultLayout(session.id, index, sessions.length)]),
  );
}

function selectedFirstSessions(sessions: LayoutSession[], selectedSessionId?: string | null): LayoutSession[] {
  if (!selectedSessionId) return sessions;
  const selected = sessions.find((session) => session.id === selectedSessionId);
  if (!selected) return sessions;
  return [selected, ...sessions.filter((session) => session.id !== selectedSessionId)];
}

function defaultLayout(tileId: string, index: number, tileCount: number): TileLayout {
  if (tileCount === 1) {
    return normalizeLayout({
      tileId,
      col: 1,
      row: 1,
      colSpan: GRID_COLUMNS,
      rowSpan: FULL_WIDTH_ROW_SPAN,
    });
  }

  const rowSpan = tileCount === 2 ? SPLIT_VIEW_ROW_SPAN : TILED_ROW_SPAN;

  return normalizeLayout({
    tileId,
    col: index % 2 === 0 ? 1 : 7,
    row: Math.floor(index / 2) * rowSpan + 1,
    colSpan: DEFAULT_COL_SPAN,
    rowSpan,
  });
}

function normalizeLayout(layout: TileLayout): TileLayout {
  const colSpan = clamp(Math.round(layout.colSpan), MIN_COL_SPAN, MAX_COL_SPAN);
  const rowSpan = Math.max(MIN_ROW_SPAN, Math.round(layout.rowSpan));
  const col = clamp(Math.round(layout.col), 1, GRID_COLUMNS - colSpan + 1);
  const row = Math.max(1, Math.round(layout.row));

  return { ...layout, col, row, colSpan, rowSpan };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
