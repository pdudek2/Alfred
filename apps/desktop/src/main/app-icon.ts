import { existsSync } from "node:fs";
import path from "node:path";

export const DESKTOP_APP_ICON_RELATIVE_PATH = path.join("assets", "alfred-icon.png");

export function resolveDesktopAppIconPath(appPath: string): string | undefined {
  const iconPath = path.join(appPath, DESKTOP_APP_ICON_RELATIVE_PATH);
  return existsSync(iconPath) ? iconPath : undefined;
}
