const PAIR_WORD = /(^|[^a-z])(before|after)(?=$|[^a-z])/gi;

/** A path with its before/after word taken out, or null when it has none: history-before.png → history-.png. */
function pairKey(path: string): { key: string; side: "before" | "after" } | null {
  const matches = [...path.matchAll(PAIR_WORD)];
  const last = matches.at(-1);
  if (!last) return null;
  const at = last.index + last[1]!.length;
  return { key: path.slice(0, at) + path.slice(at + last[2]!.length), side: last[2]!.toLowerCase() as "before" | "after" };
}

/** The other half of a before/after pair among `candidates`: history-before.png ↔ history-after.png, before/x.png ↔ after/x.png. */
export function beforeAfterPartner(path: string, candidates: readonly string[]): { before: string; after: string } | null {
  const own = pairKey(path);
  if (!own) return null;
  const partner = candidates.find((candidate) => {
    const other = pairKey(candidate);
    return other !== null && other.key === own.key && other.side !== own.side;
  });
  if (!partner) return null;
  return own.side === "before" ? { before: path, after: partner } : { before: partner, after: path };
}

/**
 * Pixels that differ between two images, compared from the top-left corner: the after image dimmed, with each
 * changed pixel in `mark`. Pixels only one image has count as changed.
 */
export function pixelDiff(before: ImageData, after: ImageData, mark: [number, number, number]): { changed: number; total: number; image: ImageData } {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const out = new ImageData(width, height);
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const inBefore = x < before.width && y < before.height;
      const inAfter = x < after.width && y < after.height;
      const b = (y * before.width + x) * 4;
      const a = (y * after.width + x) * 4;
      const same = inBefore && inAfter
        && before.data[b] === after.data[a] && before.data[b + 1] === after.data[a + 1]
        && before.data[b + 2] === after.data[a + 2] && before.data[b + 3] === after.data[a + 3];
      if (same) {
        out.data[o] = after.data[a]! * 0.3;
        out.data[o + 1] = after.data[a + 1]! * 0.3;
        out.data[o + 2] = after.data[a + 2]! * 0.3;
      } else {
        changed += 1;
        [out.data[o], out.data[o + 1], out.data[o + 2]] = mark;
      }
      out.data[o + 3] = 255;
    }
  }
  return { changed, total: width * height, image: out };
}
