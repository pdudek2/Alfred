const UNSAFE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+-r?f\b|\brm\s+-fr\b|\brm\s+-r\s+-f\b|\brm\s+-f\s+-r\b/, reason: "rm -rf detected" },
  { re: /^sudo\b|\bsudo\s/, reason: "sudo invocation" },
  { re: /\bdropdb\b|drop\s+database\b/i, reason: "database drop" },
  { re: /chmod\s+-R\b/, reason: "recursive chmod" },
  { re: /\bmkfs|^dd\s+if=/, reason: "low-level disk operation" },
];

const SHELL_METACHARS = /[&;|<>`$()\s'"]/;

export function checkSafety(
  command: string,
  args: string[],
): { unsafe: true; reason: string } | { unsafe: false } {
  if (SHELL_METACHARS.test(command)) {
    return { unsafe: true, reason: "shell metacharacters in command (use single executable)" };
  }
  if (isForcePush(command, args)) {
    return { unsafe: true, reason: "git push --force" };
  }
  const fullLine = [command, ...args].join(" ");
  for (const { re, reason } of UNSAFE_PATTERNS) {
    if (re.test(fullLine)) return { unsafe: true, reason };
  }
  return { unsafe: false };
}

function isForcePush(command: string, args: string[]): boolean {
  return command === "git" && args[0] === "push" && args.some(isForcePushFlag);
}

function isForcePushFlag(arg: string): boolean {
  return arg === "-f" || arg === "--force" || arg.startsWith("--force-with-lease");
}
