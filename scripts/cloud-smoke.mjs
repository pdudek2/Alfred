#!/usr/bin/env node

const baseUrl = process.env.ALFRED_CLOUD_URL;
const sessionToken = process.env.AUTH_DEV_SESSION_TOKEN;
const vercelProtectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseUrl) {
  console.error("ALFRED_CLOUD_URL is required");
  process.exit(1);
}

const checks = [
  ["root", "/"],
  ["health", "/api/health"],
  ["system", "/api/v1/system/status"],
  ["runs", "/api/v1/runs?limit=1"],
];

let failed = false;

for (const [name, path] of checks) {
  const headers = {
    ...(sessionToken ? { cookie: `alfred_session=${sessionToken}` } : {}),
    ...(vercelProtectionBypass ? { "x-vercel-protection-bypass": vercelProtectionBypass } : {}),
  };

  try {
    const response = await fetch(new URL(path, baseUrl), { headers });
    const ok = response.ok;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${response.status}`);
    if (!ok) {
      failed = true;
    }
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ERROR`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

process.exit(failed ? 1 : 0);
