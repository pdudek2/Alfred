import { oidcIdentities, sessions, updatedAtNow, users, workspaces, type Database } from "@alfred/db";
import { and, eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { hashToken } from "./token-hash.js";

export type OidcConfig = {
  appBaseUrl: string;
  bootstrapWorkspaceId: string;
  callbackPath?: string;
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
};

export type ConfiguredOidcConfig = OidcConfig & Required<Pick<OidcConfig, "clientId" | "clientSecret" | "issuer">>;

type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
};

type VerifiedUserInfo = Required<Pick<UserInfo, "email" | "sub">> & UserInfo;

type UserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export function oidcConfigured(config: OidcConfig): config is ConfiguredOidcConfig {
  return Boolean(config.issuer && config.clientId && config.clientSecret);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function buildOidcLoginUrl(config: ConfiguredOidcConfig, state: string): Promise<string> {
  const discovery = await discoverOidc(config.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(config.appBaseUrl, config.callbackPath));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeOidcLogin(
  db: Database,
  config: ConfiguredOidcConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const discovery = await discoverOidc(config.issuer, fetchImpl);
  const token = await exchangeCode(discovery, config, code, fetchImpl);
  const userInfo = await readUserInfo(discovery, token, fetchImpl);

  const [existingIdentity] = await db
    .select({ userId: oidcIdentities.userId })
    .from(oidcIdentities)
    .where(and(eq(oidcIdentities.issuer, config.issuer), eq(oidcIdentities.subject, userInfo.sub)))
    .limit(1);

  const userId = await resolveOidcUserId(db, config.issuer, userInfo, existingIdentity?.userId);

  await db
    .insert(oidcIdentities)
    .values({
      userId,
      issuer: config.issuer,
      subject: userInfo.sub,
      email: userInfo.email,
      emailVerified: Boolean(userInfo.email_verified),
      claims: userInfo,
    })
    .onConflictDoUpdate({
      target: [oidcIdentities.issuer, oidcIdentities.subject],
      set: {
        userId,
        email: userInfo.email,
        emailVerified: Boolean(userInfo.email_verified),
        claims: userInfo,
        updatedAt: updatedAtNow,
      },
    });

  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId))
    .limit(1);

  const workspaceId = workspace?.id ?? config.bootstrapWorkspaceId;
  const sessionToken = createSessionToken();
  await db.insert(sessions).values({
    userId,
    workspaceId,
    sessionTokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  return sessionToken;
}

async function resolveOidcUserId(
  db: Database,
  issuer: string,
  userInfo: VerifiedUserInfo,
  existingIdentityUserId: string | undefined,
): Promise<string> {
  if (existingIdentityUserId) {
    await db
      .update(users)
      .set({
        email: userInfo.email,
        displayName: userInfo.name ?? userInfo.email,
        updatedAt: updatedAtNow,
      })
      .where(eq(users.id, existingIdentityUserId));
    return existingIdentityUserId;
  }

  const newUserId = randomUuid();
  const [upsertedUser] = await db
    .insert(users)
    .values({
      id: newUserId,
      email: userInfo.email,
      displayName: userInfo.name ?? userInfo.email,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        displayName: userInfo.name ?? userInfo.email,
        updatedAt: updatedAtNow,
      },
    })
    .returning({ id: users.id });

  if (upsertedUser) return upsertedUser.id;

  const [userByEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, userInfo.email))
    .limit(1);

  if (!userByEmail) {
    throw new Error(`Failed to resolve OIDC user for ${issuer}`);
  }

  return userByEmail.id;
}

async function discoverOidc(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcDiscovery> {
  const response = await fetchImpl(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error("Failed to load OIDC discovery");
  return (await response.json()) as OidcDiscovery;
}

async function exchangeCode(
  discovery: OidcDiscovery,
  config: ConfiguredOidcConfig,
  code: string,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(config.appBaseUrl, config.callbackPath),
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!response.ok) throw new Error("OIDC token exchange failed");
  return (await response.json()) as TokenResponse;
}

async function readUserInfo(
  discovery: OidcDiscovery,
  token: TokenResponse,
  fetchImpl: typeof fetch,
): Promise<VerifiedUserInfo> {
  if (!discovery.userinfo_endpoint) {
    throw new Error("OIDC discovery is missing userinfo endpoint");
  }
  if (!token.access_token) {
    throw new Error("OIDC token response has no access token for userinfo");
  }

  const response = await fetchImpl(discovery.userinfo_endpoint, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!response.ok) {
    throw new Error("OIDC userinfo request failed");
  }

  const userInfo = (await response.json()) as UserInfo;
  if (!userInfo.sub || !userInfo.email) {
    throw new Error("OIDC profile is missing subject or email");
  }
  return userInfo as VerifiedUserInfo;
}

function callbackUrl(appBaseUrl: string, callbackPath = "/auth/callback"): string {
  return new URL(callbackPath, appBaseUrl).toString();
}

function randomUuid(): string {
  return randomUUID();
}
