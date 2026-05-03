import { Hono } from "hono";

import { requireSession, type AuthSessionStore, type AuthVariables } from "../auth/session-auth.js";
import { buildRunnerStatus } from "../services/runner-status-service.js";
import type { SystemStatusStore } from "../services/system-status-store.js";

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
