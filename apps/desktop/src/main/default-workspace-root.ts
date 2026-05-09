import path from "node:path";

export type DefaultWorkspaceRootEnv = {
  ALFRED_DESKTOP_WORKSPACE_CWD?: string | undefined;
  INIT_CWD?: string | undefined;
};

export function resolveDefaultWorkspaceRootPath(
  appPath: string,
  env: DefaultWorkspaceRootEnv = process.env,
): string {
  const configuredWorkspaceCwd = env.ALFRED_DESKTOP_WORKSPACE_CWD?.trim();
  if (configuredWorkspaceCwd) return path.resolve(configuredWorkspaceCwd);

  const initCwd = env.INIT_CWD?.trim();
  if (initCwd) return path.resolve(initCwd);

  return path.resolve(appPath, "../..");
}
