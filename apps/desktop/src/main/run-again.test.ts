import { describe, expect, it } from "vitest";
import { runAgainWhileBusy } from "./run-again";

/** A read that starts when called and finishes when the test says so. */
function controlledReads() {
  const finishers: Array<() => void> = [];
  const waiters: Array<() => void> = [];
  let count = 0;
  const read = async () => {
    count += 1;
    waiters.shift()?.();
    await new Promise<void>((finish) => finishers.push(finish));
  };
  return {
    read,
    count: () => count,
    finish: (index: number) => finishers[index]!(),
    nextStart: () => new Promise<void>((started) => waiters.push(started)),
  };
}

describe("runAgainWhileBusy", () => {
  it("runs once more after a run that was asked for again, and once more only", async () => {
    const reads = controlledReads();
    const read = runAgainWhileBusy(reads.read);
    const key = {};

    const first = read(key);
    expect(reads.count()).toBe(1);
    // The agent wrote again, twice, while the first read was going on.
    const second = read(key);
    const third = read(key);
    expect(reads.count()).toBe(1);

    const secondStart = reads.nextStart();
    reads.finish(0);
    await secondStart;
    expect(reads.count()).toBe(2);
    reads.finish(1);
    await Promise.all([first, second, third]);
    expect(reads.count()).toBe(2);

    // Idle again: the next call runs at once, and another key never waits on this one.
    void read(key);
    void read({});
    expect(reads.count()).toBe(4);
  });

  it("keeps going after a run that fails", async () => {
    let calls = 0;
    const read = runAgainWhileBusy(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transcript moved");
    });
    const key = {};
    const first = read(key);
    void read(key);
    await first;
    expect(calls).toBe(2);
  });
});
