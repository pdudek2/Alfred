export type TerminalTailProjection = {
  sessionId: string;
  lines: string[];
  updatedAt: string | null;
  source: "xterm-projection";
};

export type TerminalTailSource = {
  rows: number;
  buffer: {
    active: {
      baseY: number;
      length: number;
      getLine(index: number): {
        translateToString(trimRight?: boolean): string;
      } | undefined;
    };
  };
};

export function projectTerminalTail(
  terminal: TerminalTailSource,
  sessionId: string,
  now = Date.now(),
  maxLines = 8,
): TerminalTailProjection {
  const buffer = terminal.buffer.active;
  const start = Math.max(0, buffer.baseY);
  const end = Math.min(buffer.length, start + terminal.rows);
  const visualLines: string[] = [];

  for (let index = start; index < end; index += 1) {
    const value = buffer.getLine(index)?.translateToString(true).trimEnd() ?? "";
    if (value.trim()) visualLines.push(value);
  }

  const lines = visualLines.slice(-Math.max(0, maxLines));
  return {
    sessionId,
    lines,
    updatedAt: lines.length > 0 ? new Date(now).toISOString() : null,
    source: "xterm-projection",
  };
}
