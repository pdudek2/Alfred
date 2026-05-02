#!/usr/bin/env node

const baseUrl = process.env.ALFRED_CLOUD_URL;
const sessionToken = process.env.AUTH_DEV_SESSION_TOKEN;
const mode = process.env.ALFRED_CLOUD_SMOKE_MODE ?? (sessionToken ? "authenticated" : "public");
const expectedAuth = process.env.ALFRED_EXPECT_AUTH ?? "any";
const vercelProtectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseUrl) {
  console.error("ALFRED_CLOUD_URL is required");
  process.exit(1);
}

if (mode !== "public" && mode !== "authenticated") {
  console.error("ALFRED_CLOUD_SMOKE_MODE must be public or authenticated");
  process.exit(1);
}

if (!["any", "ready", "not-configured"].includes(expectedAuth)) {
  console.error("ALFRED_EXPECT_AUTH must be any, ready, or not-configured");
  process.exit(1);
}

if (mode === "authenticated" && !sessionToken) {
  console.error("AUTH_DEV_SESSION_TOKEN is required for authenticated cloud smoke");
  process.exit(1);
}

const checks =
  mode === "authenticated"
    ? [
        ["root", "/", validateRoot],
        ["health", "/health", validateHealth],
        ["system", "/api/v1/system/status", validateSystemStatus],
        ["runs", "/api/v1/runs?limit=1", validateRuns],
      ]
    : [
        ["root", "/", validateRoot],
        ["health", "/health", validateHealth],
        ["auth", "/auth/login", validateAuth],
      ];

let failed = false;

for (const [name, path, validate] of checks) {
  const headers = {
    ...(sessionToken ? { cookie: `alfred_session=${sessionToken}` } : {}),
    ...(vercelProtectionBypass ? { "x-vercel-protection-bypass": vercelProtectionBypass } : {}),
  };

  try {
    const response = await fetch(new URL(path, baseUrl), { headers, redirect: "manual" });
    const body = await response.text();
    const result = validate(response, body);
    const ok = result === true || result === "warn";
    const label = result === "warn" ? "WARN" : ok ? "PASS" : "FAIL";
    console.log(`${label} ${name}: ${response.status}`);
    if (!ok) {
      failed = true;
      console.error(body.slice(0, 500));
    }
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ERROR`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

process.exit(failed ? 1 : 0);

function validateRoot(response, body) {
  if (!response.ok) return false;
  const headers = response.headers;
  return contentType(headers).includes("text/html") && body.includes("Alfred") && !body.includes("Deployment has failed");
}

function validateHealth(response, body) {
  if (!response.ok) return false;
  const headers = response.headers;
  const json = parseJson(body, headers);
  return json?.ok === true && json?.service === "alfred-api";
}

function validateAuth(response, body) {
  if (response.status === 302 || response.status === 303) {
    return expectedAuth !== "not-configured" && Boolean(response.headers.get("location"));
  }

  const json = parseJson(body, response.headers);
  if (response.status === 503 && json?.error === "oidc_not_configured") {
    if (expectedAuth === "ready") return false;
    if (expectedAuth === "not-configured") return true;
    return "warn";
  }

  return false;
}

function validateSystemStatus(response, body) {
  if (!response.ok) return false;
  const headers = response.headers;
  const json = parseJson(body, headers);
  return typeof json?.runner?.state === "string";
}

function validateRuns(response, body) {
  if (!response.ok) return false;
  const headers = response.headers;
  const json = parseJson(body, headers);
  return Array.isArray(json?.items);
}

function parseJson(body, headers) {
  if (!contentType(headers).includes("application/json")) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function contentType(headers) {
  return headers.get("content-type") ?? "";
}
