import { stripTerminalControlSequences } from "./session-title.js";

const LEADING_RUNTIME_ENVELOPE = /^<(recommended_plugins|in-app-browser-context|environment_context|apps_instructions|plugins_instructions|skills_instructions)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/i;
const RUNTIME_MARKER = /#\s*AGENTS\.md instructions\b|<(?:recommended_plugins|in-app-browser-context|environment_context|apps_instructions|plugins_instructions|skills_instructions|permissions instructions)(?:\s|>)/i;
const TITLE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function sessionPresentationText(value: string): string {
  let text = stripTerminalControlSequences(value).trim();
  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text
      .replace(/^#\s*AGENTS\.md instructions[^\n]*\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/i, "")
      .replace(LEADING_RUNTIME_ENVELOPE, "")
      .replace(/^<permissions instructions>[\s\S]*?<\/permissions instructions>\s*/i, "")
      .trim();
  }
  if (RUNTIME_MARKER.test(text)) return "";
  return text.replace(/^#{1,3}\s*My request for Codex:\s*/i, "").trim();
}

export function sessionPresentationTitle(value: string, fallback: string): string {
  return sessionPresentationText(value).replace(TITLE_CONTROL, "").trim() || fallback;
}
