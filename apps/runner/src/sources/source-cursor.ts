export function sourceCursorKey(
  sourceId: string,
  relativeSessionPath: string,
): string {
  return JSON.stringify([sourceId, relativeSessionPath]);
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
