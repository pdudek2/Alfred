export function sessionAgeLabel(createdAt: number | undefined, now = Date.now()): string | null {
  if (createdAt === undefined) return null;

  const elapsedMinutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;
  if (elapsedHours < 24) {
    return remainingMinutes >= 10 ? `${elapsedHours}h ${remainingMinutes}m` : `${elapsedHours}h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  const remainingHours = elapsedHours % 24;
  if (elapsedDays < 7) {
    return remainingHours > 0 ? `${elapsedDays}d ${remainingHours}h` : `${elapsedDays}d`;
  }

  return `${Math.floor(elapsedDays / 7)}w`;
}

export function sessionAgeTitle(createdAt: number | undefined): string | undefined {
  if (createdAt === undefined) return undefined;
  return `Started ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdAt)}`;
}
