/**
 * `run` for one key at a time: a call while that key's run is in progress makes it run once more afterwards,
 * however many calls came in meanwhile, so the last call is never lost and never doubled.
 */
export function runAgainWhileBusy<Key extends object>(run: (key: Key) => Promise<void>): (key: Key) => Promise<void> {
  const busy = new WeakMap<Key, { again: boolean; done: Promise<void> }>();
  const start = (key: Key): Promise<void> => {
    const state = { again: false, done: Promise.resolve() };
    state.done = (async () => {
      do {
        state.again = false;
        await run(key).catch(() => undefined);
      } while (state.again);
      busy.delete(key);
    })();
    busy.set(key, state);
    return state.done;
  };
  return (key) => {
    const running = busy.get(key);
    if (!running) return start(key);
    running.again = true;
    return running.done;
  };
}
