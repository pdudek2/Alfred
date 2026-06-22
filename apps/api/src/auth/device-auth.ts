import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { devices, type Database } from "@alfred/db";
import { hashToken } from "./token-hash.js";

export type DeviceAuth = {
  workspaceId: string;
  deviceId: string;
};

export type DeviceAuthStore = {
  authenticateDeviceToken(token: string): Promise<DeviceAuth | null>;
};

export type DeviceAuthVariables = {
  deviceAuth: DeviceAuth;
};

export function requireDeviceToken(authStore: DeviceAuthStore): MiddlewareHandler<{ Variables: DeviceAuthVariables }> {
  return async (c, next) => {
    const header = c.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const auth = await authStore.authenticateDeviceToken(token);
    if (!auth) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("deviceAuth", auth);
    await next();
  };
}

export function createStaticDeviceAuthStore(
  expectedToken: string,
  workspaceId: string,
  deviceId: string,
): DeviceAuthStore {
  return {
    authenticateDeviceToken: async (token) => (token === expectedToken ? { workspaceId, deviceId } : null),
  };
}

export function createFallbackDeviceAuthStore(
  primary: DeviceAuthStore,
  fallback: DeviceAuthStore,
  catchPrimaryErrors = false,
): DeviceAuthStore {
  return {
    authenticateDeviceToken: async (token) => {
      if (!catchPrimaryErrors) {
        return primary.authenticateDeviceToken(token);
      }

      try {
        return await primary.authenticateDeviceToken(token);
      } catch {
        return fallback.authenticateDeviceToken(token);
      }
    },
  };
}

export function createDbDeviceAuthStore(db: Database): DeviceAuthStore {
  return {
    authenticateDeviceToken: async (token) => {
      const [device] = await db
        .select({
          workspaceId: devices.workspaceId,
          deviceId: devices.id,
        })
        .from(devices)
        .where(eq(devices.tokenHash, hashToken(token)))
        .limit(1);

      return device ?? null;
    },
  };
}
