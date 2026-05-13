import type { SessionTile } from "./session-state";

export type RelaunchSafety =
  | { safe: true }
  | { safe: false; reason: string };

const MUTATING_COMMANDS = new Set(["mv", "rm", "rmdir", "cp", "rsync", "chmod", "chown", "dd", "mkfs"]);
const SHELL_COMMANDS = new Set(["bash", "fish", "sh", "zsh"]);

export function sessionRelaunchSafety(
  session: Pick<SessionTile, "agentKind" | "args" | "command" | "source">,
): RelaunchSafety {
  const command = session.command?.trim();
  const args = session.args ?? [];

  if (!command) return { safe: true };
  if (session.agentKind === "codex" || session.agentKind === "claude") return { safe: true };
  if (command === "codex" || command === "claude") return { safe: true };

  const executable = command.split("/").at(-1) ?? command;
  const fullLine = [command, ...args].join(" ");

  if (isForcePush(command, args)) {
    return { safe: false, reason: "git push --force would be replayed" };
  }

  if (/\bsudo\b/.test(fullLine)) {
    return { safe: false, reason: "sudo command would be replayed" };
  }

  if (/\bdropdb\b|drop\s+database\b/i.test(fullLine)) {
    return { safe: false, reason: "database drop command would be replayed" };
  }

  if (/\bfind\b[\s\S]*\s-exec\s+(?:rm|mv|cp|chmod|chown)\b/.test(fullLine)) {
    return { safe: false, reason: "find -exec mutates files when replayed" };
  }

  if (/\brsync\b[\s\S]*\s--delete\b/.test(fullLine)) {
    return { safe: false, reason: "rsync --delete would be replayed" };
  }

  if (/\brm\s+-r?f\b|\brm\s+-fr\b|\brm\s+-r\s+-f\b|\brm\s+-f\s+-r\b/.test(fullLine)) {
    return { safe: false, reason: "rm -rf would be replayed" };
  }

  if ((executable === "chmod" || executable === "chown") && args.includes("-R")) {
    return { safe: false, reason: `${executable} -R would be replayed` };
  }

  if (MUTATING_COMMANDS.has(executable)) {
    return { safe: false, reason: `${executable} command mutates files when replayed` };
  }

  if (SHELL_COMMANDS.has(executable) && args.length > 0) {
    return { safe: false, reason: "shell command replay needs review" };
  }

  return { safe: true };
}

export function relaunchNeedsReview(session: Pick<SessionTile, "agentKind" | "args" | "command" | "source">): boolean {
  return !sessionRelaunchSafety(session).safe;
}

function isForcePush(command: string, args: string[]): boolean {
  return command === "git" && args[0] === "push" && args.some(isForcePushFlag);
}

function isForcePushFlag(arg: string): boolean {
  return arg === "-f" || arg === "--force" || arg.startsWith("--force-with-lease");
}
