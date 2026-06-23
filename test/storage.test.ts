import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEmptyStore, recomputeAggregates } from "../extensions/tally/stats.ts";
import { loadStore, migrateStore, saveStoreAtomic } from "../extensions/tally/storage.ts";

const fixedNow = new Date("2026-06-15T12:00:00");

test("migrateStore drops incompatible versions", () => {
  const store = migrateStore({ version: 999, daily: { x: 1 } }, fixedNow);
  assert.equal(store.version, 1);
  assert.equal(Object.keys(store.daily).length, 0);
});

test("migrateStore rebuilds aggregates from file records", () => {
  const store = migrateStore({
    version: 1,
    updatedAt: fixedNow.toISOString(),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 10,
        prompts: [{ timestamp: 1, date: "2026-06-15", hour: "09" }],
      },
    },
  }, fixedNow);

  assert.equal(store.daily["2026-06-15"], 1);
  assert.equal(store.hourly["2026-06-15 09"], 1);
  assert.equal(store.sessions.s1, 1);
  assert.equal(store.crumbs.totalChars, 0);
  assert.equal(store.footerEnabled, true);
  assert.equal(store.toksEnabled, true);
});

test("migrateStore preserves prompt character crumbs", () => {
  const store = migrateStore({
    version: 1,
    updatedAt: fixedNow.toISOString(),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 10,
        prompts: [{ timestamp: 1, date: "2026-06-15", hour: "09", chars: 12 }],
      },
    },
  }, fixedNow);

  assert.equal(store.crumbs.totalChars, 12);
  assert.equal(store.crumbs.longestPromptChars, 12);
  assert.equal(store.crumbs.dailyChars["2026-06-15"], 12);
});

test("migrateStore preserves response speed facts", () => {
  const store = migrateStore({
    version: 1,
    updatedAt: fixedNow.toISOString(),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 10,
        prompts: [],
        responses: [{ timestamp: 1, date: "2026-06-15", hour: "09", outputTokens: 100, durationMs: 5000, model: "test/fast" }],
      },
    },
  }, fixedNow);

  assert.equal(store.files.a?.responses?.[0]?.outputTokens, 100);
  assert.equal(store.files.a?.responses?.[0]?.durationMs, 5000);
  assert.equal(store.files.a?.responses?.[0]?.model, "test/fast");
});

test("migrateStore preserves persisted updatedAt", () => {
  const persistedAt = "2026-06-14T01:02:03.000Z";
  const store = migrateStore({
    version: 1,
    updatedAt: persistedAt,
    files: {},
  }, fixedNow);

  assert.equal(store.updatedAt, persistedAt);
});

test("migrateStore preserves disabled footer setting", () => {
  const store = migrateStore({
    version: 1,
    updatedAt: fixedNow.toISOString(),
    footerEnabled: false,
    files: {},
  }, fixedNow);

  assert.equal(store.footerEnabled, false);
});

test("migrateStore preserves disabled toks setting", () => {
  const store = migrateStore({
    version: 1,
    updatedAt: fixedNow.toISOString(),
    toksEnabled: false,
    files: {},
  }, fixedNow);

  assert.equal(store.toksEnabled, false);
});

test("saveStoreAtomic writes a loadable local persistence file", async () => {
  const dir = await mkdir(join(tmpdir(), `pi-tally-store-${process.pid}-${Date.now()}`), { recursive: true });
  assert.ok(dir);
  const file = join(dir, "pi-tally.json");
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 1,
        prompts: [{ timestamp: 1, date: "2026-06-15", hour: "09" }],
      },
    },
  }, fixedNow);

  await saveStoreAtomic(file, store);
  const raw = await readFile(file, "utf8");
  assert.match(raw, /"version": 1/);

  const loaded = await loadStore(file, fixedNow);
  assert.equal(loaded.daily["2026-06-15"], 1);
});
