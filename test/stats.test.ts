import test from "node:test";
import assert from "node:assert/strict";
import { footerText } from "../extensions/tally/ui.ts";
import { activeDayAverage, bucketFromTimestamp, createEmptyStore, daysBetween, recomputeAggregates, replaceFileRecordIncremental, trendArrow, trendArrowForStore } from "../extensions/tally/stats.ts";

const fixedNow = new Date("2026-06-15T12:00:00");

test("bucketFromTimestamp uses local date and hour and falls back on invalid input", () => {
  const valid = bucketFromTimestamp("2026-06-15T09:30:00");
  assert.equal(valid.date, "2026-06-15");
  assert.equal(valid.hour, "09");

  const fallback = bucketFromTimestamp("not a date", fixedNow.getTime());
  assert.equal(fallback.date, "2026-06-15");
  assert.equal(fallback.hour, "12");
});

test("daysBetween counts local calendar days inclusively", () => {
  assert.equal(daysBetween("2026-06-15", "2026-06-15"), 1);
  assert.equal(daysBetween("2026-06-14", "2026-06-15"), 2);
  assert.equal(daysBetween("2026-03-07", "2026-06-15"), 101);
});

test("activeDayAverage ignores low/noise days when active days exist", () => {
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: Array.from({ length: 20 }, (_, i) => ({ timestamp: i, date: "2026-06-14", hour: "10" })),
      },
      b: {
        path: "b",
        sessionId: "s2",
        mtimeMs: 0,
        size: 0,
        prompts: Array.from({ length: 2 }, (_, i) => ({ timestamp: i, date: "2026-06-15", hour: "11" })),
      },
    },
  }, fixedNow);

  assert.equal(activeDayAverage(store, fixedNow), 20);
});

test("footerText formats compact counters", () => {
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: Array.from({ length: 12 }, (_, i) => ({ timestamp: i, date: "2026-06-15", hour: "10" })),
      },
    },
  }, fixedNow);

  assert.equal(footerText(5, store, "↑"), "5/12/12↑");
});

test("replaceFileRecordIncremental updates aggregates without a full recompute", () => {
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      current: {
        path: "current",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: [{ timestamp: 1, date: "2026-06-15", hour: "10" }],
      },
      old: {
        path: "old",
        sessionId: "s2",
        mtimeMs: 0,
        size: 0,
        prompts: [{ timestamp: 2, date: "2026-06-14", hour: "09" }],
      },
    },
  }, fixedNow);

  const updated = replaceFileRecordIncremental(store, {
    path: "current",
    sessionId: "s1",
    mtimeMs: 1,
    size: 1,
    prompts: [
      { timestamp: 1, date: "2026-06-15", hour: "10" },
      { timestamp: 3, date: "2026-06-15", hour: "11" },
    ],
  }, fixedNow);

  assert.equal(updated.daily["2026-06-15"], 2);
  assert.equal(updated.daily["2026-06-14"], 1);
  assert.equal(updated.hourly["2026-06-15 11"], 1);
  assert.equal(updated.sessions.s1, 2);
  assert.equal(updated.sessions.s2, 1);
});

test("trendArrow keeps showing direction when a baseline exists", () => {
  assert.equal(trendArrow(undefined, 3), "");
  assert.equal(trendArrow(2, 3), "↑");
  assert.equal(trendArrow(4, 3), "↓");
  assert.equal(trendArrow(3, 3), "↑");
});

test("trendArrowForStore falls back to recent activity once there is enough data", () => {
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      old: {
        path: "old",
        sessionId: "old",
        mtimeMs: 0,
        size: 0,
        prompts: Array.from({ length: 20 }, (_, i) => ({ timestamp: i, date: "2026-06-01", hour: "10" })),
      },
      recent: {
        path: "recent",
        sessionId: "recent",
        mtimeMs: 0,
        size: 0,
        prompts: Array.from({ length: 40 }, (_, i) => ({ timestamp: i, date: "2026-06-15", hour: "10" })),
      },
    },
  }, fixedNow);

  assert.equal(trendArrowForStore(store, fixedNow), "↑");
});
