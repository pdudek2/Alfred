export const MAX_SESSION_TITLE_LENGTH = 80;

export function normalizeSessionTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").slice(0, MAX_SESSION_TITLE_LENGTH);
}
