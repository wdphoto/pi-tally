import test from "node:test";
import assert from "node:assert/strict";
import { allDetailLines, detailLines, footerText, modelChoiceLabel } from "../extensions/tally/ui.ts";
import { activeDayAverage, bucketFromTimestamp, createEmptyStore, dailyHigh, daysBetween, fiveHourDemand, recomputeAggregates, replaceFileRecordIncremental, totalSubmittedChars, trendArrow, trendArrowForStore, userMessageCharCount } from "../extensions/tally/stats.ts";

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
  assert.ok(detailLines(store, 3, fixedNow).includes("Record:        20 on 2026-06-14"));
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

test("Pi Crumbs count submitted user message text without treating it as keystrokes", () => {
  assert.equal(userMessageCharCount({ role: "user", content: "hello 🌙" }), 7);
  assert.equal(userMessageCharCount({ role: "user", content: [{ type: "text", text: "hello" }, { type: "input_text", value: " world" }] }), 11);

  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: [
          { ...promptAt("2026-06-15", 10), chars: 7 },
          { ...promptAt("2026-06-15", 11), chars: 11 },
        ],
      },
    },
  }, fixedNow);

  assert.equal(totalSubmittedChars(store), 18);
  assert.equal(store.crumbs.dailyChars["2026-06-15"], 18);
  assert.ok(detailLines(store, 2, fixedNow).some((line) => line.startsWith("Pi Crumbs:     ")));
});

test("Pi Crumbs streak wording says again", () => {
  const dates = ["2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"];
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: dates.map((date) => ({ ...promptAt(date, 10), chars: 1 })),
      },
    },
  }, fixedNow);

  const lines = detailLines(store, 10, fixedNow);
  assert.ok(lines.includes("Streak:        10d current / 10d record"));
  const crumb = lines.find((line) => line.startsWith("Pi Crumbs:")) ?? "";
  assert.match(crumb, /Please don't do that again\./);
  assert.doesNotMatch(crumb, /agent/);
});

test("allDetailLines lists every available Pi Crumb", () => {
  const store = recomputeAggregates({
    ...createEmptyStore(fixedNow),
    files: {
      a: {
        path: "a",
        sessionId: "s1",
        mtimeMs: 0,
        size: 0,
        prompts: [
          { ...promptAt("2026-06-15", 10), chars: 7 },
          { ...promptAt("2026-06-15", 11), chars: 11 },
        ],
      },
    },
  }, fixedNow);

  const lines = allDetailLines(store, 2, fixedNow, "deepseek/deepseek-v4-pro");
  assert.ok(lines.includes("Pi Crumbs:"));
  assert.ok(lines.includes("- 18 characters sent to Pi."));
  assert.ok(lines.includes("- favorite model deepseek/deepseek-v4-pro"));
  assert.ok(lines.includes("- avg prompt length 9 chars"));
  assert.ok(lines.includes("- longest prompt 11 chars"));
  assert.ok(lines.every((line) => !line.includes("current streak")));
});

test("modelChoiceLabel formats provider and model id", () => {
  assert.equal(modelChoiceLabel({ provider: "deepseek", id: "deepseek-v4-pro" }), "deepseek/deepseek-v4-pro");
  assert.equal(modelChoiceLabel({ id: "deepseek-v4-pro" }), "deepseek-v4-pro");
  assert.equal(modelChoiceLabel(undefined), undefined);
});

test("detailLines include favorite model as a Pi Crumbs fact when available", () => {
  const store = createEmptyStore(fixedNow);
  assert.ok(detailLines(store, 0, fixedNow, "deepseek/deepseek-v4-pro").includes("Pi Crumbs:     favorite model deepseek/deepseek-v4-pro"));
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
        prompts: [{ timestamp: 1, date: "2026-06-15", hour: "10", chars: 4 }],
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
      { timestamp: 1, date: "2026-06-15", hour: "10", chars: 4 },
      { timestamp: 3, date: "2026-06-15", hour: "11", chars: 6 },
    ],
  }, fixedNow);

  assert.equal(updated.daily["2026-06-15"], 2);
  assert.equal(updated.daily["2026-06-14"], 1);
  assert.equal(updated.hourly["2026-06-15 11"], 1);
  assert.equal(updated.sessions.s1, 2);
  assert.equal(updated.sessions.s2, 1);
  assert.equal(updated.crumbs.totalChars, 10);
  assert.equal(updated.crumbs.longestPromptChars, 6);
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
