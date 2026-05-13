import type { MiddlewareHandler } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, users, type Database } from "@alfred/db";
import { hashToken } from "./token-hash.js";
import { readCookie } from "./cookies.js";

export type AuthSession = {
  sessionId: string;
  userId: string;
  email: string;
  workspaceId: string;
};

export type AuthSessionStore = {
  getSession(token: string): Promise<AuthSession | null>;
};

export type AuthVariables = {
  auth: AuthSession;
};

const SESSION_COOKIE = "alfred_session";

export function requireSession(sessionStore: AuthSessionStore): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
    if (!token) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const session = await sessionStore.getSession(token);
    if (!session) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("auth", session);
    await next();
  };
}
export function createStaticSessionStore(
  expectedToken: string,
  session: Omit<AuthSession, "sessionId">,
): AuthSessionStore {
  return {
    getSession: async (token) =>
      token === expectedToken
        ? {
            sessionId: "static-session",
            ...session,
          }
        : null,
  };
}

export function createDbSessionStore(db: Database): AuthSessionStore {
  return {
    getSession: async (token) => {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          userId: sessions.userId,
          email: users.email,
          workspaceId: sessions.workspaceId,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(
          and(
            eq(sessions.sessionTokenHash, hashToken(token)),
            gt(sessions.expiresAt, new Date()),
            isNull(sessions.revokedAt),
          ),
        )
        .limit(1);

      return row ?? null;
    },
  };
}

export function createFallbackSessionStore(
  primary: AuthSessionStore,
  fallback: AuthSessionStore,
  catchPrimaryErrors = false,
): AuthSessionStore {
  return {
    getSession: async (token) => {
      if (!catchPrimaryErrors) {
        return (await primary.getSession(token)) ?? fallback.getSession(token);
      }

      try {
        const session = await primary.getSession(token);
        return session ?? fallback.getSession(token);
      } catch {
        return fallback.getSession(token);
      }
    },
  };
}
