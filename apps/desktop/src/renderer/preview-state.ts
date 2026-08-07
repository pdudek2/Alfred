export type PreviewUrlCandidate = {
  id: string;
  workspaceId: string;
  url: string;
  sessionId: string;
  sessionTitle: string;
  sources: PreviewUrlSource[];
  firstSeenAt: number;
  lastSeenAt: number;
};

export type PreviewUrlSource = {
  sessionId: string;
  sessionTitle: string;
  lastSeenAt: number;
};

export type PreviewUrlObservation = {
  workspaceId: string;
  sessionId: string;
  sessionTitle: string;
  text: string;
  seenAt?: number;
};

const HTTP_URL_PATTERN = /\bhttp:\/\/[^\s<>"'`|\\]+/gi;
const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TRAILING_TERMINAL_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">"]);
// Terminal output contains the ESC control byte by protocol; matching it is intentional.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const PREVIEW_CANDIDATE_KEY_SEPARATOR = "\u0000";

export function extractLocalPreviewUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const plainText = stripAnsiEscapes(text);

  for (const match of plainText.matchAll(HTTP_URL_PATTERN)) {
    const url = normalizeLocalPreviewUrl(match[0]);
    if (!url || seen.has(url)) continue;

    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export function normalizeLocalPreviewUrl(rawUrl: string): string | null {
  let candidate = rawUrl.trim();

  while (candidate.length > 0) {
    const trailingCharacter = candidate.at(-1);
    if (!trailingCharacter || !TRAILING_TERMINAL_PUNCTUATION.has(trailingCharacter)) break;

    const currentUrl = parseLocalHttpUrl(candidate);
    const withoutTrailingCharacter = candidate.slice(0, -1);
    const trimmedUrl = parseLocalHttpUrl(withoutTrailingCharacter);

    if (currentUrl && !trimmedUrl) break;
    candidate = withoutTrailingCharacter;
  }

  return parseLocalHttpUrl(candidate);
}

export function previewUrlCandidateId(workspaceId: string, url: string): string {
  return `${workspaceId}:${url}`;
}

export function previewUrlCandidatesFromText(observation: PreviewUrlObservation): PreviewUrlCandidate[] {
  const seenAt = observation.seenAt ?? Date.now();
  const source = previewUrlSource(observation.sessionId, observation.sessionTitle, seenAt);

  return extractLocalPreviewUrls(observation.text).map((url) => ({
    id: previewUrlCandidateId(observation.workspaceId, url),
    workspaceId: observation.workspaceId,
    url,
    sessionId: observation.sessionId,
    sessionTitle: observation.sessionTitle,
    sources: [source],
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  }));
}

export function mergePreviewUrlCandidates(
  existingCandidates: PreviewUrlCandidate[],
  incomingCandidates: PreviewUrlCandidate[],
): PreviewUrlCandidate[] {
  if (incomingCandidates.length === 0) return sortPreviewUrlCandidates(existingCandidates);

  const candidatesByKey = new Map<string, PreviewUrlCandidate>();

  for (const candidate of existingCandidates) {
    candidatesByKey.set(previewUrlCandidateKey(candidate), candidate);
  }

  for (const candidate of incomingCandidates) {
    const key = previewUrlCandidateKey(candidate);
    const existingCandidate = candidatesByKey.get(key);

    if (!existingCandidate) {
      candidatesByKey.set(key, candidate);
      continue;
    }

    const sources = mergePreviewUrlSources(existingCandidate.sources, candidate.sources);
    const latestSource = sources[0]!;

    candidatesByKey.set(key, {
      id: existingCandidate.id,
      workspaceId: existingCandidate.workspaceId,
      url: existingCandidate.url,
      sessionId: latestSource.sessionId,
      sessionTitle: latestSource.sessionTitle,
      sources,
      firstSeenAt: Math.min(existingCandidate.firstSeenAt, candidate.firstSeenAt),
      lastSeenAt: latestSource.lastSeenAt,
    });
  }

  return sortPreviewUrlCandidates([...candidatesByKey.values()]);
}

export function removePreviewSessionCandidates(
  candidates: PreviewUrlCandidate[],
  sessionId: string,
): PreviewUrlCandidate[] {
  return candidates.flatMap((candidate) => {
    const sources = candidate.sources.filter((source) => source.sessionId !== sessionId);
    if (sources.length === candidate.sources.length) return [candidate];
    if (sources.length === 0) return [];

    const latestSource = sortPreviewUrlSources(sources)[0]!;
    return [{
      ...candidate,
      sessionId: latestSource.sessionId,
      sessionTitle: latestSource.sessionTitle,
      sources,
      lastSeenAt: latestSource.lastSeenAt,
    }];
  });
}

export function recordPreviewUrlsFromText(
  existingCandidates: PreviewUrlCandidate[],
  observation: PreviewUrlObservation,
): PreviewUrlCandidate[] {
  const incomingCandidates = previewUrlCandidatesFromText(observation);
  if (incomingCandidates.length === 0) return existingCandidates;

  return mergePreviewUrlCandidates(existingCandidates, incomingCandidates);
}

function parseLocalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return null;
    if (!LOCAL_HTTP_HOSTS.has(url.hostname.toLowerCase())) return null;

    return url.href;
  } catch {
    return null;
  }
}

function sortPreviewUrlCandidates(candidates: PreviewUrlCandidate[]): PreviewUrlCandidate[] {
  return [...candidates].sort(comparePreviewUrlCandidates);
}

function comparePreviewUrlCandidates(a: PreviewUrlCandidate, b: PreviewUrlCandidate): number {
  if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;

  const workspace = a.workspaceId.localeCompare(b.workspaceId);
  if (workspace !== 0) return workspace;

  const url = a.url.localeCompare(b.url);
  if (url !== 0) return url;

  return a.sessionId.localeCompare(b.sessionId);
}

function mergePreviewUrlSources(
  existingSources: PreviewUrlSource[],
  incomingSources: PreviewUrlSource[],
): PreviewUrlSource[] {
  const sourcesBySession = new Map(existingSources.map((source) => [source.sessionId, source]));
  for (const source of incomingSources) {
    const existing = sourcesBySession.get(source.sessionId);
    if (!existing || source.lastSeenAt >= existing.lastSeenAt) sourcesBySession.set(source.sessionId, source);
  }
  return sortPreviewUrlSources([...sourcesBySession.values()]);
}

function sortPreviewUrlSources(sources: PreviewUrlSource[]): PreviewUrlSource[] {
  return [...sources].sort((left, right) => (
    right.lastSeenAt - left.lastSeenAt || left.sessionId.localeCompare(right.sessionId)
  ));
}

function previewUrlSource(sessionId: string, sessionTitle: string, lastSeenAt: number): PreviewUrlSource {
  return { sessionId, sessionTitle, lastSeenAt };
}

function previewUrlCandidateKey(candidate: Pick<PreviewUrlCandidate, "workspaceId" | "url">): string {
  return `${candidate.workspaceId}${PREVIEW_CANDIDATE_KEY_SEPARATOR}${candidate.url}`;
}

function stripAnsiEscapes(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}
