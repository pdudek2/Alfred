import { describe, expect, it } from "vitest";

import { AgentSource, EventType, PrivacyMode, RunStatus } from "@alfred/schema";
import {
  agentSourceEnum,
  eventTypeEnum,
  privacyModeEnum,
  runStatusEnum,
} from "../src/schema.js";

describe("database enum contracts", () => {
  it("keeps shared schema enums aligned with Drizzle postgres enums", () => {
    expect(agentSourceEnum.enumValues).toEqual(AgentSource.options);
    expect(eventTypeEnum.enumValues).toEqual(EventType.options);
    expect(privacyModeEnum.enumValues).toEqual(PrivacyMode.options);
    expect(runStatusEnum.enumValues).toEqual(RunStatus.options);
  });
});
