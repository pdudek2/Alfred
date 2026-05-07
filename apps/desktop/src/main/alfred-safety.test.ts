import { describe, expect, it } from "vitest";
import { checkSafety } from "./alfred-safety.js";

describe("checkSafety", () => {
  describe("flags dangerous patterns", () => {
    it.each([
      ["rm", ["-rf", "/tmp/x"], "rm -rf detected"],
      ["rm", ["-r", "-f", "/tmp/x"], "rm -rf detected"],
      ["rm", ["-fr", "/"], "rm -rf detected"],
      ["sudo", ["pnpm", "install"], "sudo invocation"],
      ["git", ["push", "-f"], "git push --force"],
      ["git", ["push", "--force"], "git push --force"],
      ["dropdb", ["alfred"], "database drop"],
      ["psql", ["-c", "drop database alfred"], "database drop"],
      ["chmod", ["-R", "777", "."], "recursive chmod"],
      ["mkfs.ext4", ["/dev/sda1"], "low-level disk operation"],
      ["dd", ["if=/dev/zero", "of=/dev/sda"], "low-level disk operation"],
    ])("flags %s %j as %s", (command, args, reason) => {
      const result = checkSafety(command, args);
      expect(result).toEqual({ unsafe: true, reason });
    });

    it.each([
      ["sh -c 'rm -rf /'"],
      ["bash -c 'echo $HOME'"],
      ["evil; rm -rf /"],
      ["foo|bar"],
      ["foo&bar"],
      ["foo`bar`"],
    ])("flags shell metacharacters in command: %s", (command) => {
      const result = checkSafety(command, []);
      expect(result.unsafe).toBe(true);
      if (result.unsafe) {
        expect(result.reason).toMatch(/shell metacharacters/);
      }
    });
  });

  describe("allows safe commands", () => {
    it.each([
      ["pnpm", ["dev"]],
      ["pnpm", ["--filter", "@alfred/api", "test"]],
      ["codex", []],
      ["claude", ["--mode", "code"]],
      ["next", ["dev"]],
      ["docker", ["compose", "up"]],
      ["tail", ["-f", "logs/app.log"]],
      ["cat", ["package.json"]],
      ["rm", ["package-lock.json"]],
    ])("allows %s %j", (command, args) => {
      const result = checkSafety(command, args);
      expect(result).toEqual({ unsafe: false });
    });
  });
});
