export function shortenPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const maxVisibleParts = normalized.startsWith("/") ? 2 : 3;
  if (parts.length <= maxVisibleParts) return value;
  return `…/${parts.slice(-2).join("/")}`;
}

export function shortenWorktreeLabel(value: string, maxLength = 35): string {
  const normalized = value.replace(/\\/g, "/");
  const isAbsolutePath = normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  const compact =
    normalized.includes("/") && (isAbsolutePath || normalized.length > maxLength) ? shortenPath(value) : value;
  if (compact.length <= maxLength) return compact;

  return truncateMiddle(compact.replace(/\\/g, "/"), maxLength);
}

function truncateMiddle(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (maxLength === 1) return "…";
  if (value.length <= maxLength) return value;

  const visibleLength = maxLength - 1;
  const headLength = Math.ceil(visibleLength / 2);
  const tailLength = Math.floor(visibleLength / 2);
  return `${value.slice(0, headLength)}…${value.slice(value.length - tailLength)}`;
}
