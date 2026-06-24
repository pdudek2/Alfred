import { createHash } from "node:crypto";

import type { PrivacyMode } from "./enums.js";

const MINIMAL_KEYS = new Set(["summary", "status", "tool_name", "exit_code"]);
const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|passphrase|api[_-]?key|apikey|authorization|bearer|credential|cookie|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|signature)/i;
const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API[_-]?KEY|AUTHORIZATION|CREDENTIAL|COOKIE|PRIVATE[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|CLIENT[_-]?SECRET|SESSION[_-]?ID|SIGNATURE)[A-Z0-9_]*)(\s*[:=]\s*)("[^"]+"|'[^']+'|(?:Bearer|Basic)\s+[^\s"'`;,]+|[^\s"'`;,]+)/gi;
const CLI_SECRET_ARG_PATTERN =
  /(\B--(?:token|api-key|apikey|password|secret|client-secret|access-token|refresh-token)(?:=|\s+))("[^"]+"|'[^']+'|[^\s"'`]+)/gi;
const QUOTED_HEADER_SECRET_PATTERN =
  /(["'])([^"']*\b(?:authorization|x-api-key|api-key|cookie)\s*:\s*)([^"']+)\1/gi;
const HEADER_SECRET_PATTERN =
  /\b(authorization|x-api-key|api-key|cookie)(\s*:\s*)((?:Bearer|Basic)\s+[^\s"'`;,]+|[^\s"'`;,]+)/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const AWS_ACCESS_KEY_ID_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const SLACK_TOKEN_PATTERN = /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/g;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g;
const SECRET_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/\-=]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  GITHUB_TOKEN_PATTERN,
  JWT_PATTERN,
  AWS_ACCESS_KEY_ID_PATTERN,
  SLACK_TOKEN_PATTERN,
];
const ABSOLUTE_LOCAL_PATH_PATTERN = /(?:\/Users|\/home|\/tmp|\/private\/tmp|\/var\/folders|\/Volumes)\/[^\s"'`]+/g;
const REDACTED = "[redacted]";

type RedactValueOptions = {
  redactPaths: boolean;
};

const STANDARD_REDACTION_OPTIONS: RedactValueOptions = {
  redactPaths: true,
};

const FULL_REDACTION_OPTIONS: RedactValueOptions = {
  redactPaths: false,
};

export function redactPayload(payload: Record<string, unknown>, mode: PrivacyMode): Record<string, unknown> {
  if (mode === "full") {
    return redactValue(payload, undefined, FULL_REDACTION_OPTIONS) as Record<string, unknown>;
  }

  if (mode === "minimal") {
    return redactValue(
      Object.fromEntries(Object.entries(payload).filter(([key]) => MINIMAL_KEYS.has(key))),
      undefined,
      STANDARD_REDACTION_OPTIONS,
    ) as Record<string, unknown>;
  }

  return redactValue(payload, undefined, STANDARD_REDACTION_OPTIONS) as Record<string, unknown>;
}

export function redactText(value: string): string {
  return redactSecretText(value);
}

export function redactUnknown(value: unknown): unknown {
  return redactValue(value, undefined, STANDARD_REDACTION_OPTIONS);
}

function redactValue(value: unknown, key?: string, options: RedactValueOptions = STANDARD_REDACTION_OPTIONS): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, undefined, options));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey, options)]),
    );
  }

  if (typeof value === "string") {
    return redactSecretText(value, options);
  }

  return value;
}

function redactSecretText(value: string, options: RedactValueOptions = STANDARD_REDACTION_OPTIONS): string {
  const withoutStructuredSecrets = value
    .replace(QUOTED_HEADER_SECRET_PATTERN, (_match, quote, headerPrefix) => `${quote}${headerPrefix}${REDACTED}${quote}`)
    .replace(HEADER_SECRET_PATTERN, (match, header, separator) =>
      match.includes(REDACTED) ? match : `${header}${separator}${REDACTED}`,
    )
    .replace(SECRET_ASSIGNMENT_PATTERN, (match, key, separator) =>
      match.includes(REDACTED) ? match : `${key}${separator}${REDACTED}`,
    )
    .replace(CLI_SECRET_ARG_PATTERN, (match, prefix) =>
      match.includes(REDACTED) ? match : `${prefix}${REDACTED}`,
    );
  const withoutSecrets = SECRET_TEXT_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, REDACTED),
    withoutStructuredSecrets,
  );
  return options.redactPaths
    ? withoutSecrets.replace(ABSOLUTE_LOCAL_PATH_PATTERN, (matchedPath) => redactedPathMarker(matchedPath))
    : withoutSecrets;
}

function redactedPathMarker(value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `[redacted-path:${digest}]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
