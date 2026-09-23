import assert from "node:assert/strict";
import test from "node:test";
import { checkRunnerNative } from "../check-runner-native.mjs";

test("native check opens and closes SQLite under Node 22", () => {
  let closed = false;
  checkRunnerNative({
    nodeVersion: "22.23.1",
    loadDatabase: () => class {
      prepare() { return { get: () => ({ ok: 1 }) }; }
      close() { closed = true; }
    },
  });
  assert.equal(closed, true);
});

test("native check rejects unsupported Node and a broken SQLite addon", () => {
  assert.throws(
    () => checkRunnerNative({ nodeVersion: "25.6.1", loadDatabase: () => { throw new Error("not reached"); } }),
    /require Node 22\.x/,
  );
  assert.throws(
    () => checkRunnerNative({ nodeVersion: "22.23.1", loadDatabase: () => { throw new Error("NODE_MODULE_VERSION mismatch"); } }),
    (error) => error.message.includes("pnpm rebuild better-sqlite3")
      && error.cause?.message === "NODE_MODULE_VERSION mismatch",
  );
});
