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
  const renders: string[][] = [];
  const theme = { fg: (_color: string, value: string) => value };
  return {
    get status() {
      return status;
    },
    notifications,
    renders,
    ctx: {
      hasUI: true,
      mode: "tui",
      ui: {
        theme,
        setStatus: (_key: string, value: string | undefined) => {
          status = value;
        },
        notify: (message: string) => {
          notifications.push(message);
        },
        custom: async (factory: any) => {
          const view = factory(undefined, theme, undefined, () => undefined);
          renders.push(view.render(120));
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

    assert.equal(fixture.status, "1/1/1  0.0 tok/s ○○○○○○○");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("message_end does not double count when Pi already exposes the ended message", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-live-dedupe-${process.pid}-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => handlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);

    const now = new Date();
    const noonToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const fixture = makeCtx(agentDir, [userEntry("hi", noonToday)]);
    await handlers.get("message_end")?.({
      message: { role: "user", content: "hi", timestamp: noonToday },
    }, fixture.ctx);

    assert.equal(fixture.status, "1/1/1  0.0 tok/s ○○○○○○○");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("assistant message_update shows a live footer speedometer", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-live-tps-${process.pid}-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => handlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);

    const fixture = makeCtx(agentDir);
    await handlers.get("session_start")?.({ reason: "startup" }, fixture.ctx);
    await handlers.get("message_start")?.({ message: { role: "assistant", timestamp: Date.now(), content: [] } }, fixture.ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handlers.get("message_update")?.({
      message: { role: "assistant", content: [] },
      assistantMessageEvent: { type: "text_delta", delta: "x".repeat(128) },
    }, fixture.ctx);

    assert.match(fixture.status ?? "", /^0\/0\/0  ~32 tok\/s ●●●○○○○$/);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("assistant message_end records local response speed facts", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-tps-${process.pid}-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => handlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);

    const endedAt = Date.now();
    const fixture = makeCtx(agentDir);
    await handlers.get("message_end")?.({
      message: {
        role: "assistant",
        timestamp: endedAt - 5000,
        provider: "test",
        model: "fast-one",
        content: [],
        usage: { output: 100 },
      },
    }, fixture.ctx);
    await handlers.get("session_shutdown")?.({ reason: "quit" }, fixture.ctx);

    const store = await loadStore(join(agentDir, "pi-tally.json"));
    assert.equal(store.files[join(agentDir, "sessions", "current.jsonl")]?.responses?.[0]?.outputTokens, 100);
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

    assert.equal(fixture.status, "1/1/1  0.0 tok/s ○○○○○○○");
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

    const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => handlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);
    const otherProject = makeCtx(agentDir);
    await handlers.get("session_start")?.({ reason: "startup" }, otherProject.ctx);
    assert.equal(otherProject.status, undefined);

    await commandHandler?.("footer on", fixture.ctx);
    assert.equal(fixture.status, "0/0/0  0.0 tok/s ○○○○○○○");
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).footerEnabled, true);
    assert.deepEqual(fixture.notifications, ["pi-tally: footer disabled", "pi-tally: footer enabled"]);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("/tally toks toggles and persists the footer TPS meter", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-toks-${process.pid}-${Date.now()}`);
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
    await commandHandler?.("toks", fixture.ctx);
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).toksEnabled, false);
    assert.deepEqual(fixture.notifications, ["pi-tally: toks meter disabled"]);

    await commandHandler?.("toks", fixture.ctx);
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).toksEnabled, true);
    assert.deepEqual(fixture.notifications, ["pi-tally: toks meter disabled", "pi-tally: toks meter enabled"]);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("/tally unknown subcommand warns without rendering stats", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-unknown-${process.pid}-${Date.now()}`);
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
    await commandHandler?.("nonsense", fixture.ctx);

    assert.deepEqual(fixture.notifications, ["Usage: /tally, /tally all, /tally run, /tally status, /tally footer [on|off], /tally toks [on|off]"]);
    assert.deepEqual(fixture.renders, []);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("/tally rotates the visible Crumb on each call", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-crumb-rotation-${process.pid}-${Date.now()}`);
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

    const now = new Date();
    const noonToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const fixture = makeCtx(agentDir, [userEntry("abcd", noonToday), userEntry("abcdefghij", noonToday)]);

    await commandHandler?.("", fixture.ctx);
    await commandHandler?.("", fixture.ctx);

    const crumbs = fixture.renders.map((lines) => lines.find((line) => line.startsWith("Crumb:"))?.trimEnd());
    assert.deepEqual(crumbs, [
      "Crumb:         14 characters sent to Pi.",
      "Crumb:         avg prompt length 7 chars",
    ]);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("loaded project instances pick up external footer disables before saving", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(tmpdir(), `pi-tally-footer-shared-${process.pid}-${Date.now()}`);
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

    const loadedHandlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
    piTally({
      on: (event: string, handler: (event: any, ctx: any) => Promise<void>) => loadedHandlers.set(event, handler),
      registerCommand: () => undefined,
    } as any);

    const loadedProject = makeCtx(agentDir);
    await loadedHandlers.get("session_start")?.({ reason: "startup" }, loadedProject.ctx);
    assert.equal(loadedProject.status, "0/0/0  0.0 tok/s ○○○○○○○");

    await commandHandler?.("footer off", makeCtx(agentDir).ctx);
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).footerEnabled, false);

    const now = new Date();
    const noonToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    await loadedHandlers.get("message_end")?.({
      message: { role: "user", content: "hi", timestamp: noonToday },
    }, loadedProject.ctx);

    assert.equal(loadedProject.status, undefined);

    await loadedHandlers.get("session_shutdown")?.({ reason: "quit" }, loadedProject.ctx);
    assert.equal((await loadStore(join(agentDir, "pi-tally.json"))).footerEnabled, false);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});
