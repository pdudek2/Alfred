export function shortenPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const maxVisibleParts = normalized.startsWith("/") ? 2 : 3;
  if (parts.length <= maxVisibleParts) return value;
  return `…/${parts.slice(-2).join("/")}`;
}
