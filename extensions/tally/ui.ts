import { ACTIVE_DAY_MIN_PROMPTS } from "./config.ts";
import {
  activeDayAverage,
  activeDayCounts,
  daysBetween,
  peak5hWeekly,
  rollingAverage,
  todayHourlyRate,
  todayPrompts,
  todayStr,
  totalPrompts,
  totalSessions,
} from "./stats.ts";
import type { DetailSnapshot, TallyPaths, TallyStore } from "./types.ts";

export function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

export function footerText(activeBranchPrompts: number, store: TallyStore, arrow = ""): string {
  return `${compactNumber(activeBranchPrompts)}/${compactNumber(todayPrompts(store))}/${compactNumber(activeDayAverage(store))}${arrow}`;
}

export function buildDetailSnapshot(store: TallyStore, activeBranchPrompts: number, now = new Date()): DetailSnapshot {
  const peak = peak5hWeekly(store, now);
  const today = todayStr(now);
  return {
    activeBranchPrompts,
    todayPrompts: todayPrompts(store, now),
    hourlyRate: todayHourlyRate(store, now),
    peak5hPrompts: peak.prompts,
    peak5hRate: peak.rate,
    activeDayAverage: activeDayAverage(store, now),
    weeklyAverage: rollingAverage(store, 7, now),
    monthlyAverage: rollingAverage(store, 30, now),
    allTimePrompts: totalPrompts(store),
    totalSessions: totalSessions(store),
    activeDays: activeDayCounts(store, undefined, now).length,
    calendarDays: daysBetween(store.earliestDate || today, today),
    ...(store.earliestDate ? { earliestDate: store.earliestDate } : {}),
  };
}

export function detailLines(store: TallyStore, activeBranchPrompts: number, now = new Date()): string[] {
  const s = buildDetailSnapshot(store, activeBranchPrompts, now);
  const hourlySuffix = s.hourlyRate !== "—" ? ` (${s.hourlyRate}/hr)` : "";
  return [
    "pi-tally",
    "────────",
    `Active branch  ${compactNumber(s.activeBranchPrompts)} prompts`,
    `Today          ${compactNumber(s.todayPrompts)} prompts${hourlySuffix}`,
    `Peak 5h/wk     ${compactNumber(s.peak5hPrompts)} prompts (${s.peak5hRate}/hr)`,
    `Active avg     ${compactNumber(s.activeDayAverage)} prompts/day (days >=${ACTIVE_DAY_MIN_PROMPTS})`,
    `Weekly avg     ${compactNumber(s.weeklyAverage)} prompts/day (active days in rolling 7d)`,
    `Monthly avg    ${compactNumber(s.monthlyAverage)} prompts/day (active days in rolling 30d)`,
    `All time       ${compactNumber(s.allTimePrompts)} prompts across ${compactNumber(s.totalSessions)} sessions`,
    `Since          ${s.earliestDate || "?"} (${compactNumber(s.activeDays)} active / ${compactNumber(s.calendarDays)} calendar days)`,
    "",
    "Local counters only. No telemetry, no network, no upload.",
  ];
}

export function statusLines(paths: TallyPaths, store: TallyStore): string[] {
  return [
    "pi-tally status",
    "───────────────",
    `Store      ${paths.storeFile}`,
    `Sessions   ${paths.sessionsDir}`,
    `Indexed    ${compactNumber(Object.keys(store.files).length)} session files`,
    `Updated    ${store.updatedAt}`,
    "",
    "pi-tally only counts local Pi session messages and stores the tally locally.",
  ];
}

export function truncatePlainLine(line: string, width: number): string {
  if (width <= 0) return "";
  if (line.length <= width) return line.padEnd(width, " ");
  if (width <= 3) return line.slice(0, width);
  return `${line.slice(0, width - 3)}...`;
}
