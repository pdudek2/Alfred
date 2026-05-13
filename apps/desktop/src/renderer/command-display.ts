import type { SessionTile } from "./session-state";

export function formatCommand(session: SessionTile): string {
  const command = session.command?.trim();
  const args = session.args ?? [];
  if (!command) return "interactive shell";
  return [command, ...args].join(" ");
}
