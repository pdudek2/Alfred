import type { MiddlewareHandler } from "hono";

export function requireDeviceToken(expectedToken: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

    if (!token || token !== expectedToken) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
