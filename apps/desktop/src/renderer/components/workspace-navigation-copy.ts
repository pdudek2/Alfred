export function inboxNavigationSummary(count: number): string {
  if (count <= 0) return "Clear";
  if (count === 1) return "1 item waiting";
  return `${count} items waiting`;
}
