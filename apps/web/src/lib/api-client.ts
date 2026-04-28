export type RunListItem = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  project_key: string | null;
  project_name: string | null;
  source_id: string;
  source_run_id: string;
  status: string;
  title: string | null;
  started_at: string | null;
  completed_at: string | null;
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

export type ApiClient = {
  listRuns(limit?: number): Promise<RunListItem[]>;
  getRun(runId: string): Promise<RunDetail>;
};

export function createApiClient(fetchImpl?: typeof fetch): ApiClient {
  const request: typeof fetch = (input, init) => {
    const activeFetch = fetchImpl ?? fetch;
    return init === undefined ? activeFetch(input) : activeFetch(input, init);
  };

  return {
    listRuns: async (limit = 25) => {
      const response = await request(`/api/v1/runs?limit=${limit}`);
      if (!response.ok) {
        throw new Error(`Failed to load runs: ${response.status}`);
      }

      const body = (await response.json()) as RunsResponse;
      return body.items;
    },

    getRun: async (runId) => {
      const response = await request(`/api/v1/runs/${runId}`);
      if (!response.ok) {
        throw new Error(`Failed to load run: ${response.status}`);
      }

      return (await response.json()) as RunDetail;
    },
  };
}
