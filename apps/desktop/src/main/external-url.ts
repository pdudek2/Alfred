import { shell } from "electron";
import type {
  WorkspaceOpenExternalUrlRequest,
  WorkspaceOpenExternalUrlResult,
} from "../shared/workspace-ipc.js";

type OpenExternalUrlOptions = {
  openExternal?: (url: string) => Promise<void>;
};

export async function openExternalUrl(
  request: WorkspaceOpenExternalUrlRequest | null | undefined,
  options: OpenExternalUrlOptions = {},
): Promise<WorkspaceOpenExternalUrlResult> {
  const result = normalizeLocalPreviewUrl(request?.url);
  if (!result.ok) return result;

  try {
    await (options.openExternal ?? shell.openExternal)(result.url);
    return { ok: true, url: result.url };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not open preview URL.",
      url: result.url,
    };
  }
}

export function normalizeLocalPreviewUrl(value: unknown): WorkspaceOpenExternalUrlResult {
  if (typeof value !== "string") {
    return { ok: false, error: "Invalid preview URL request." };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: "No preview URL to open." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid preview URL.", url: trimmed };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only local web preview URLs can be opened.", url: parsed.toString() };
  }

  if (!isLocalPreviewHost(parsed.hostname)) {
    return { ok: false, error: "Only localhost preview URLs can be opened.", url: parsed.toString() };
  }

  return { ok: true, url: parsed.toString() };
}

function isLocalPreviewHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
