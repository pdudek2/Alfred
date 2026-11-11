import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { DEV_ROOT_PATH, devServerOwner, electronArguments } from "../../apps/desktop/scripts/dev-electron-config.mjs";

test("desktop Electron arguments preserve the Stable profile by default", () => {
  assert.deepEqual(electronArguments(undefined), ["."]);
});

test("desktop Electron arguments isolate Preview with one native user-data argument", () => {
  assert.deepEqual(
    electronArguments("/Users/sample/Library/Application Support/Alfred Preview"),
    [".", "--user-data-dir=/Users/sample/Library/Application Support/Alfred Preview"],
  );
});

test("the dev launcher reuses a server only when it answers with this checkout's folder", async () => {
  const appDirectory = "/Users/sample/Alfred/apps/desktop/";
  const answers = new Map([
    ["this", appDirectory],
    ["other checkout", "/Users/sample/Alfred/.worktrees/other/apps/desktop/"],
  ]);
  let answer;
  const server = createServer((request, response) => {
    if (request.url === DEV_ROOT_PATH && answers.has(answer)) response.end(answers.get(answer));
    else response.end("<!doctype html><title>Something else</title>");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;

  answer = "this";
  assert.equal(await devServerOwner(url, appDirectory.slice(0, -1)), "this checkout");
  answer = "other checkout";
  assert.equal(await devServerOwner(url, appDirectory), "other");
  answer = "unrelated app";
  assert.equal(await devServerOwner(url, appDirectory), "other");

  server.close();
  await once(server, "close");
  assert.equal(await devServerOwner(url, appDirectory), "none");
});
