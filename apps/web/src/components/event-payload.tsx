type EventPayloadProps = {
  payload: Record<string, unknown>;
};

const SUMMARY_MAX_LENGTH = 96;
const PRIMARY_SUMMARY_KEYS = ["tool_name", "summary", "name", "title", "message", "status"];

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function buildSummary(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return "empty payload";
  }

  for (const key of PRIMARY_SUMMARY_KEYS) {
    if (key in payload) {
      const formatted = formatScalar(payload[key]);
      return truncate(`${key}: ${formatted}`, SUMMARY_MAX_LENGTH);
    }
  }

  const compact = truncate(JSON.stringify(payload), SUMMARY_MAX_LENGTH);
  return `${keys.length} field${keys.length === 1 ? "" : "s"} · ${compact}`;
}

export function EventPayload({ payload }: EventPayloadProps) {
  const summary = buildSummary(payload);

  return (
    <details className="event-payload">
      <summary className="event-payload-summary">
        <span className="event-payload-summary-text">{summary}</span>
      </summary>
      <pre className="event-payload-body">{JSON.stringify(payload, null, 2)}</pre>
    </details>
  );
}
