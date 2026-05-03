import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseEnvFileContent } from "../lib/env-file.mjs";

describe("parseEnvFileContent", () => {
  it("parses comments, unquoted values, and quoted values", () => {
    const result = parseEnvFileContent(`
      # comment
      RUNNER_API_URL=https://example.com
      ALFRED_SOURCES="codex"
      ALFRED_PRIVACY_MODE='standard'
    `);

    assert.deepEqual(result, {
      RUNNER_API_URL: "https://example.com",
      ALFRED_SOURCES: "codex",
      ALFRED_PRIVACY_MODE: "standard",
    });
  });

  it("rejects lines without keys", () => {
    assert.throws(
      () => parseEnvFileContent("=missing-key"),
      /Invalid env line 1/,
    );
  });

  it("does not expand shell syntax", () => {
    const result = parseEnvFileContent("RUNNER_API_URL=$HOME/no-shell");
    assert.equal(result.RUNNER_API_URL, "$HOME/no-shell");
  });
});
