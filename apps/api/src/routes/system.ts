import { Hono } from "hono";

import { requireSession, type AuthSessionStore, type AuthVariables } from "../auth/session-auth";
import { buildRunnerStatus } from "../services/runner-status-service";
import type { SystemStatusStore } from "../services/system-status-store";

export function createSystemRoutes(store: SystemStatusStore, sessionStore: AuthSessionStore) {
  const systemRoutes = new Hono<{ Variables: AuthVariables }>();

  systemRoutes.use("*", requireSession(sessionStore));

  systemRoutes.get("/status", async (c) => {
    const auth = c.get("auth");
    const timestamps = await store.getTimestamps(auth.workspaceId);

    return c.json({
      runner: buildRunnerStatus({
        now: new Date(),
        ...timestamps,
      }),
    });
  });

  return systemRoutes;
}
