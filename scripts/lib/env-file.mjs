import { readFile } from "node:fs/promises";

export async function readEnvFile(path) {
  const content = await readFile(path, "utf8");
  return parseEnvFileContent(content);
}

export function parseEnvFileContent(content) {
  const env = {};
  const lines = String(content).split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid env line ${lineNumber}: expected KEY=value`);
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env line ${lineNumber}: invalid key "${key}"`);
    }

    env[key] = stripQuotes(rawValue);
  });

  return env;
}

function stripQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
