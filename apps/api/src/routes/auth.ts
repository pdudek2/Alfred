import { type Database } from "@alfred/db";
import { Hono } from "hono";
import {
  completeOidcLogin,
  buildOidcLoginUrl,
  createSessionToken,
  oidcConfigured,
  type ConfiguredOidcConfig,
  type OidcConfig,
} from "../auth/oidc-auth.js";

const STATE_COOKIE = "alfred_oidc_state";
const SESSION_COOKIE = "alfred_session";

type AuthRouteOptions = {
  config: OidcConfig;
  callbackPath?: string;
  devAuth?: {
    enabled: boolean;
    sessionToken: string;
  };
};

export function createAuthRoutes(db: Database, options: AuthRouteOptions) {
  const authRoutes = new Hono();

  authRoutes.get("/login", async (c) => {
    if (!oidcConfigured(options.config)) {
      if (options.devAuth?.enabled) {
        setCookie(c.header.bind(c), SESSION_COOKIE, options.devAuth.sessionToken, {
          httpOnly: true,
          maxAge: 30 * 24 * 60 * 60,
          secure: options.config.appBaseUrl.startsWith("https://"),
        });
        return c.redirect("/", 302);
      }

      return c.json({ error: "oidc_not_configured" }, 503);
    }

    const state = createSessionToken();
    setCookie(c.header.bind(c), STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 600,
      secure: options.config.appBaseUrl.startsWith("https://"),
    });

    const redirectUrl = await buildOidcLoginUrl(configuredOidcConfig(options), state);
    return c.redirect(redirectUrl, 302);
  });

  authRoutes.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const expectedState = readCookie(c.req.header("cookie"), STATE_COOKIE);
    if (!code || !state || !expectedState || state !== expectedState) {
      return c.json({ error: "invalid_auth_callback" }, 400);
    }

    const sessionToken = await completeOidcLogin(db, configuredOidcConfig(options), code);
    setCookie(c.header.bind(c), SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60,
      secure: options.config.appBaseUrl.startsWith("https://"),
    });
    clearCookie(c.header.bind(c), STATE_COOKIE, options.config.appBaseUrl.startsWith("https://"));
    return c.redirect("/", 302);
  });

  authRoutes.post("/logout", (c) => {
    clearCookie(c.header.bind(c), SESSION_COOKIE, options.config.appBaseUrl.startsWith("https://"));
    return c.json({ ok: true });
  });

  return authRoutes;
}

function configuredOidcConfig(options: AuthRouteOptions): ConfiguredOidcConfig {
  if (!oidcConfigured(options.config)) {
    throw new Error("OIDC config is incomplete");
  }

  return {
    ...options.config,
    ...(options.callbackPath ? { callbackPath: options.callbackPath } : {}),
  };
}

function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function setCookie(
  setHeader: (name: string, value: string, options?: { append?: boolean }) => void,
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAge: number; secure: boolean },
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${options.maxAge}`,
    "SameSite=Lax",
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  setHeader("Set-Cookie", parts.join("; "), { append: true });
}

function clearCookie(
  setHeader: (name: string, value: string, options?: { append?: boolean }) => void,
  name: string,
  secure: boolean,
) {
  setCookie(setHeader, name, "", { httpOnly: true, maxAge: 0, secure });
}
