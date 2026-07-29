# Phase S3 API Boundary Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Alfred's unused browser-session authentication and human query
API while preserving public health checks and device-authenticated runner
ingest.

**Architecture:** Keep the existing Hono API, Postgres schema, bootstrap rows,
and Bearer device-token ingest path. Narrow `createApp()` so bootstrap and
device authentication run only for mounted ingest routes; allow every retired
browser route to fall through to Hono's default `404`. Delete the orphaned
auth/query modules, then align environment parsing, smoke checks, diagnostics,
Vercel rewrites, and documentation with the smaller boundary.

**Tech Stack:** TypeScript, Hono, Vitest, Zod, Node.js test runner, Vercel
configuration.

## Global Constraints

- Electron remains the only user client; S3 changes no desktop UI.
- Keep `GET /health`, `GET /api/health`, and the root metadata response public.
- Keep runner Bearer device-token authentication, scope checks, ingest schemas,
  hashing, idempotency, and `202` behavior unchanged.
- Keep bootstrap creation of the user, workspace, and runner device.
- Retired direct and `/api` alias routes return Hono's default `404`; do not add
  tombstones, redirects, compatibility handlers, or feature flags.
- Do not change `packages/db/src/schema.ts`, `drizzle/**`, or existing auth rows.
- Keep `sessions` and `oidc_identities` schema entries intact.
- Do not add dependencies or rename `ALFRED_ALLOW_DEV_AUTH` /
  `DEV_AUTH_ENABLED`.
- Do not deploy, mutate hosted environment variables, or run hosted smoke
  checks without separate authorization.
- Do not add source-text tests for dev-doctor, launcher tasks, README, or the
  environment example; verify those deletions with syntax checks, residue
  scans, and focused review.
- Use one focused commit per task.
- Run `pnpm verify` before the local implementation gate is accepted.

---

## File map

- `apps/api/src/app.ts` — surviving route mounts, root metadata, and
  ingest-scoped bootstrap gate.
- `apps/api/src/env.ts` — API runtime inputs after browser-auth removal.
- `apps/api/src/test/app.test.ts` — root, health, retired-route, bootstrap, and
  device-auth boundary regressions.
- `apps/api/src/test/env.test.ts` — local and hosted device-token fallback
  contract.
- `apps/api/src/routes/ingest.ts` and `apps/api/src/test/ingest.test.ts` —
  unchanged device-auth ingest implementation and positive/negative gate.
- `apps/api/src/auth/{auth modules}` — delete OIDC, cookies, and session stores;
  keep bootstrap, device auth, and token hashing.
- `apps/api/src/routes/{auth,runs,system}.ts` — delete retired HTTP surfaces.
- `apps/api/src/services/{runs-query-service,runner-status-service,system-status-store}.ts`
  — delete orphaned human-query services.
- `scripts/cloud-smoke.mjs` and `scripts/test/cloud-smoke.test.mjs` — public
  boundary plus runner-auth smoke modes.
- `scripts/dev-doctor.mjs` — process-level local diagnostics without a session
  cookie or system query.
- `scripts/launch-parallel-agents.mjs` — remove tasks that would recreate runs
  routes.
- `scripts/test/desktop-product-boundary.test.mjs` — existing Vercel deployment
  contract and desktop-only product regressions.
- `vercel.json` — surviving API rewrites only.
- `.env.example` and `README.md` — device-auth-only API contract.
- `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification.md`
  and the post-v1 roadmap — verification state and closeout.

### Task 1: Delete browser auth and human query runtime surfaces

**Findings:** 9, 10, 22

**Files:**
- Modify: `apps/api/src/app.ts:1-126`
- Modify: `apps/api/src/test/app.test.ts:1-340`
- Delete: `apps/api/src/auth/cookies.ts`
- Delete: `apps/api/src/auth/oidc-auth.ts`
- Delete: `apps/api/src/auth/session-auth.ts`
- Delete: `apps/api/src/routes/auth.ts`
- Delete: `apps/api/src/routes/runs.ts`
- Delete: `apps/api/src/routes/system.ts`
- Delete: `apps/api/src/services/runs-query-service.ts`
- Delete: `apps/api/src/services/runner-status-service.ts`
- Delete: `apps/api/src/services/system-status-store.ts`
- Delete: `apps/api/src/test/oidc-auth.test.ts`
- Delete: `apps/api/src/test/runs.test.ts`
- Delete: `apps/api/src/test/system-status.test.ts`
- Verify unchanged: `apps/api/src/routes/ingest.ts`
- Verify unchanged: `apps/api/src/test/ingest.test.ts`

**Interfaces:**
- Consumes: `seedBootstrapAuth(db, config)`,
  `createDbDeviceAuthStore(db)`, `createFallbackDeviceAuthStore(...)`,
  `createStaticDeviceAuthStore(...)`, `healthRoutes`, and
  `createIngestRoutes(db, deviceAuthStore)`.
- Produces: `createApp()` with public root/health, direct and alias ingest, and
  default `404` responses for all retired paths.
- Preserves: the existing retryable `createBootstrapAuthGate()` contract.

- [ ] **Step 1: Replace browser-route expectations with the retired boundary**

Remove the runs/auth/system fixtures and imports from `app.test.ts`. Change the
root expectation to:

```ts
await expect(res.json()).resolves.toEqual({
  ok: true,
  service: "alfred-api",
  endpoints: {
    health: "/health",
    heartbeat: "/v1/ingest/heartbeat",
    batches: "/v1/ingest/batches",
  },
});
```

Add one table that covers every retired direct and alias route, using `POST`
for the old logout handlers:

```ts
const retiredRoutes = [
  { method: "GET", path: "/auth/login" },
  { method: "GET", path: "/auth/callback" },
  { method: "POST", path: "/auth/logout" },
  { method: "GET", path: "/api/auth/login" },
  { method: "GET", path: "/api/auth/callback" },
  { method: "POST", path: "/api/auth/logout" },
  { method: "GET", path: "/v1/runs" },
  { method: "GET", path: "/v1/runs/retired-run" },
  { method: "GET", path: "/api/v1/runs" },
  { method: "GET", path: "/api/v1/runs/retired-run" },
  { method: "GET", path: "/v1/system/status" },
  { method: "GET", path: "/api/v1/system/status" },
] as const;

it.each(retiredRoutes)("$method $path returns the default 404", async ({ method, path }) => {
  const response = await createApp().request(path, { method });
  expect(response.status).toBe(404);
});
```

Keep an explicit mount regression for both surviving heartbeat routes:

```ts
it.each([
  "/v1/ingest/heartbeat",
  "/api/v1/ingest/heartbeat",
])("%s requires a device token", async (path) => {
  const response = await createApp().request(path, { method: "POST" });
  expect(response.status).toBe(401);
});
```

Update the bootstrap-failure regression so `/`, health, and a retired route do
not invoke bootstrap, while ingest does:

```ts
const root = await app.request("/");
const health = await app.request("/health");
const retired = await app.request("/auth/login");
const ingest = await app.request("/api/v1/ingest/heartbeat", { method: "POST" });

expect(root.status).toBe(200);
expect(health.status).toBe(200);
expect(retired.status).toBe(404);
expect(ingest.status).toBeGreaterThanOrEqual(500);
expect(bootstrapAuthMock.seedBootstrapAuth).toHaveBeenCalledTimes(1);
```

Update the bootstrap retry test to request
`POST /api/v1/ingest/heartbeat` twice. Expect the first response to be `5xx`,
the second to be `401` because bootstrap recovered but no Bearer token was
provided, and the seed mock to have two calls.

- [ ] **Step 2: Run the boundary test and verify it fails**

```bash
pnpm --filter @alfred/api test -- app.test.ts
```

Expected: FAIL because root metadata still advertises runs, retired routes are
mounted, and the global bootstrap middleware still runs before unknown routes.

- [ ] **Step 3: Narrow `createApp()` to health and ingest**

Remove every session, OIDC, runs, system, and system-status import and
construction from `app.ts`. Keep the current device store selection.

Replace the root metadata with the exact object from Step 1. Mount health as it
is today. Mount only ingest beneath both version prefixes:

```ts
for (const prefix of ["/v1", "/api/v1"]) {
  app.use(`${prefix}/ingest/*`, async (_c, next) => {
    await ensureBootstrapAuth();
    await next();
  });
  app.route(`${prefix}/ingest`, createIngestRoutes(db, deviceAuthStore));
}
```

Delete the global `app.use("*", ...)` middleware and
`isLivenessPath()`. This makes root, health, and unknown retired paths
independent of bootstrap while preserving bootstrap before every surviving
ingest handler.

- [ ] **Step 4: Delete the orphaned runtime and dedicated tests**

Delete exactly the files listed in this task. Do not delete
`bootstrap-auth.ts`, `device-auth.ts`, `token-hash.ts`, ingest routes/services,
or any database schema/migration file.

- [ ] **Step 5: Run the API boundary and ingest regressions**

```bash
pnpm --filter @alfred/api test -- app.test.ts ingest.test.ts
pnpm --filter @alfred/api typecheck
pnpm --filter @alfred/api build
```

Expected: PASS. The ingest suite must still prove valid heartbeat/batch `202`,
missing token `401`, and scope mismatch `403`.

- [ ] **Step 6: Confirm no deleted runtime imports remain**

```bash
if rg -n 'auth/(cookies|oidc-auth|session-auth)|routes/(auth|runs|system)|services/(runs-query-service|runner-status-service|system-status-store)' apps/api/src; then
  echo "retired runtime import remains"
  exit 1
fi
```

Expected: exit `0` with no matches.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "refactor(api): remove browser auth and query routes"
```

### Task 2: Reduce API configuration to device authentication

**Findings:** 9, 10

**Files:**
- Modify: `apps/api/src/env.ts:1-82`
- Modify: `apps/api/src/test/env.test.ts:1-43`

**Interfaces:**
- Consumes: `ALFRED_ALLOW_DEV_AUTH` / `DEV_AUTH_ENABLED` as the existing local
  static device-token fallback switch.
- Produces: `parseApiEnv(input)` without `AUTH_OIDC_ISSUER`,
  `AUTH_OIDC_CLIENT_ID`, `AUTH_OIDC_CLIENT_SECRET`,
  `AUTH_DEV_SESSION_TOKEN`, or `APP_BASE_URL`.
- Preserves: hosted rejection of the built-in `dev-device-token`.

- [ ] **Step 1: Rewrite environment regressions**

Keep a local-default test that expects:

```ts
expect(parseApiEnv({ ALFRED_ALLOW_DEV_AUTH: "1" })).toMatchObject({
  DEV_AUTH_ENABLED: true,
  RUNNER_DEVICE_TOKEN: "dev-device-token",
});
```

Change the hosted-default test to expect a `RUNNER_DEVICE_TOKEN` error. Add a
hosted explicit-token test which passes all retired browser variables as input,
then proves they are ignored:

```ts
const parsed = parseApiEnv({
  ALFRED_ALLOW_DEV_AUTH: "1",
  APP_BASE_URL: "https://alfred.example.test",
  AUTH_DEV_SESSION_TOKEN: "retired-session-token",
  AUTH_OIDC_CLIENT_ID: "retired-client",
  AUTH_OIDC_CLIENT_SECRET: "retired-secret",
  AUTH_OIDC_ISSUER: "https://idp.example.test",
  NODE_ENV: "production",
  RUNNER_DEVICE_TOKEN: "preview-device-token",
});

expect(parsed).toMatchObject({
  DEV_AUTH_ENABLED: true,
  RUNNER_DEVICE_TOKEN: "preview-device-token",
});
for (const key of [
  "APP_BASE_URL",
  "AUTH_DEV_SESSION_TOKEN",
  "AUTH_OIDC_CLIENT_ID",
  "AUTH_OIDC_CLIENT_SECRET",
  "AUTH_OIDC_ISSUER",
]) {
  expect(parsed).not.toHaveProperty(key);
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
pnpm --filter @alfred/api test -- env.test.ts
```

Expected: FAIL because the schema still returns browser-auth fields and hosted
validation still requires an explicit session token.

- [ ] **Step 3: Remove browser-only environment fields**

Delete `DEFAULT_AUTH_DEV_SESSION_TOKEN` and the five retired fields from
`createEnvSchema()`. Remove the hosted session-token guard. Keep only:

```ts
const hostedDevAuth = parsed.DEV_AUTH_ENABLED && isHostedRuntime(input);

if (hostedDevAuth && parsed.RUNNER_DEVICE_TOKEN === DEFAULT_RUNNER_DEVICE_TOKEN) {
  throw new Error(
    "RUNNER_DEVICE_TOKEN must be explicitly set when dev auth is enabled in hosted runtime",
  );
}
```

Do not rename the existing flags in this phase.

- [ ] **Step 4: Run API checks**

```bash
pnpm --filter @alfred/api test
pnpm --filter @alfred/api typecheck
pnpm --filter @alfred/api build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/env.ts apps/api/src/test/env.test.ts
git commit -m "refactor(api): remove browser auth configuration"
```

### Task 3: Make cloud smoke verify the surviving API boundary

**Findings:** 9, 10, 22

**Files:**
- Modify: `scripts/cloud-smoke.mjs:1-158`
- Modify: `scripts/test/cloud-smoke.test.mjs:1-190`

**Interfaces:**
- Consumes: `ALFRED_CLOUD_URL`,
  optional `VERCEL_AUTOMATION_BYPASS_SECRET`, and runner credentials in
  `runner-auth` mode.
- Produces: exactly two modes, `public` and `runner-auth`.
- Public mode verifies health plus `404` for every retired direct and alias
  route; runner mode keeps its heartbeat and synthetic batch checks.

- [ ] **Step 1: Replace session-mode tests with boundary tests**

Rewrite the first cloud-smoke test so its HTTP server returns health for
`/health` and `404` for all other paths. Pass retired session variables in the
child environment to prove they have no effect, and assert the requests equal:

```js
[
  ["GET", "/health"],
  ["GET", "/auth/login"],
  ["GET", "/auth/callback"],
  ["POST", "/auth/logout"],
  ["GET", "/api/auth/login"],
  ["GET", "/api/auth/callback"],
  ["POST", "/api/auth/logout"],
  ["GET", "/v1/runs"],
  ["GET", "/v1/runs/retired-run"],
  ["GET", "/api/v1/runs"],
  ["GET", "/api/v1/runs/retired-run"],
  ["GET", "/v1/system/status"],
  ["GET", "/api/v1/system/status"],
]
```

Assert no request carries a cookie. Replace the old authenticated-route test
with:

```js
const result = await runSmoke({
  env: { ALFRED_CLOUD_SMOKE_MODE: "authenticated" },
  handler: async (_req, res) => send(res, 500, "text/plain", "unexpected"),
});

assert.equal(result.code, 1);
assert.match(
  result.stderr,
  /ALFRED_CLOUD_SMOKE_MODE must be public or runner-auth/,
);
```

Keep both runner-auth tests unchanged.

- [ ] **Step 2: Run the script test and verify it fails**

```bash
node --test scripts/test/cloud-smoke.test.mjs
```

Expected: FAIL because public mode still probes login readiness and
`authenticated` remains accepted.

- [ ] **Step 3: Replace browser checks with negative route checks**

Allow only:

```js
if (!["public", "runner-auth"].includes(mode)) {
  console.error("ALFRED_CLOUD_SMOKE_MODE must be public or runner-auth");
  process.exit(1);
}
```

Remove `sessionToken`, `expectedAuth`, authenticated-mode validation, cookie
headers, `validateAuth`, `validateSystemStatus`, and `validateRuns`.

Define the public checks with the same route/method table from Step 1 and:

```js
function validateNotFound(response) {
  return response.status === 404;
}
```

Keep `validateHealth`, runner headers, runner batch construction, and Vercel
protection bypass behavior unchanged.

- [ ] **Step 4: Run cloud-smoke and script gates**

```bash
node --test scripts/test/cloud-smoke.test.mjs
pnpm test:scripts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/cloud-smoke.mjs scripts/test/cloud-smoke.test.mjs
git commit -m "test(api): smoke the device-only boundary"
```

### Task 4: Remove browser-query assumptions from local tooling

**Findings:** 10, 22

**Files:**
- Modify: `scripts/dev-doctor.mjs:151-205`
- Modify: `scripts/dev-doctor.mjs:561-681`
- Modify: `scripts/dev-doctor.mjs:722-753`
- Modify: `scripts/launch-parallel-agents.mjs:9-64`

**Interfaces:**
- Produces: a read-only dev doctor that checks the API health endpoint,
  local runner process, and desktop renderer without a session cookie.
- Produces: recovery copy pointing to `runner:service:doctor` and
  `runner:service:logs`.
- Removes: launcher tasks `api-run-filters` and `api-root-tests`.

- [ ] **Step 1: Verify the current scripts parse before deletion**

```bash
node --check scripts/dev-doctor.mjs
node --check scripts/launch-parallel-agents.mjs
```

Expected: both scripts parse. This task deletes obsolete configuration and
prompts; Patryk approved the no-new-text-test exception during plan pre-flight.

- [ ] **Step 2: Simplify dev-doctor**

From `loadConfig()`, remove `authDevSessionToken` and
`apiSystemStatusUrl`. Delete `checkRunnerStatus()` and its call from `main()`.
Delete `restartRunnerServiceAction()` once it has no caller.

Keep `checkRunnerProcess()`. Change `startRunnerAction()` to the exact recovery
copy:

```js
return "start foreground with `pnpm runner:local`; for the background service use `pnpm runner:service:doctor` and `pnpm runner:service:logs`";
```

Do not replace the deleted system query with another API route.

- [ ] **Step 3: Remove launcher tasks that recreate retired routes**

Delete only the `api-run-filters` and `api-root-tests` task objects from
`scripts/launch-parallel-agents.mjs`. Keep the remaining runner, diagnostics,
privacy, maintenance, and adapter tasks unchanged.

- [ ] **Step 4: Run syntax and existing script checks**

```bash
node --check scripts/dev-doctor.mjs
node --check scripts/launch-parallel-agents.mjs
pnpm test:scripts
```

Expected: PASS.

- [ ] **Step 5: Run the focused residue scan**

```bash
if rg -n 'AUTH_DEV_SESSION_TOKEN|API_SYSTEM_STATUS_URL|alfred_session|/api/v1/system/status' scripts/dev-doctor.mjs; then
  echo "retired browser diagnostic remains"
  exit 1
fi

if rg -n 'api-run-filters|api-root-tests|routes/runs|/api/v1/runs|/v1/runs' scripts/launch-parallel-agents.mjs; then
  echo "retired browser route task remains"
  exit 1
fi
```

Expected: both scans exit `0` with no matches.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-doctor.mjs scripts/launch-parallel-agents.mjs
git commit -m "refactor(tooling): remove browser API diagnostics"
```

### Task 5: Align Vercel and documentation with device-only API

**Findings:** 9, 10, 22

**Files:**
- Modify: `vercel.json:1-13`
- Modify: `.env.example:1-30`
- Modify: `README.md:31-174`
- Modify: `README.md:216-239`
- Modify: `scripts/test/desktop-product-boundary.test.mjs:24-106`

**Interfaces:**
- Produces: Vercel rewrites for `/api`, `/v1`, and `/health`, with no `/auth`
  rewrite.
- Produces: setup documentation for health and device-auth ingest only.
- Preserves: the local `ALFRED_ALLOW_DEV_AUTH=1` static device-token fallback
  and the existing runner service workflow.

- [ ] **Step 1: Tighten the executable Vercel routing contract**

Change the exact Vercel rewrite expectation to:

```js
rewrites: [
  { source: "/api/:path*", destination: "/api/:path*" },
  { source: "/v1/:path*", destination: "/api/v1/:path*" },
  { source: "/health", destination: "/api/health" },
],
```

Do not add tests that grep README or `.env.example`; they are human-facing
documentation, not executable behavior.

- [ ] **Step 2: Run the product-boundary test and verify it fails**

```bash
node --test scripts/test/desktop-product-boundary.test.mjs
```

Expected: FAIL because the auth rewrite still exists.

- [ ] **Step 3: Remove the Vercel auth rewrite**

Delete only:

```json
{ "source": "/auth/:path*", "destination": "/api/auth/:path*" }
```

Keep the API, versioned API, and health rewrites.

- [ ] **Step 4: Rewrite the environment example**

Delete `AUTH_DEV_SESSION_TOKEN` and `APP_BASE_URL`. Replace the `# API auth`
comment with:

```dotenv
# API bootstrap and device authentication
ALFRED_BOOTSTRAP_ADMIN_EMAIL=local@alfred.local
ALFRED_BOOTSTRAP_USER_ID=00000000-0000-4000-8000-000000000011
ALFRED_BOOTSTRAP_WORKSPACE_ID=00000000-0000-4000-8000-000000000001
```

Keep the runner workspace, device, and token values where they are; do not
duplicate them.

- [ ] **Step 5: Rewrite the API/cloud documentation**

Make the workspace map describe:

```text
apps/api/          Hono API for health and device-authenticated runner ingest
```

In `API and cloud sync`:

- keep the local start and health commands;
- state that `ALFRED_ALLOW_DEV_AUTH=1` enables only the local static runner
  device-token fallback and does not create a human session;
- remove the cookie and runs examples;
- document `/v1/ingest/heartbeat` and `/v1/ingest/batches` plus their `/api`
  aliases as Bearer device-token routes;
- list hosted `DATABASE_URL`, bootstrap IDs/email, and runner
  workspace/device/token inputs; omit all browser-auth inputs;
- show only these smoke commands:

```bash
ALFRED_CLOUD_URL=<prod-url> pnpm smoke:cloud

ALFRED_CLOUD_URL=<prod-url> \
RUNNER_DEVICE_TOKEN=<device-token> \
RUNNER_WORKSPACE_ID=<workspace-id> \
RUNNER_DEVICE_ID=<device-id> \
pnpm smoke:cloud:runner
```

Explain that public mode checks health and confirms retired browser routes are
`404`, while runner mode sends a heartbeat and synthetic ingest batch.

In `Local runner service`, replace the development-auth sentence with:

```text
`node scripts/dev-doctor.mjs` checks local processes and service health without
creating a browser session or querying runner data from the API.
```

- [ ] **Step 6: Run product-boundary and script checks**

```bash
node --test scripts/test/desktop-product-boundary.test.mjs scripts/test/cloud-smoke.test.mjs
pnpm test:scripts
```

Expected: PASS.

- [ ] **Step 7: Review documentation residue without adding prose tests**

```bash
if rg -n 'AUTH_OIDC_|AUTH_DEV_SESSION_TOKEN|APP_BASE_URL|ALFRED_EXPECT_AUTH|ALFRED_CLOUD_SMOKE_MODE=authenticated|/api/v1/runs|/v1/runs' README.md .env.example; then
  echo "retired browser API documentation remains"
  exit 1
fi
```

Expected: exit `0` with no matches.

- [ ] **Step 8: Confirm database files are untouched**

```bash
git diff --exit-code "$(git merge-base HEAD origin/main)"..HEAD -- packages/db/src/schema.ts drizzle
```

Expected: no output and exit `0`.

- [ ] **Step 9: Commit**

```bash
git add vercel.json .env.example README.md scripts/test/desktop-product-boundary.test.mjs
git commit -m "docs(api): describe the device-only boundary"
```

### Task 6: Verify the phase and record the rollout gate

**Findings:** 9, 10, 22

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification.md`
- Modify: `docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification-implementation-plan.md`
- Modify: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: Tasks 1-5 and their focused checks.
- Produces: a locally verified S3 checkpoint or, when separately authorized,
  a fully closed S3 phase.

- [x] **Step 1: Run the focused API and script gates**

```bash
pnpm --filter @alfred/api test
pnpm --filter @alfred/api typecheck
pnpm --filter @alfred/api build
pnpm test:scripts
```

Expected: PASS.

- [x] **Step 2: Run the security residue scan**

```bash
if rg -n 'AUTH_OIDC_|AUTH_DEV_SESSION_TOKEN|APP_BASE_URL|ALFRED_EXPECT_AUTH|alfred_session' apps/api/src scripts/*.mjs README.md .env.example vercel.json --glob '!apps/api/src/test/**'; then
  echo "retired browser API residue remains"
  exit 1
fi

if rg -n 'createAuthRoutes|createRunsRoutes|createSystemRoutes|requireSession|oidc-auth|session-auth|runs-query-service|runner-status-service|system-status-store' apps/api/src --glob '!apps/api/src/test/**'; then
  echo "retired browser runtime import remains"
  exit 1
fi
```

Expected: both scans exit `0` with no matches. Negative `404` probes and their
tests intentionally retain the retired URL strings. `packages/db/src/schema.ts`
and migrations are also excluded because inert auth tables remain in S3.

- [x] **Step 3: Run the full repository gate**

```bash
pnpm verify
```

Expected: lint, typecheck, tests, build, and Electron smoke all PASS.

- [x] **Step 4: Review the final diff against the approved contract**

```bash
git diff --check
git status --short
git diff --stat "$(git merge-base HEAD origin/main)"..HEAD
git diff --exit-code "$(git merge-base HEAD origin/main)"..HEAD -- packages/db/src/schema.ts drizzle
```

Confirm the diff contains no desktop UI change, database schema/migration
change, dependency addition, query replacement, redirect, tombstone, or
compatibility flag.

- [x] **Step 5: Record local verification without overstating rollout**

If hosted deployment has not been separately authorized:

- set the S3 spec status to `Implemented — hosted smoke pending`;
- set the roadmap S3 state to `Local gate complete — hosted smoke pending`;
- record the focused and full local commands with their passing counts;
- leave S4 unstarted.

If hosted deployment and smoke were separately authorized, require already
exported `ALFRED_CLOUD_URL`, `RUNNER_DEVICE_TOKEN`, `RUNNER_WORKSPACE_ID`, and
`RUNNER_DEVICE_ID`, then run:

```bash
pnpm smoke:cloud
pnpm smoke:cloud:runner
```

Only after both pass, set the S3 spec and roadmap state to `Complete` and make
S4 the next phase.

- [x] **Step 6: Mark completed plan checkboxes and commit the checkpoint**

```bash
git add docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification.md docs/superpowers/specs/2026-07-29-phase-s3-api-boundary-simplification-implementation-plan.md docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: record API boundary simplification gate"
```

Do not push without Patryk's explicit instruction.
