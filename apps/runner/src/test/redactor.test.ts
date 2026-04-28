import { describe, expect, it } from "vitest";

import { redactPayload } from "../privacy/redactor.js";

describe("redactPayload", () => {
  it("redacts secret keys in standard mode", () => {
    expect(redactPayload({ api_key: "abc", normal: "ok" }, "standard")).toEqual({
      api_key: "[redacted]",
      normal: "ok",
    });
  });

  it("redacts nested secret keys", () => {
    expect(redactPayload({ nested: { password: "abc" } }, "standard")).toEqual({
      nested: { password: "[redacted]" },
    });
  });

  it("redacts secret keys inside arrays", () => {
    expect(redactPayload({ items: [{ authorization: "Bearer abc" }] }, "standard")).toEqual({
      items: [{ authorization: "[redacted]" }],
    });
  });

  it("redacts deeply nested secret keys", () => {
    expect(
      redactPayload(
        {
          a: { b: { c: { access_token: "xyz", note: "keep" } } },
        },
        "standard",
      ),
    ).toEqual({
      a: { b: { c: { access_token: "[redacted]", note: "keep" } } },
    });
  });

  it("redacts arrays nested inside arrays", () => {
    expect(
      redactPayload(
        {
          batches: [[{ refresh_token: "r1" }], [{ refresh_token: "r2", ok: 1 }]],
        },
        "standard",
      ),
    ).toEqual({
      batches: [[{ refresh_token: "[redacted]" }], [{ refresh_token: "[redacted]", ok: 1 }]],
    });
  });

  it("redacts camelCase and hyphenated secret keys", () => {
    expect(
      redactPayload(
        {
          apiKey: "k",
          accessToken: "a",
          refreshToken: "r",
          clientSecret: "c",
          privateKey: "p",
          sessionId: "s",
          "x-api-key": "h",
          "private-key": "pk",
        },
        "standard",
      ),
    ).toEqual({
      apiKey: "[redacted]",
      accessToken: "[redacted]",
      refreshToken: "[redacted]",
      clientSecret: "[redacted]",
      privateKey: "[redacted]",
      sessionId: "[redacted]",
      "x-api-key": "[redacted]",
      "private-key": "[redacted]",
    });
  });

  it("redacts additional common secret-like keys", () => {
    expect(
      redactPayload(
        {
          cookie: "c",
          credentials: { user: "u", password: "p" },
          passphrase: "pp",
          signature: "sig",
          bearer: "b",
          passwd: "pw",
        },
        "standard",
      ),
    ).toEqual({
      cookie: "[redacted]",
      credentials: "[redacted]",
      passphrase: "[redacted]",
      signature: "[redacted]",
      bearer: "[redacted]",
      passwd: "[redacted]",
    });
  });

  it("preserves null and primitive values", () => {
    expect(
      redactPayload(
        {
          n: null,
          count: 3,
          flag: true,
          token: null,
        },
        "standard",
      ),
    ).toEqual({
      n: null,
      count: 3,
      flag: true,
      token: "[redacted]",
    });
  });

  it("preserves non-secret keys that contain partial words", () => {
    expect(
      redactPayload(
        {
          summary: "all good",
          status: "ok",
          notes: "no secrets here",
        },
        "standard",
      ),
    ).toEqual({
      summary: "all good",
      status: "ok",
      notes: "no secrets here",
    });
  });

  it("redacts top-level secret value when key is composite", () => {
    expect(
      redactPayload({ user_password_hash: "h", value: 1 }, "standard"),
    ).toEqual({ user_password_hash: "[redacted]", value: 1 });
  });

  it("keeps only minimal keys in minimal mode", () => {
    expect(
      redactPayload(
        {
          summary: "done",
          status: "completed",
          tool_name: "exec_command",
          exit_code: 0,
          command: "secret work",
        },
        "minimal",
      ),
    ).toEqual({
      summary: "done",
      status: "completed",
      tool_name: "exec_command",
      exit_code: 0,
    });
  });

  it("minimal mode drops secret keys not in the allowlist", () => {
    expect(
      redactPayload(
        { summary: "s", api_key: "k", token: "t" },
        "minimal",
      ),
    ).toEqual({ summary: "s" });
  });

  it("keeps payload unchanged in full mode", () => {
    const payload = { token: "abc", nested: { password: "p" } };

    expect(redactPayload(payload, "full")).toBe(payload);
  });
});
