export const MAX_DESK_VISIBLE_SESSIONS = 3;
export type DeskPresentationSlot = "primary" | "secondary" | "tertiary";

export function nextDeskPresentationIds(
  availableIds: string[],
  selectedId: string | null,
  previousIds: string[],
): string[] {
  const available = new Set(availableIds);
  const ordered = [
    ...(selectedId && available.has(selectedId) ? [selectedId] : []),
    ...previousIds.filter((id) => id !== selectedId && available.has(id)),
    ...availableIds.filter((id) => id !== selectedId && !previousIds.includes(id)),
  ];
  return [...new Set(ordered)].slice(0, MAX_DESK_VISIBLE_SESSIONS);
}

export function deskPresentationSlot(
  sessionId: string,
  presentationIds: string[],
): DeskPresentationSlot | null {
  if (presentationIds[0] === sessionId) return "primary";
  if (presentationIds[1] === sessionId) return "secondary";
  if (presentationIds[2] === sessionId) return "tertiary";
  return null;
}
