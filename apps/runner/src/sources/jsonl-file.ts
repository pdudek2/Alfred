import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

export type JsonlScannedLine = {
  lineNumber: number;
  prefixHash: string;
  record?: unknown;
};

export async function* scanJsonlLines(
  path: string,
  onInvalidLine?: (lineNumber: number) => void,
): AsyncGenerator<JsonlScannedLine> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const hash = createHash("sha256");
  let buffer = "";
  let lineNumber = 0;

  const scanLine = (rawLine: string, reportInvalid = true): JsonlScannedLine => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const currentLineNumber = ++lineNumber;
    hash.update(`${line}\n`);
    const scannedLine = {
      lineNumber: currentLineNumber,
      prefixHash: hash.copy().digest("hex"),
    };

    if (!line.trim()) return scannedLine;

    try {
      return { ...scannedLine, record: JSON.parse(line) as unknown };
    } catch {
      if (reportInvalid) onInvalidLine?.(currentLineNumber);
      return scannedLine;
    }
  };

  try {
    for await (const chunk of stream) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex !== -1) {
        yield scanLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const tail = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    if (tail.trim()) {
      const scannedLine = scanLine(buffer, false);
      if ("record" in scannedLine) yield scannedLine;
    }
  } finally {
    stream.destroy();
  }
}
