import test from "node:test";
import assert from "node:assert/strict";
import { detailLines, footerText, modelChoiceLabel } from "../extensions/tally/ui.ts";
import { activeDayAverage, bucketFromTimestamp, createEmptyStore, dailyHigh, daysBetween, fiveHourDemand, recomputeAggregates, replaceFileRecordIncremental, trendArrow, trendArrowForStore } from "../extensions/tally/stats.ts";

const fixedNow = new Date("2026-06-15T12:00:00");

function promptAt(date: string, hour: number, minute = 0, second = 0) {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return {
    timestamp: new Date(year, month - 1, day, hour, minute, second).getTime(),
    date,
    hour: String(hour).padStart(2, "0"),
  };
}

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
  assert.equal(dailyHigh(store), 20);
  assert.ok(detailLines(store, 3, fixedNow).includes("Daily high     20"));
});

test("fiveHourDemand summarizes active daily 5h peaks over the last 30 days", () => {
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      recent: {
        path: "recent",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: [
          ...Array.from({ length: 10 }, (_, i) => promptAt("2026-06-14", 23, i)),
          ...Array.from({ length: 5 }, (_, i) => promptAt("2026-06-15", 0, i)),
        ],
      },
      old: {
        path: "old",
        sessionId: "s2",
        mtimeMs: 0,
        size: 0,
        prompts: Array.from({ length: 30 }, (_, i) => promptAt("2026-05-01", 10, i)),
      },
    },
  }, fixedNow);

  assert.deepEqual(fiveHourDemand(store, fixedNow), {
    average: 15,
    high: 15,
    peak: 15,
    activeDays: 1,
    lookbackDays: 30,
  });
});

test("modelChoiceLabel formats provider and model id", () => {
  assert.equal(modelChoiceLabel({ provider: "deepseek", id: "deepseek-v4-pro" }), "deepseek/deepseek-v4-pro");
  assert.equal(modelChoiceLabel({ id: "deepseek-v4-pro" }), "deepseek-v4-pro");
  assert.equal(modelChoiceLabel(undefined), undefined);
});

test("detailLines include active model when available", () => {
  const store = createEmptyStore(fixedNow);
  assert.ok(detailLines(store, 0, fixedNow, "deepseek/deepseek-v4-pro").includes("Model          deepseek/deepseek-v4-pro"));
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

  assert.equal(footerText(5, store, "↑", fixedNow), "5/12/12↑");
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
