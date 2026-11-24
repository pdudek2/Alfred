import { describe, expect, it } from "vitest";
import { beforeAfterPartner, pixelDiff } from "./file-compare";

describe("beforeAfterPartner", () => {
  it("pairs files whose names differ only by before and after, in a name or a folder", () => {
    const shots = ["/o/history-before.png", "/o/history-after.png", "/o/rail-after.png", "/o/before/x.png", "/o/after/x.png", "/o/beforehand.png"];
    expect(beforeAfterPartner("/o/history-after.png", shots)).toEqual({ before: "/o/history-before.png", after: "/o/history-after.png" });
    expect(beforeAfterPartner("/o/before/x.png", shots)).toEqual({ before: "/o/before/x.png", after: "/o/after/x.png" });
    expect(beforeAfterPartner("/o/rail-after.png", shots)).toBeNull();
    expect(beforeAfterPartner("/o/beforehand.png", shots)).toBeNull();
  });
});

describe("pixelDiff", () => {
  const image = (width: number, height: number, pixels: number[][]) =>
    ({ width, height, data: Uint8ClampedArray.from(pixels.flat()) }) as unknown as ImageData;

  it("marks pixels that differ, and those only the larger image has", () => {
    (globalThis as { ImageData?: unknown }).ImageData ??= class {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
    };
    const before = image(2, 1, [[10, 10, 10, 255], [20, 20, 20, 255]]);
    const after = image(3, 1, [[10, 10, 10, 255], [99, 20, 20, 255], [5, 5, 5, 255]]);
    const diff = pixelDiff(before, after, [242, 139, 130]);
    expect(diff).toMatchObject({ changed: 2, total: 3 });
    expect([...diff.image.data.slice(4, 8)]).toEqual([242, 139, 130, 255]);
    expect([...diff.image.data.slice(0, 4)]).toEqual([3, 3, 3, 255]);
  });
});
