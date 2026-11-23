import type { AgentKind } from "./alfred-ipc.js";

type AgentCommandInput = {
  agentKind?: AgentKind;
  kind?: AgentKind;
  command: string;
  args?: string[];
};

export function normalizeAgentCommand<T extends AgentCommandInput>(input: T): T {
  const agentKind = input.kind ?? input.agentKind;
  if ((agentKind !== "codex" && agentKind !== "claude") || input.command.trim() !== agentKind) {
    return input;
  }

  const args = input.args ?? [];
  const normalizedArgs = normalizeUnsupportedPromptFlag(args);
  if (normalizedArgs === args) {
    return input;
  }

  return { ...input, args: normalizedArgs };
}

function normalizeUnsupportedPromptFlag(args: string[]): string[] {
  let changed = false;
  const normalized: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--") {
      normalized.push(...args.slice(index));
      break;
    }

    if (arg === "--prompt") {
      changed = true;
      const prompt = args[index + 1];
      if (typeof prompt === "string" && prompt.length > 0) {
        normalized.push(prompt);
        index += 1;
      }
      continue;
    }

    if (arg?.startsWith("--prompt=")) {
      changed = true;
      const prompt = arg.slice("--prompt=".length);
      if (prompt.length > 0) {
        normalized.push(prompt);
      }
      continue;
    }

    normalized.push(arg);
  }

  return changed ? normalized : args;
}

export const DEEPSEEK_MODEL = "deepseek-flash[1m]";

/** A `claude` session on a DeepSeek model: Alfred points it at DeepSeek's Anthropic-compatible API. */
export function isDeepSeekLaunch(command: string | undefined, args: readonly string[] = []): boolean {
  if (command !== "claude") return false;
  const end = args.indexOf("--");
  const flags = end === -1 ? args : args.slice(0, end);
  const model = flags.indexOf("--model");
  return model !== -1 && flags[model + 1]?.startsWith("deepseek-") === true;
}
