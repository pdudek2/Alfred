export function sourceCursorKey(
  sourceId: string,
  relativeSessionPath: string,
): string {
  return JSON.stringify([sourceId, relativeSessionPath]);
}

export type SourceProjectPin = { key: string; name?: string };

export type FileCursorV1 = {
  v: 1;
  line: number;
  prefixHash: string;
  project?: SourceProjectPin;
};

export type ParsedSourceCursor =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "legacy-time"; occurredAt: string }
  | { kind: "position"; cursor: FileCursorV1 };

export type SourceTimeFloor = {
  occurredAtMs: number;
  includeEqual: boolean;
};

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PREFIX_HASH = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectPin(value: unknown): value is SourceProjectPin {
  return isRecord(value)
    && typeof value.key === "string"
    && value.key.length > 0
    && (value.name === undefined || (typeof value.name === "string" && value.name.length > 0));
}

function isFileCursor(value: unknown): value is FileCursorV1 {
  return isRecord(value)
    && value.v === 1
    && typeof value.line === "number"
    && Number.isInteger(value.line)
    && value.line >= 0
    && typeof value.prefixHash === "string"
    && PREFIX_HASH.test(value.prefixHash)
    && (value.project === undefined || isProjectPin(value.project));
}

export function parseStoredSourceCursor(
  storedCursor: string | null | undefined,
): ParsedSourceCursor {
  if (storedCursor === null || storedCursor === undefined) return { kind: "none" };
  if (ISO_TIMESTAMP.test(storedCursor) && !Number.isNaN(Date.parse(storedCursor))) {
    return { kind: "legacy-time", occurredAt: storedCursor };
  }

  try {
    const value: unknown = JSON.parse(storedCursor);
    return isFileCursor(value) ? { kind: "position", cursor: value } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function encodeFileCursor(cursor: FileCursorV1): string {
  return JSON.stringify(cursor);
}

export function resolveSourceTimeFloor(
  configuredSince: string | undefined,
  storedCursor: ParsedSourceCursor,
): SourceTimeFloor | undefined {
  const configuredMs = configuredSince === undefined ? Number.NaN : Date.parse(configuredSince);
  const storedMs = storedCursor.kind === "legacy-time"
    ? Date.parse(storedCursor.occurredAt)
    : Number.NaN;

  if (Number.isNaN(configuredMs) && Number.isNaN(storedMs)) return undefined;
  if (Number.isNaN(configuredMs)) return { occurredAtMs: storedMs, includeEqual: true };
  if (Number.isNaN(storedMs) || configuredMs > storedMs) {
    return { occurredAtMs: configuredMs, includeEqual: false };
  }
  return { occurredAtMs: storedMs, includeEqual: true };
}

export function cursorMatchesFile(cursor: FileCursorV1, prefixHash: string): boolean {
  return cursor.prefixHash === prefixHash;
}

export function newestCursor(
  configuredSince: string | undefined,
  storedCursor: string | null,
): string | undefined {
  if (!configuredSince) return storedCursor ?? undefined;
  if (!storedCursor) return configuredSince;

  const configuredMs = Date.parse(configuredSince);
  const storedMs = Date.parse(storedCursor);
  if (Number.isNaN(configuredMs)) return storedCursor;
  if (Number.isNaN(storedMs)) return configuredSince;
  return storedMs > configuredMs ? storedCursor : configuredSince;
}
