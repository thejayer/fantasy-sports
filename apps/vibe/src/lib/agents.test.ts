import { describe, expect, it } from "vitest";

import { parseAgentRunsPayload } from "./agents";

describe("agent run ingest", () => {
  it("derives identity from the window, not a client-supplied id", () => {
    const [first] = parseAgentRunsPayload({
      start: "2026-10-05T11:00:00Z",
      end: "2026-10-05T12:00:00Z",
      label: "lift",
      id: "attacker-chosen",
    });
    const [second] = parseAgentRunsPayload({
      start: "2026-10-05T11:00:00Z",
      end: "2026-10-05T12:00:00Z",
      label: "lift",
      id: "different-client-id",
    });
    expect(first?.id).toBe(second?.id);
    expect(first?.id).not.toBe("attacker-chosen");
  });
});
