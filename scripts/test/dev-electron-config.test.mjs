import assert from "node:assert/strict";
import test from "node:test";
import { electronArguments } from "../../apps/desktop/scripts/dev-electron-config.mjs";

test("desktop Electron arguments preserve the Stable profile by default", () => {
  assert.deepEqual(electronArguments(undefined), ["."]);
});

test("desktop Electron arguments isolate Preview with one native user-data argument", () => {
  assert.deepEqual(
    electronArguments("/Users/patryk/Library/Application Support/Alfred Preview"),
    [".", "--user-data-dir=/Users/patryk/Library/Application Support/Alfred Preview"],
  );
});
