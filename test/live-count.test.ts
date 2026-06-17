import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piTally from "../extensions/tally/index.ts";
import { loadStore } from "../extensions/tally/storage.ts";

function makeCtx(agentDir: string, entries: unknown[] = [], treePath: unknown[] = entries) {
  let status: string | undefined;
  const notifications: string[] = [];
  return {
    get status() {
      return status;
    },
    notifications,
    ctx: {
      hasUI: true,
      mode: "tui",
      ui: {
        theme: { fg: (_color: string, value: string) => value },
        setStatus: (_key: string, value: string | undefined) => {
          status = value;
        },
        notify: (message: string) => {
          notifications.push(message);
        },
      },
      sessionManager: {
        getSessionFile: () => join(agentDir, "sessions", "current.jsonl"),
        getSessionId: () => "current-session",
        getEntries: () => entries,
        getBranch: () => treePath,
      },
    },
  };
}

function userEntry(id: string, timestamp: number): unknown {
  return {
    type: "message",
    id,
    timestamp,
    message: { role: "user", content: id, timestamp },
  };
}

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

    const fixture = makeCtx(agentDir);
    const now = new Date();
    const noonToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    await handlers.get("message_end")?.({
      message: { role: "user", content: "hi", timestamp: noonToday },
    }, fixture.ctx);

    assert.equal(fixture.status, "1/1/1");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("footer tree path count is scoped to the local computer day", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-local-day-${process.pid}-${Date.now()}`);
  await mkdir(join(agentDir, "sessions"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => handlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);

    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).getTime();
    const entries = [userEntry("yesterday", yesterdayNoon), userEntry("today", todayNoon)];
    const fixture = makeCtx(agentDir, entries);

    await handlers.get("session_start")?.({ reason: "startup" }, fixture.ctx);

    assert.equal(fixture.status, "1/1/1");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("/tally footer toggles and persists the footer status", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-footer-${process.pid}-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
    piTally({
      on: () => undefined,
      registerCommand: (_name: string, def: { handler: (args: string, ctx: any) => Promise<void> }) => {
        commandHandler = def.handler;
      },
    } as any);

    const fixture = makeCtx(agentDir);
    await commandHandler?.("footer off", fixture.ctx);
    assert.equal(fixture.status, undefined);
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).footerEnabled, false);
    assert.deepEqual(fixture.notifications, ["pi-tally: footer disabled"]);

    await commandHandler?.("footer on", fixture.ctx);
    assert.equal(fixture.status, "0/0/0");
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).footerEnabled, true);
    assert.deepEqual(fixture.notifications, ["pi-tally: footer disabled", "pi-tally: footer enabled"]);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});
