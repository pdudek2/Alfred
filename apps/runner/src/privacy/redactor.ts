import type { PrivacyMode } from "@alfred/schema";

const MINIMAL_KEYS = new Set(["summary", "status", "tool_name", "exit_code"]);
const SECRET_KEY_PATTERN = /(token|secret|password|api_key|authorization)/i;
const REDACTED = "[redacted]";

export function redactPayload(payload: Record<string, unknown>, mode: PrivacyMode): Record<string, unknown> {
  if (mode === "full") {
    return payload;
  }

  if (mode === "minimal") {
    return Object.fromEntries(Object.entries(payload).filter(([key]) => MINIMAL_KEYS.has(key)));
  }

  return redactValue(payload) as Record<string, unknown>;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
