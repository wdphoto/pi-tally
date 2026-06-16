import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piTally from "../extensions/tally/index.ts";

const fixedNow = new Date("2026-06-15T12:00:00");

test("message_end counts the pending user message before Pi persists it", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-live-${process.pid}-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => handlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);

    let status = "";
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        theme: { fg: (_color: string, value: string) => value },
        setStatus: (_key: string, value: string) => {
          status = value;
        },
      },
      sessionManager: {
        getSessionFile: () => join(agentDir, "sessions", "current.jsonl"),
        getSessionId: () => "current-session",
        getEntries: () => [],
        getBranch: () => [],
      },
    };

    await handlers.get("message_end")?.({
      message: { role: "user", content: "hi", timestamp: fixedNow.getTime() },
    }, ctx);

    assert.equal(status, "1/1/1");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});
