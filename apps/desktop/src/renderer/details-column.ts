/** Below 1200 CSS px Details starts hidden, so the terminal keeps its width. */
export const NARROW_WINDOW_QUERY = "(max-width: 1199.98px)";

/**
 * Whether each project shows Details. A wide window keeps the user's ⌘I choice (open by default); a narrow one keeps
 * its own choices (hidden by default), which last until the window crosses the threshold, so they never overwrite
 * the wide choice.
 */
export type DetailsColumnState = {
  narrowWindow: boolean;
  wide: Readonly<Record<string, boolean>>;
  narrow: Readonly<Record<string, boolean>>;
};

export function initialDetailsColumnState(narrowWindow: boolean): DetailsColumnState {
  return { narrowWindow, wide: {}, narrow: {} };
}

export function isDetailsOpen(state: DetailsColumnState, workspaceId: string): boolean {
  return state.narrowWindow ? state.narrow[workspaceId] ?? false : state.wide[workspaceId] ?? true;
}

export function withDetailsOpen(state: DetailsColumnState, workspaceId: string, open: boolean): DetailsColumnState {
  return state.narrowWindow
    ? { ...state, narrow: { ...state.narrow, [workspaceId]: open } }
    : { ...state, wide: { ...state.wide, [workspaceId]: open } };
}

export function withNarrowWindow(state: DetailsColumnState, narrowWindow: boolean): DetailsColumnState {
  return narrowWindow === state.narrowWindow ? state : { ...state, narrowWindow, narrow: {} };
}

export function withoutWorkspace(state: DetailsColumnState, workspaceId: string): DetailsColumnState {
  const wide = { ...state.wide };
  const narrow = { ...state.narrow };
  delete wide[workspaceId];
  delete narrow[workspaceId];
  return { ...state, wide, narrow };
}
