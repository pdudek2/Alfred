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

  it("keeps payload unchanged in full mode", () => {
    const payload = { token: "abc" };

    expect(redactPayload(payload, "full")).toBe(payload);
  });
});
