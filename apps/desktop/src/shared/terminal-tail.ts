/**
 * The end of a terminal stream, at most `maxLength` long, starting where it reads cleanly: at a line or an escape
 * sequence. A cut inside a sequence would replay its rest ("1H", "38;5;180m") as text.
 */
export function terminalTail(stream: string, maxLength: number): string {
  if (stream.length <= maxLength) return stream;
  const tail = stream.slice(-maxLength);
  const line = tail.indexOf("\n");
  const escape = tail.indexOf("\u001b");
  const starts = [line === -1 ? -1 : line + 1, escape].filter((index) => index >= 0);
  return starts.length === 0 ? tail : tail.slice(Math.min(...starts));
}
