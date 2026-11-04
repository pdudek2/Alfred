import { createHash } from "node:crypto";
import { homedir } from "node:os";

import type { PrivacyMode } from "./enums.js";

const MINIMAL_KEYS = new Set(["summary", "status", "tool_name", "exit_code"]);
const SECRET_KEY_WORDS =
  "token|secret|password|passwd|passphrase|api[_-]?key|apikey|authorization|bearer|credential|cookie|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|signature";
const SECRET_KEY_PATTERN = new RegExp(`(${SECRET_KEY_WORDS})`, "i");
// Saved scrollback is raw PTY output: escape sequences and backspaces sit between and inside words. A value takes
// them in and its escape sequences are put back after the marker; other control bytes end a value or a path.
const CSI = String.raw`\x1b\[[0-9;?]*[ -/]*[@-~]`;
const CSI_PATTERN = new RegExp(CSI, "g");
const keptEscapes = (text: string) => text.match(CSI_PATTERN)?.join("") ?? "";
// A value an earlier pattern already redacted: the bare marker, or a quoted header's marker and closing quote.
const isRedactedValue = (text: string) => /^\[redacted\](?:["'].*)?\s*$/.test(text.replace(CSI_PATTERN, ""));
const value = (stop: string) => String.raw`(?:${CSI}|\x08|[^${stop}\x00-\x1f\x7f])+`;
const VALUE = value(String.raw`\s"'\x60;,`);
const CLI_VALUE = value(String.raw`\s"'\x60`);
const separator = (chars: string) => String.raw`((?:\s|${CSI})*[${chars}](?:\s|${CSI})*)`;
// A name is tried once, from its first character, so a long run of name characters is scanned in linear time.
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*?(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API[_-]?KEY|AUTHORIZATION|CREDENTIAL|COOKIE|PRIVATE[_-]?KEY|SESSION[_-]?ID|SIGNATURE))([A-Za-z0-9_-]+)${separator(":=")}("[^"]+"|'[^']+'|(?:Bearer|Basic)\s+${VALUE}|${VALUE})`,
  "gi",
);
const CLI_SECRET_ARG_NAMES =
  "(?:(?!no[-_])[a-z0-9]+[-_])?(?:token|api-key|apikey|password|secret|client-secret|access-token|refresh-token)";
const CLI_SECRET_ARG_PATTERN = new RegExp(
  String.raw`(\B--${CLI_SECRET_ARG_NAMES}(?:=|\s+))("[^"]+"|'[^']+'|${CLI_VALUE})`,
  "gi",
);
const CLI_SECRET_FLAG_PATTERN = new RegExp(`^--${CLI_SECRET_ARG_NAMES}$`, "i");
const QUOTED_HEADER_SECRET_PATTERN =
  /(["'])([^"']*\b(?:authorization|x-api-key|api-key)\s*:\s*)([^"']+)\1/gi;
const HEADER_SECRET_PATTERN = new RegExp(
  String.raw`\b(authorization|x-api-key|api-key)${separator(":")}([^\r\n]+)`,
  "gi",
);
const URI_USERINFO_PATTERN = new RegExp(
  String.raw`\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^/\s:@]*):((?:${CSI}|[^@\s/\x00-\x1f\x7f])+)@`,
  "gi",
);
// A quoted key ending in a secret word (access_token, refreshToken — not api_key_description),
// then a quoted string value that may contain escapes.
const JSON_SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`((["'])[^"'\\\r\n]*(?:${SECRET_KEY_WORDS})\2\s*:\s*)("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*')`,
  "gi",
);
const ESCAPED_JSON_SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`(\\"[^"\\\r\n]*(?:${SECRET_KEY_WORDS})\\"\s*:\s*\\")(?:[^"\\\r\n]|\\\\[^"\r\n])*(\\")`,
  "gi",
);
const COOKIE_HEADER_PATTERN = new RegExp(
  String.raw`(["'])(\s*cookie\s*:\s*)(?=[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+\s*=)[^\r\n]*?\1|\b(cookie)(\s*:\s*)(?=[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+\s*=)([^\r\n]+)`,
  "gi",
);
const KEY_BEGIN = "-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----";
const LINE_BREAK = String.raw`(?:\r?\n|\\(?:r\\)?n)`;
const KEY_LINE = String.raw`(?:[A-Za-z-]+: [^\r\n\\"]*|(?:${CSI}|[A-Za-z0-9+/= \t])+|(?=${LINE_BREAK}))`;
const PRIVATE_KEY_PATTERN = new RegExp(String.raw`${KEY_BEGIN}(?:[^-]|-(?!----(?:BEGIN|END) ))*-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----`, "g");
// A key cut short (head key.pem) ends at the last line that still looks like key text.
const CUT_PRIVATE_KEY_PATTERN = new RegExp(String.raw`${KEY_BEGIN}(?:${LINE_BREAK}${KEY_LINE})*`, "g");
const TOKEN_BODIES = [
  "sk-[A-Za-z0-9_-]{8,}",
  "(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})",
  "sk_(?:live|test)_[A-Za-z0-9]{8,}",
  "AIza[A-Za-z0-9_-]{20,}",
  "glpat-[A-Za-z0-9_-]{8,}",
  "npm_[A-Za-z0-9]{8,}",
  "hf_[A-Za-z0-9]{20,}",
  "gsk_[A-Za-z0-9]{20,}",
  String.raw`SG\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
  String.raw`eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
  "(?:AKIA|ASIA)[A-Z0-9]{16}",
  "xox[abprs]-[A-Za-z0-9-]{20,}",
];
const BEARER = String.raw`[Bb][Ee][Aa][Rr][Ee][Rr]\s+[A-Za-z0-9._~+/\-=]+`;
// \b fails right after an SGR code such as ESC[32m, so a token there is matched with the sequence in front of it.
const TOKEN_AFTER_CSI_PATTERN = new RegExp(
  String.raw`(${CSI})(?:${BEARER}|(?:${TOKEN_BODIES.join("|")})\b)`,
  "g",
);
const SECRET_TEXT_PATTERNS = [
  PRIVATE_KEY_PATTERN,
  CUT_PRIVATE_KEY_PATTERN,
  new RegExp(String.raw`\b${BEARER}`, "g"),
  ...TOKEN_BODIES.map((body) => new RegExp(String.raw`\b${body}\b`, "g")),
];
const ABSOLUTE_LOCAL_PATH_PATTERN = new RegExp(
  String.raw`(?:\/Users|\/home|\/tmp|\/private\/tmp|\/var\/folders|\/Volumes)\/[^\s"'\x60\x00-\x1f\x7f]+`,
  "g",
);
export const REDACTED = "[redacted]";

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

export function redactSecrets(value: string): string {
  return redactSecretText(value, FULL_REDACTION_OPTIONS);
}

export function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1];
    return previous !== undefined && (CLI_SECRET_FLAG_PATTERN.test(previous) || (previous === "-u" && arg.includes(":")))
      ? REDACTED
      : redactSecrets(arg);
  });
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
    .replace(URI_USERINFO_PATTERN, (_match, scheme, _user, password: string) =>
      `${scheme}${REDACTED}${keptEscapes(password)}@`)
    .replace(JSON_SECRET_ASSIGNMENT_PATTERN, (_match, prefix, _keyQuote, value: string) => `${prefix}${value[0]}${REDACTED}${value[0]}`)
    .replace(ESCAPED_JSON_SECRET_ASSIGNMENT_PATTERN, (_match, prefix, suffix) => `${prefix}${REDACTED}${suffix}`)
    .replace(COOKIE_HEADER_PATTERN, (_match, quote, quotedPrefix, header, separator, cookies: string | undefined) =>
      quote ? `${quote}${quotedPrefix}${REDACTED}${quote}` : `${header}${separator}${REDACTED}${keptEscapes(cookies ?? "")}`,
    )
    .replace(QUOTED_HEADER_SECRET_PATTERN, (_match, quote, headerPrefix) => `${quote}${headerPrefix}${REDACTED}${quote}`)
    .replace(HEADER_SECRET_PATTERN, (match, header, separator, value: string) =>
      isRedactedValue(value) ? match : `${header}${separator}${REDACTED}${keptEscapes(value)}`,
    )
    .replace(SECRET_ASSIGNMENT_PATTERN, (match, key, separator, value: string) => {
      if (/^cookie$/i.test(key) && separator.includes(":")) return match;
      return isRedactedValue(value) ? match : `${key}${separator}${REDACTED}${keptEscapes(value)}`;
    })
    .replace(CLI_SECRET_ARG_PATTERN, (match, prefix, value: string) =>
      isRedactedValue(value) ? match : `${prefix}${REDACTED}${keptEscapes(value)}`,
    );
  const withoutSecrets = SECRET_TEXT_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, REDACTED),
    withoutStructuredSecrets.replace(TOKEN_AFTER_CSI_PATTERN, (_match, csi) => `${csi}${REDACTED}`),
  );
  return options.redactPaths
    ? withoutSecrets.replace(ABSOLUTE_LOCAL_PATH_PATTERN, (matchedPath) => redactedPathMarker(matchedPath))
    : withoutSecrets;
}

function redactedPathMarker(value: string): string {
  const home = homedir();
  if (value === home || value.startsWith(`${home}/`)) return `~${value.slice(home.length)}`;
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `[redacted-path:${digest}]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
