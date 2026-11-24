import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "./support/electron-app";
import { surfaceButton } from "./support/work-layout";

test("Analytics reads the agent event log: cost per model, your replies and what agents ran", async ({ harness }) => {
  const { page, paths } = harness;
  const started = Date.now() - 30 * 60_000;
  const at = (minutes: number) => new Date(started + minutes * 60_000).toISOString();
  const line = (minutes: number, event: string, attributes: Record<string, unknown>, session = "claude-1") =>
    ({ agent: "claude", at: at(minutes), attributes, event, session });
  const request = (minutes: number, extra: Record<string, unknown> = {}) => line(minutes, "api_request", {
    model: "claude-opus-5-5", query_source: "repl_main_thread", input_tokens: 1000, cache_creation_tokens: 2000,
    cache_read_tokens: 40_000, output_tokens: 500, cost_usd: 1.25, duration_ms: 4000, ttft_ms: 800, ...extra,
  });
  const lines = [
    line(0, "user_prompt", { prompt_length: "12" }),
    request(1),
    line(2, "tool_result", { tool_name: "Bash", success: true, tool_parameters: JSON.stringify({ full_command: "git status" }) }),
    line(3, "hook_execution_start", { hook_event: "Stop" }),
    line(5, "user_prompt", { prompt_length: "8" }),
    request(6, { model: "claude-fable-5-2", cost_usd: 0.5 }),
    line(7, "hook_execution_start", { hook_event: "Stop" }),
  ];
  // Day files are named by UTC date.
  const byDay = new Map<string, string[]>();
  for (const item of lines) byDay.set(item.at.slice(0, 10), [...(byDay.get(item.at.slice(0, 10)) ?? []), JSON.stringify(item)]);
  await mkdir(path.join(paths.userData, "agent-events"), { recursive: true });
  for (const [day, dayLines] of byDay) await writeFile(path.join(paths.userData, "agent-events", `${day}.jsonl`), dayLines.join("\n") + "\n");

  await surfaceButton(page, "Analytics").click();
  const analytics = page.getByRole("region", { name: "Analytics" });
  await expect(analytics.getByRole("heading", { name: "Analytics", level: 1 })).toBeFocused();
  const spend = analytics.getByRole("region", { name: "Spend" });
  await expect(spend.getByText("$1.75", { exact: true })).toBeVisible();
  await expect(spend.getByText("Opus 5.5")).toBeVisible();
  await expect(spend.getByText("Fable 5.2")).toBeVisible();
  await expect(analytics.getByRole("region", { name: "Waiting on you" }).getByText("2 min 0 s").first()).toBeVisible();
  await expect(analytics.getByRole("list", { name: "Programs in shell calls" }).getByText("git", { exact: true })).toBeVisible();

  await analytics.getByRole("group", { name: "Measure" }).getByRole("button", { name: "Tokens" }).click();
  await expect(spend.getByText("87.0K", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(analytics).toHaveCount(0);
});
