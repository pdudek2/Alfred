import { homedir } from "node:os";
import { describe, expect, it } from "vitest";

import { redactArgs, redactPayload, redactText } from "../src/redactor.js";

describe("redactArgs", () => {
  it.each([
    { args: ["python", "-u", "script.py"], expected: ["python", "-u", "script.py"] },
    { args: ["ssh", "-p", "22", "host"], expected: ["ssh", "-p", "22", "host"] },
    { args: ["mkdir", "-p", "/x/y"], expected: ["mkdir", "-p", "/x/y"] },
    { args: ["docker", "run", "-p", "8080:80"], expected: ["docker", "run", "-p", "8080:80"] },
    { args: ["claude", "-p", "Build the app"], expected: ["claude", "-p", "Build the app"] },
    { args: ["curl", "-u", "user:pass", "https://x"], expected: ["curl", "-u", "[redacted]", "https://x"] },
    { args: ["curl", "-u", "user", "https://x"], expected: ["curl", "-u", "user", "https://x"] },
  ])("preserves short flag values except user:password credentials: $args", ({ args, expected }) => {
    expect(redactArgs(args)).toEqual(expected);
  });

  it("preserves path arguments while redacting inline and separate secrets", () => {
    const args = ["--add-dir", "/Users/x/repo", "--token=hunter2", "--password", "/tmp/secret", "ghp_1234567890abcdef"];
    expect(redactArgs(args)).toEqual([
      "--add-dir", "/Users/x/repo", "--token=[redacted]", "--password", "[redacted]", "[redacted]",
    ]);
    expect(args[4]).toBe("/tmp/secret");
    expect(redactText("/Users/x/repo")).toMatch(/^\[redacted-path:[a-f0-9]{8}\]$/);
    expect(redactText(`Wrote ${homedir()}/Downloads/note.md`)).toBe("Wrote ~/Downloads/note.md");
  });

  it("redacts the value after a prefixed secret flag", () => {
    expect(redactArgs(["gh", "--auth-token", "abc", "--no-password", "keep"]))
      .toEqual(["gh", "--auth-token", "[redacted]", "--no-password", "keep"]);
  });

  it("preserves argument boundaries and does not consume a value after an inline secret", () => {
    expect(redactArgs(["--password=hunter2", "keep me", "two words", "--tokenizer", "ordinary"]))
      .toEqual(["--password=[redacted]", "keep me", "two words", "--tokenizer", "ordinary"]);
  });
});

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

  it("redacts obvious secret values inside standard-mode text payloads", () => {
    expect(
      redactPayload(
        {
          summary: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
          output: "created key sk-proj-1234567890abcdef",
          link: "github token ghp_1234567890abcdef",
          nested: {
            log: [
              "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
            ],
          },
        },
        "standard",
      ),
    ).toEqual({
      summary: "Authorization: [redacted]",
      output: "created key [redacted]",
      link: "github token [redacted]",
      nested: {
        log: ["[redacted]"],
      },
    });
  });

  it("redacts common secret text shapes", () => {
    expect(redactText("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")).not.toContain("wJalr");
    expect(redactText("export DB_PASSWORD=hunter2")).not.toContain("hunter2");
    expect(redactText("curl -H 'X-Api-Key: abc123def4567890' https://example.test")).not.toContain(
      "abc123def4567890",
    );
    expect(redactText("deploy --token=abc123def4567890")).not.toContain("abc123def4567890");
    expect(redactText("Authorization: Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
    expect(redactText("xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx")).toContain("[redacted]");
    expect(redactText("AKIAIOSFODNN7EXAMPLE")).toContain("[redacted]");
    expect(redactText("token github_pat_1234567890abcdef_1234567890abcdef")).toBe("token [redacted]");
    expect(
      redactText(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      ),
    ).toContain("[redacted]");
  });

  it("redacts quoted multi-word CLI secret argument values", () => {
    expect(redactText('deploy --password "correct horse battery staple"')).toBe("deploy --password [redacted]");
    expect(redactText("deploy --token 'abc def'")).toBe("deploy --token [redacted]");
  });

  it("redacts secret-named keys in JSON text the same way as object keys", () => {
    expect(
      redactText('token response: {"access_token":"at-SYNTHETIC","client_secret":"cs-SYNTHETIC","refreshToken":"rt-SYNTHETIC","expires_in":3600,"scope":"repo"} ok'),
    ).toBe('token response: {"access_token":"[redacted]","client_secret":"[redacted]","refreshToken":"[redacted]","expires_in":3600,"scope":"repo"} ok');
    expect(redactText(String.raw`{"password": "pa\"ss-TAIL-SYNTHETIC", "user": "keep"}`)).toBe(
      '{"password": "[redacted]", "user": "keep"}',
    );
    expect(redactText("{'apiKey': 'ak-SYNTHETIC'}")).toBe("{'apiKey': '[redacted]'}");
    expect(redactPayload({ summary: '{"access_token":"at-SYNTHETIC"}' }, "standard")).toEqual({
      summary: '{"access_token":"[redacted]"}',
    });
    expect(redactText('{"name": "alfred", "status": "ok", "count": 2}')).toBe('{"name": "alfred", "status": "ok", "count": 2}');
  });

  it("redacts multi-token authorization assignment values", () => {
    expect(redactText("AUTHORIZATION=Bearer abc.def.ghi")).toBe("AUTHORIZATION=[redacted]");
    expect(redactText("AUTHORIZATION=Basic dXNlcjpwYXNz")).toBe("AUTHORIZATION=[redacted]");
  });

  it("preserves shell command context around embedded header secrets", () => {
    expect(redactText("curl -H 'X-Api-Key: abc123def4567890' https://example.test")).toBe(
      "curl -H 'X-Api-Key: [redacted]' https://example.test",
    );
  });

  it.each([
    {
      name: "URI userinfo",
      input: "postgresql://alfred:sup3rs3cret@db.example.com:5432/alfred",
      leaked: ["sup3rs3cret"],
    },
    {
      name: "GitHub URI userinfo",
      input: "https://user:ghp_1234567890abcdef@github.com/a/b.git",
      leaked: ["ghp_1234567890abcdef"],
    },
    {
      name: "Stripe live key",
      input: "stripe sk_live_1234567890abcdef",
      leaked: ["sk_live_1234567890abcdef"],
    },
    {
      name: "Google API key",
      input: "google AIzaSyD1234567890abcdefghijklmnop",
      leaked: ["AIzaSyD1234567890abcdefghijklmnop"],
    },
    {
      name: "GitLab token",
      input: "gitlab glpat-1234567890abcdef",
      leaked: ["glpat-1234567890abcdef"],
    },
    {
      name: "npm token",
      input: "npm npm_1234567890abcdef",
      leaked: ["npm_1234567890abcdef"],
    },
    {
      name: "SendGrid key",
      input: "sendgrid SG.1234567890abcdef.abcdefghijklmnop",
      leaked: ["SG.1234567890abcdef.abcdefghijklmnop"],
    },
    {
      name: "JSON API key",
      input: '{"api_key": "abc123SECRET"}',
      leaked: ["abc123SECRET"],
    },
    {
      name: "direct Cookie header",
      input: "Cookie: preference=\"compact\"; session=abc123SECRET; csrf=xyz789LEAK",
      leaked: ["abc123SECRET", "xyz789LEAK"],
    },
    {
      name: "shell-quoted Cookie header",
      input: "curl -H 'Cookie: preference=\"compact\"; session=abc123SECRET; csrf=xyz789LEAK' https://example.test",
      leaked: ["abc123SECRET", "xyz789LEAK"],
    },
    {
      name: "Cookie header after an empty first value",
      input: "Cookie: preference=; session=abc123SECRET; csrf=xyz789LEAK",
      leaked: ["abc123SECRET", "xyz789LEAK"],
    },
    {
      name: "shell-quoted Cookie header after a malformed segment",
      input: "curl -H 'Cookie: preference=\"compact\"; malformed; session=abc123SECRET' https://example.test",
      leaked: ["abc123SECRET"],
    },
  ])("redacts $name credential", ({ input, leaked }) => {
    const output = redactText(input);
    expect(output.includes("[redacted]")).toBe(true);
    expect(leaked.some((secret) => output.includes(secret))).toBe(false);
  });

  it.each([
    { name: "userinfo-free URL", input: "https://user@example.com/a/b.git" },
    { name: "Stripe preview text", input: "stripe sk_live_preview" },
    { name: "short Google prefix", input: "google AIza-short" },
    { name: "npm command", input: "npm install" },
    { name: "SendGrid status text", input: "SG status report" },
    { name: "API key description", input: '{"api_key_description": "used by local fixtures"}' },
    { name: "Cookie prose", input: "Cookie: preferences are documented" },
    {
      name: "shell Cookie policy text",
      input: "curl -H 'Cookie policy: use the browser profile' https://example.test",
    },
  ])("does not overmatch ordinary $name", ({ input }) => {
    expect(redactText(input)).toBe(input);
  });

  it("preserves command context around a shell-quoted Cookie header", () => {
    const input =
      "curl -H 'Cookie: preference=\"compact\"; session=abc123SECRET; csrf=xyz789LEAK' https://example.test";
    const expected = "curl -H 'Cookie: [redacted]' https://example.test";
    const output = redactText(input);

    expect(output === expected).toBe(true);
  });

  it("redacts across terminal control sequences and leaves them intact", () => {
    const esc = "\x1b";
    expect(redactText(`${esc}[1mMY_API_TOKEN${esc}[0m=hunter2-SYNTHETIC\r\n`)).toBe(
      `${esc}[1mMY_API_TOKEN${esc}[0m=[redacted]\r\n`,
    );
    expect(redactText(`.env:${esc}[01;31m${esc}[KMY_API_TOKEN${esc}[m${esc}[K=hunter2-SYNTHETIC\r\n`)).toBe(
      `.env:${esc}[01;31m${esc}[KMY_API_TOKEN${esc}[m${esc}[K=[redacted]\r\n`,
    );
    expect(redactText(`${esc}[32mghp_1234567890abcdef${esc}[0m`)).toBe(`${esc}[32m[redacted]${esc}[0m`);
    expect(redactText(`DB_PASSWORD=hunter2${esc}[0m ok`)).toBe(`DB_PASSWORD=[redacted]${esc}[0m ok`);
    expect(redactText(`TOKEN=abc${esc}[0mdef ok`)).toBe(`TOKEN=[redacted]${esc}[0m ok`);
    expect(redactText("TOKEN=ab\b\babcd ok")).toBe("TOKEN=[redacted] ok");
    expect(redactText(`deploy --token abc${esc}[1mdef ok`)).toBe(`deploy --token [redacted]${esc}[1m ok`);
    expect(redactText(`Authorization: Bearer abc${esc}[0mdef\r\nnext`)).toBe(`Authorization: [redacted]${esc}[0m\r\nnext`);
    expect(redactText(`Cookie: session=abc${esc}[0mdef; csrf=x\r\nnext`)).toBe(`Cookie: [redacted]${esc}[0m\r\nnext`);
    expect(redactText(`redis://:ab${esc}[0mcd@db`)).toBe(`redis://[redacted]${esc}[0m@db`);
    const pathMarker = /\[redacted-path:[a-f0-9]{8}\]/g;
    expect(redactText(`${esc}]8;;file:///Users/x/a.png\x07[Image #1]${esc}]8;;\x07`).replace(pathMarker, "P"))
      .toBe(`${esc}]8;;file://P\x07[Image #1]${esc}]8;;\x07`);
    expect(redactText(`${esc}[35m/Users/x/a.ts${esc}[0m:12`).replace(pathMarker, "P")).toBe(`${esc}[35mP${esc}[0m:12`);
  });

  it.each([
    {
      name: "PEM key cut before its END line",
      input: "$ head -3 key.pem\r\n-----BEGIN RSA PRIVATE KEY-----\r\nMIIEpAIBAAKCAQEA1SYNTHETIC\r\nAbCdEfGhSYNTHETIC2\r\n$ ls\r\n",
      expected: "$ head -3 key.pem\r\n[redacted]\r\n$ ls\r\n",
    },
    {
      name: "PGP private key block",
      input: "-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: GnuPG v2\n\nlQOYBFSYNTHETIC\n=AbCd\n-----END PGP PRIVATE KEY BLOCK-----\ndone",
      expected: "[redacted]\ndone",
    },
    { name: "URI password without a user", input: "redis://:hunter2SYNTHETIC@db:6379/0", expected: "redis://[redacted]@db:6379/0" },
    { name: "prefixed CLI secret flag", input: "gh auth --auth-token abc123SYNTHETIC --verbose", expected: "gh auth --auth-token [redacted] --verbose" },
    { name: "Authorization token scheme", input: "Authorization: token abc123SYNTHETIC\r\nnext", expected: "Authorization: [redacted]\r\nnext" },
    { name: "JSON token key", input: '{"token":"abc123SYNTHETIC"}', expected: '{"token":"[redacted]"}' },
    {
      name: "escaped JSON token key",
      input: String.raw`{"body":"{\"token\":\"abc123SYNTHETIC\",\"ok\":1}"}`,
      expected: String.raw`{"body":"{\"token\":\"[redacted]\",\"ok\":1}"}`,
    },
    {
      name: "PEM key whose body lines carry escape codes",
      input: "-----BEGIN RSA PRIVATE KEY-----\r\nMIIE AbC \r\n\x1b[0mXyZ\r\n-----END RSA PRIVATE KEY-----\r\nok",
      expected: "[redacted]\r\nok",
    },
    {
      name: "PEM key cut short before a whole one",
      input: "-----BEGIN RSA PRIVATE KEY-----\nMIIEab\n$ ls\nkeep me\n-----BEGIN RSA PRIVATE KEY-----\nCD\n-----END RSA PRIVATE KEY-----",
      expected: "[redacted]\n$ ls\nkeep me\n[redacted]",
    },
    {
      name: "PEM key inside a JSON string",
      input: String.raw`"-----BEGIN RSA PRIVATE KEY-----\nMIIEab\nCD\n-----END RSA PRIVATE KEY-----"`,
      expected: '"[redacted]"',
    },
    {
      name: "PEM key cut short inside a JSON string",
      input: String.raw`{"key":"x","out":"-----BEGIN RSA PRIVATE KEY-----\nMIIEab\nCD"}`,
      expected: String.raw`{"key":"x","out":"[redacted]"}`,
    },
    { name: "long secret-named variable", input: `${"A".repeat(100)}_TOKEN=abc ok`, expected: `${"A".repeat(100)}_TOKEN=[redacted] ok` },
    { name: "hyphenated secret key", input: "X-API-KEY=abc ok", expected: "X-API-KEY=[redacted] ok" },
    { name: "CLI secret with ; and ,",input: "deploy --password a,b;c --token x", expected: "deploy --password [redacted] --token [redacted]" },
    { name: "Hugging Face token", input: "hf hf_AbCdEfGhIjKlMnOpQrStUvWx", expected: "hf [redacted]" },
    { name: "Stripe test key", input: "stripe sk_test_1234567890abcdef", expected: "stripe [redacted]" },
    { name: "Groq key", input: "groq gsk_AbCdEfGhIjKlMnOpQrStUvWx", expected: "groq [redacted]" },
  ])("redacts $name", ({ input, expected }) => {
    expect(redactText(input)).toBe(expected);
  });

  it.each([
    { name: "token prefixes", input: `x${"ghp_".repeat(50_000)}` },
    { name: "dashed words", input: `x${"sk-".repeat(66_000)}` },
    { name: "Bearer words", input: "xBearer a".repeat(22_000) },
    { name: "key headers", input: "-----BEGIN RSA PRIVATE KEY-----\n".repeat(6_000) },
    { name: "escape openers", input: "\x1b[".repeat(100_000) },
    { name: "secret-named words", input: "TOKEN".repeat(40_000) },
    { name: "hyphenated words", input: "a-".repeat(100_000) },
    { name: "secret names with escapes", input: "A_TOKEN=\x1b[m".repeat(18_000) },
    { name: "open quotes", input: 'TOKEN="'.repeat(28_000) },
  ])("redacts 200k characters of repeated $name in linear time", ({ input }) => {
    const started = performance.now();
    redactText(input);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it.each([
    { input: "Authorization: Bearer [redacted] realsecret", expected: "Authorization: [redacted]" },
    { input: "TOKEN=x[redacted]y ok", expected: "TOKEN=[redacted] ok" },
    { input: "deploy --token x[redacted]y ok", expected: "deploy --token [redacted] ok" },
  ])("redacts a real value next to a marker in $input", ({ input, expected }) => {
    expect(redactText(input)).toBe(expected);
  });

  it.each([
    "curl -H 'X-Api-Key: abc123' -H 'Cookie: a=b' https://example.test",
    "Authorization: Bearer abc\x1b[0m\r\nDB_PASSWORD=hunter2 --token=x redis://:p@db",
    '{"token":"abc"} {\\"password\\":\\"x\\"} ghp_1234567890abcdef',
  ])("redacts already redacted text to itself: %j", (input) => {
    const once = redactText(input);
    expect(redactText(once)).toBe(once);
  });

  it.each([
    { name: "port URL", input: "http://localhost:3000/x" },
    { name: "ssh remote", input: "ssh://git@github.com:22/a/b.git" },
    { name: "negated secret flag", input: "pnpm --no-password install" },
    { name: "public key block", input: "-----BEGIN PUBLIC KEY-----\nMIIBIjAN\n-----END PUBLIC KEY-----" },
    { name: "short hf word", input: "hf_hub download" },
  ])("does not redact ordinary $name", ({ input }) => {
    expect(redactText(input)).toBe(input);
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

  it("minimal mode still redacts secret-looking values that survive the key allowlist", () => {
    expect(
      redactPayload(
        {
          summary: "created Authorization: Bearer abc.def.ghi",
          status: "pushed ghp_1234567890abcdef",
          tool_name: "exec_command",
          exit_code: 0,
        },
        "minimal",
      ),
    ).toEqual({
      summary: "created Authorization: [redacted]",
      status: "pushed [redacted]",
      tool_name: "exec_command",
      exit_code: 0,
    });
  });

  it("standard mode redacts absolute local paths in text payloads", () => {
    expect(
      redactPayload(
        {
          summary: "cwd /Users/sample/Desktop/Alfred and /tmp/alfred-secret",
          nested: { cwd: "/Users/sample/.codex/sessions/session.jsonl" },
        },
        "standard",
      ),
    ).toEqual({
      summary: "cwd [redacted-path:cd97628a] and [redacted-path:bf2fcc30]",
      nested: { cwd: "[redacted-path:ea3222cc]" },
    });
  });

  it("redacts secret keyed values in full mode", () => {
    expect(redactPayload({ api_key: "abc123def4567890" }, "full")).toEqual({ api_key: "[redacted]" });
  });

  it("redacts hard secret text values in full mode", () => {
    expect(
      redactPayload(
        { summary: "sent xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx", command: "kept" },
        "full",
      ),
    ).toEqual({ summary: "sent [redacted]", command: "kept" });
  });

  it("keeps non-secret payload values in full mode", () => {
    expect(redactPayload({ normal: "ok", nested: { note: "keep" } }, "full")).toEqual({
      normal: "ok",
      nested: { note: "keep" },
    });
  });
});
