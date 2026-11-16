import { resolve } from "node:path";

export const DEV_ROOT_PATH = "/__alfred-desktop-root";

export function electronArguments(userDataDirectory) {
  const args = ["."];
  const directory = userDataDirectory?.trim();
  if (directory) args.push(`--user-data-dir=${directory}`);
  return args;
}

export async function devServerOwner(url, appDirectory) {
  let response;
  try {
    response = await fetch(new URL(DEV_ROOT_PATH, url));
  } catch {
    return "none";
  }
  if (!response.ok) return "other";
  return resolve(await response.text()) === resolve(appDirectory) ? "this checkout" : "other";
}
