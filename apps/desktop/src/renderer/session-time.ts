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

/** The focused session's strip spells the age out: "Started 6 min ago". */
export function sessionStartedLabel(createdAt: number | undefined, now = Date.now()): string | null {
  const age = sessionAgeLabel(createdAt, now);
  if (age === null) return null;
  if (age === "now") return "Started just now";
  return `Started ${/^\d+m$/.test(age) ? `${age.slice(0, -1)} min` : age} ago`;
}

/** History rows carry one unit, as on the canvas: "2h", "9d", "3w". */
export function sessionAgeShort(at: number | undefined, now = Date.now()): string | null {
  if (at === undefined) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}

const AGE_UNIT_WORDS = { m: "minute", h: "hour", d: "day", w: "week", y: "year" } as const;

/** The same age in words, for a sentence: "9 days", "3 weeks". Null under a minute. */
export function sessionAgeWords(at: number | undefined, now = Date.now()): string | null {
  const short = sessionAgeShort(at, now);
  if (short === null || short === "now") return null;
  const count = Number(short.slice(0, -1));
  const unit = AGE_UNIT_WORDS[short.slice(-1) as keyof typeof AGE_UNIT_WORDS];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

export type HistoryDayGroup = "Today" | "This week" | "Earlier";

/** History groups its list by day instead of offering a time filter. "This week" is the last seven days. */
export function historyDayGroup(at: number, now = Date.now()): HistoryDayGroup {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (at >= today.getTime()) return "Today";
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  return at >= weekStart.getTime() ? "This week" : "Earlier";
}

export function sessionAgeTitle(createdAt: number | undefined): string | undefined {
  if (createdAt === undefined) return undefined;
  return `Started ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(createdAt)}`;
}

export function sessionDateTimeLabel(updatedAt: number | undefined): string | null {
  if (updatedAt === undefined) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(updatedAt);
}
