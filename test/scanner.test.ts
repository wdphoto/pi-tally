import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSessionJsonl, rebuildStoreFromSessions, scanAllSessions } from "../extensions/tally/scanner.ts";

function sessionJsonl(sessionId: string, entries: string[]): string {
  return [
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-06-15T08:00:00.000Z", cwd: "/tmp/demo" }),
    ...entries,
  ].join("\n") + "\n";
}

test("parseSessionJsonl counts only user message entries and ignores malformed lines", () => {
  const content = sessionJsonl("s1", [
    JSON.stringify({ type: "message", id: "u1", timestamp: "2026-06-15T09:00:00.000Z", message: { role: "user", content: "hi" } }),
    JSON.stringify({ type: "message", id: "a1", timestamp: "2026-06-15T09:01:00.000Z", message: { role: "assistant", content: [] } }),
    "{bad json",
    JSON.stringify({ type: "message", id: "u2", timestamp: "2026-06-15T10:00:00.000Z", message: { role: "user", content: "again" } }),
  ]);

  const record = parseSessionJsonl(content, "/tmp/s1.jsonl");
  assert.ok(record);
  assert.equal(record.sessionId, "s1");
  assert.equal(record.prompts.length, 2);
  assert.deepEqual(record.prompts.map((p) => p.id), ["u1", "u2"]);
  assert.equal(record.prompts[0]?.date, "2026-06-15");
  assert.equal(record.prompts[1]?.date, "2026-06-15");
});

test("scanAllSessions walks nested Pi session directories", async () => {
  const sessionsDir = join(tmpdir(), `pi-tally-${process.pid}-${Date.now()}`, "sessions");
  const projectDir = join(sessionsDir, "--demo--");
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "2026-06-15_s1.jsonl"), sessionJsonl("s1", [
    JSON.stringify({ type: "message", id: "u1", timestamp: "2026-06-15T09:00:00.000Z", message: { role: "user", content: "hi" } }),
  ]));

  const result = await scanAllSessions(sessionsDir);
  assert.equal(Object.keys(result.files).length, 1);
  assert.equal(Object.values(result.files)[0]?.prompts.length, 1);
});

test("rebuildStoreFromSessions does not double count across repeated scans", async () => {
  const sessionsDir = join(tmpdir(), `pi-tally-repeat-${process.pid}-${Date.now()}`, "sessions");
  const projectDir = join(sessionsDir, "--demo--");
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "2026-06-15_s1.jsonl"), sessionJsonl("s1", [
    JSON.stringify({ type: "message", id: "u1", timestamp: "2026-06-15T09:00:00.000Z", message: { role: "user", content: "hi" } }),
    JSON.stringify({ type: "message", id: "u2", timestamp: "2026-06-15T09:02:00.000Z", message: { role: "user", content: "again" } }),
  ]));

  const first = await rebuildStoreFromSessions(sessionsDir);
  const second = await rebuildStoreFromSessions(sessionsDir);
  assert.equal(first.store.daily["2026-06-15"], 2);
  assert.equal(second.store.daily["2026-06-15"], 2);
});
