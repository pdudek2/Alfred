export function normalizeStatus(status: string, fallback = ""): string {
  return status.trim().toLowerCase() || fallback;
}
