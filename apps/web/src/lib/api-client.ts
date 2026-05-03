export type RunListItem = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  source_id: string;
  source_run_id: string;
  status: string;
  lifecycle_status?: string;
  title: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at?: string | null;
  updated_at: string;
  created_at: string;
};

export type RunEventItem = {
  id: string;
  event_id: string;
  source_event_id: string;
  type: string;
  status: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export type RunDetail = RunListItem & {
  events: RunEventItem[];
};

type RunsResponse = {
  items: RunListItem[];
};

export type RunFilters = {
  source?: string;
  status?: string;
  project?: string;
  since?: string;
};

export type ListRunsOptions = {
  limit?: number;
  filters?: RunFilters;
};

export type ApiClient = {
  listRuns(options?: number | ListRunsOptions): Promise<RunListItem[]>;
  getRun(runId: string): Promise<RunDetail>;
};

export class ApiError extends Error {
  readonly code: "unauthorized" | "request_failed";
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = status === 401 || status === 403 ? "unauthorized" : "request_failed";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "unauthorized";
}

export function createApiClient(fetchImpl?: typeof fetch): ApiClient {
  const request: typeof fetch = (input, init) => {
    const activeFetch = fetchImpl ?? fetch;
    return init === undefined ? activeFetch(input) : activeFetch(input, init);
  };

  return {
    listRuns: async (options = 25) => {
      const response = await request(runListPath(options));
      if (!response.ok) {
        throw new ApiError(`Failed to load runs: ${response.status}`, response.status);
      }

      const body = (await response.json()) as RunsResponse;
      return body.items;
    },

    getRun: async (runId) => {
      const response = await request(`/api/v1/runs/${runId}`);
      if (!response.ok) {
        throw new ApiError(`Failed to load run: ${response.status}`, response.status);
      }

      return (await response.json()) as RunDetail;
    },
  };
}

function runListPath(options: number | ListRunsOptions): string {
  const normalized = normalizeListRunsOptions(options);
  const params = new URLSearchParams({ limit: String(normalized.limit) });

  appendFilter(params, "source", normalized.filters.source);
  appendFilter(params, "status", normalized.filters.status);
  appendFilter(params, "project", normalized.filters.project);
  appendFilter(params, "since", normalized.filters.since);

  return `/api/v1/runs?${params.toString()}`;
}

function normalizeListRunsOptions(options: number | ListRunsOptions): Required<ListRunsOptions> {
  if (typeof options === "number") {
    return { limit: options, filters: {} };
  }

  return {
    limit: options.limit ?? 25,
    filters: options.filters ?? {},
  };
}

function appendFilter(params: URLSearchParams, key: keyof RunFilters, value: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed) {
    params.set(key, trimmed);
  }
}
