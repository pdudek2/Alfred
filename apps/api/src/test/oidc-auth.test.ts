import { oidcIdentities, sessions, users, workspaces } from "@alfred/db";
import { describe, expect, it, vi } from "vitest";
import { completeOidcLogin, type ConfiguredOidcConfig } from "../auth/oidc-auth";

const oidcConfig: ConfiguredOidcConfig = {
  appBaseUrl: "https://alfred.example.test",
  bootstrapWorkspaceId: "workspace-bootstrap",
  clientId: "alfred-client",
  clientSecret: "alfred-secret",
  issuer: "https://idp.example.test",
};

describe("completeOidcLogin", () => {
  it("uses the canonical user id when a new OIDC identity matches an existing email", async () => {
    const db = createOidcDb({
      users: [{ id: "user-existing", email: "patryk@example.test", displayName: "Patryk" }],
      workspaces: [{ id: "workspace-existing", ownerUserId: "user-existing" }],
    });
    const fetchImpl = createOidcFetch({
      userInfo: {
        sub: "idp-subject",
        email: "patryk@example.test",
        email_verified: true,
        name: "Patryk Updated",
      },
    });

    await expect(completeOidcLogin(db.db, oidcConfig, "auth-code", fetchImpl)).resolves.toEqual(expect.any(String));

    expect(db.state.users).toEqual([
      { id: "user-existing", email: "patryk@example.test", displayName: "Patryk Updated" },
    ]);
    expect(db.state.identities).toEqual([
      expect.objectContaining({
        userId: "user-existing",
        issuer: oidcConfig.issuer,
        subject: "idp-subject",
        email: "patryk@example.test",
        emailVerified: true,
      }),
    ]);
    expect(db.state.sessions).toEqual([
      expect.objectContaining({
        userId: "user-existing",
        workspaceId: "workspace-existing",
      }),
    ]);
  });

  it("does not trust an id_token fallback without a verified userinfo response", async () => {
    const db = createOidcDb();
    const fetchImpl = createOidcFetch({
      discovery: { userinfo_endpoint: undefined },
      token: {
        id_token: unsignedJwtPayload({
          sub: "idp-subject",
          email: "patryk@example.test",
        }),
      },
    });

    await expect(completeOidcLogin(db.db, oidcConfig, "auth-code", fetchImpl)).rejects.toThrow(
      "OIDC discovery is missing userinfo endpoint",
    );
    expect(db.state.identities).toEqual([]);
    expect(db.state.sessions).toEqual([]);
  });
});

type UserRow = {
  id: string;
  email: string;
  displayName: string;
};

type WorkspaceRow = {
  id: string;
  ownerUserId: string;
};

type OidcIdentityRow = {
  userId: string;
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  claims: Record<string, unknown>;
};

type SessionRow = {
  userId: string;
  workspaceId: string;
  sessionTokenHash: string;
  expiresAt: Date;
};

function createOidcDb(seed: { users?: UserRow[]; workspaces?: WorkspaceRow[]; identities?: OidcIdentityRow[] } = {}) {
  const state = {
    users: [...(seed.users ?? [])],
    workspaces: [...(seed.workspaces ?? [])],
    identities: [...(seed.identities ?? [])],
    sessions: [] as SessionRow[],
  };

  return {
    state,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === oidcIdentities) {
                return state.identities.map((identity) => ({ userId: identity.userId })).slice(0, 1);
              }
              if (table === workspaces) {
                return state.workspaces.map((workspace) => ({ id: workspace.id })).slice(0, 1);
              }
              if (table === users) {
                return state.users.map((user) => ({ id: user.id })).slice(0, 1);
              }
              return [];
            },
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (patch: Partial<UserRow>) => ({
          where: async () => {
            if (table !== users) return;
            const user = state.users[0];
            if (!user) return;
            if (patch.email !== undefined) user.email = patch.email;
            if (patch.displayName !== undefined) user.displayName = patch.displayName;
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (value: Record<string, unknown>) => {
          if (table === users) {
            return {
              onConflictDoUpdate: () => ({
                returning: async () => {
                  const existing = state.users.find((user) => user.email === value.email);
                  if (existing) {
                    existing.displayName = String(value.displayName);
                    return [{ id: existing.id }];
                  }

                  state.users.push({
                    id: String(value.id),
                    email: String(value.email),
                    displayName: String(value.displayName),
                  });
                  return [{ id: String(value.id) }];
                },
              }),
            };
          }

          if (table === oidcIdentities) {
            return {
              onConflictDoUpdate: async () => {
                const existing = state.identities.find(
                  (identity) => identity.issuer === value.issuer && identity.subject === value.subject,
                );
                const identity = {
                  userId: String(value.userId),
                  issuer: String(value.issuer),
                  subject: String(value.subject),
                  email: typeof value.email === "string" ? value.email : null,
                  emailVerified: Boolean(value.emailVerified),
                  claims: value.claims as Record<string, unknown>,
                };
                if (existing) {
                  Object.assign(existing, identity);
                } else {
                  state.identities.push(identity);
                }
              },
            };
          }

          if (table === sessions) {
            state.sessions.push({
              userId: String(value.userId),
              workspaceId: String(value.workspaceId),
              sessionTokenHash: String(value.sessionTokenHash),
              expiresAt: value.expiresAt as Date,
            });
            return Promise.resolve();
          }

          return Promise.resolve();
        },
      }),
    } as unknown as Parameters<typeof completeOidcLogin>[0],
  };
}

function createOidcFetch({
  discovery = {},
  token = { access_token: "access-token" },
  userInfo = { sub: "idp-subject", email: "patryk@example.test" },
}: {
  discovery?: { userinfo_endpoint?: string | undefined };
  token?: Record<string, unknown>;
  userInfo?: Record<string, unknown>;
} = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return jsonResponse({
        authorization_endpoint: "https://idp.example.test/authorize",
        token_endpoint: "https://idp.example.test/token",
        userinfo_endpoint: "https://idp.example.test/userinfo",
        ...discovery,
      });
    }
    if (url === "https://idp.example.test/token") return jsonResponse(token);
    if (url === "https://idp.example.test/userinfo") return jsonResponse(userInfo);
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function unsignedJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "",
  ].join(".");
}
