#!/usr/bin/env node

const baseUrl = process.env.ALFRED_CLOUD_URL;
const sessionToken = process.env.AUTH_DEV_SESSION_TOKEN;
const vercelProtectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseUrl) {
  console.error("ALFRED_CLOUD_URL is required");
  process.exit(1);
}

const checks = [
  ["root", "/", validateRoot],
  ["health", "/api/health", validateHealth],
  ["system", "/api/v1/system/status", validateSystemStatus],
  ["runs", "/api/v1/runs?limit=1", validateRuns],
];

let failed = false;

for (const [name, path, validate] of checks) {
  const headers = {
    ...(sessionToken ? { cookie: `alfred_session=${sessionToken}` } : {}),
    ...(vercelProtectionBypass ? { "x-vercel-protection-bypass": vercelProtectionBypass } : {}),
  };

  try {
    const response = await fetch(new URL(path, baseUrl), { headers });
    const body = await response.text();
    const ok = response.ok && validate(body, response.headers);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${response.status}`);
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

function validateRoot(body, headers) {
  return contentType(headers).includes("text/html") && body.includes("Alfred") && !body.includes("Deployment has failed");
}

function validateHealth(body, headers) {
  const json = parseJson(body, headers);
  return json?.ok === true && json?.service === "alfred-api";
}

function validateSystemStatus(body, headers) {
  const json = parseJson(body, headers);
  return typeof json?.runner?.state === "string";
}

function validateRuns(body, headers) {
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
