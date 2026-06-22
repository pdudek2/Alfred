import type { PrivacyMode } from "@alfred/schema";
import { createHash } from "node:crypto";

const MINIMAL_KEYS = new Set(["summary", "status", "tool_name", "exit_code"]);
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|passphrase|api[_-]?key|apikey|authorization|bearer|credential|cookie|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|signature)/i;
const SECRET_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/\-=]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bghp_[A-Za-z0-9_]{8,}\b/g,
];
const ABSOLUTE_LOCAL_PATH_PATTERN = /(?:\/Users|\/home|\/tmp|\/private\/tmp|\/var\/folders|\/Volumes)\/[^\s"'`]+/g;
const REDACTED = "[redacted]";

export function redactPayload(payload: Record<string, unknown>, mode: PrivacyMode): Record<string, unknown> {
  if (mode === "full") {
    return payload;
  }

  if (mode === "minimal") {
    return redactValue(Object.fromEntries(Object.entries(payload).filter(([key]) => MINIMAL_KEYS.has(key)))) as Record<
      string,
      unknown
    >;
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
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]),
    );
  }

  if (typeof value === "string") {
    return redactSecretText(value);
  }

  return value;
}

function redactSecretText(value: string): string {
  const withoutSecrets = SECRET_TEXT_PATTERNS.reduce((text, pattern) => text.replace(pattern, REDACTED), value);
  return withoutSecrets.replace(ABSOLUTE_LOCAL_PATH_PATTERN, (matchedPath) => redactedPathMarker(matchedPath));
}

function redactedPathMarker(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `[redacted-path:${digest}]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
