export type EvidenceDisplay = {
  id: number;
  scaleFactor: number;
  workArea: { x: number; y: number; width: number; height: number };
};

export type EvidenceWindowBounds = { x: number; y: number; width: number; height: number };

export function windowBoundsExpectation(
  requestedBounds: EvidenceWindowBounds,
  strictPlacement: boolean,
): EvidenceWindowBounds | Pick<EvidenceWindowBounds, "width" | "height"> {
  return strictPlacement
    ? requestedBounds
    : { width: requestedBounds.width, height: requestedBounds.height };
}

export function selectDisplayBounds(
  displays: EvidenceDisplay[],
  targetScaleFactor: number,
  requestedSize: { width: number; height: number },
): { displayId: number; bounds: EvidenceWindowBounds } {
  if (!Number.isFinite(targetScaleFactor) || targetScaleFactor <= 0) {
    throw new Error(`Invalid target scale factor: ${targetScaleFactor}`);
  }

  const display = displays
    .filter((candidate) =>
      candidate.scaleFactor === targetScaleFactor
      && candidate.workArea.width >= requestedSize.width
      && candidate.workArea.height >= requestedSize.height)
    .sort((left, right) => left.id - right.id)[0];

  if (!display) {
    const inventory = displays
      .map((candidate) =>
        `id=${candidate.id} scaleFactor=${candidate.scaleFactor} workArea=${candidate.workArea.width}x${candidate.workArea.height}`)
      .join(", ");
    throw new Error(
      `No display with scaleFactor ${targetScaleFactor} can contain a ${requestedSize.width}x${requestedSize.height} window. Available displays: ${inventory || "none"}`,
    );
  }

  return {
    displayId: display.id,
    bounds: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: requestedSize.width,
      height: requestedSize.height,
    },
  };
}
