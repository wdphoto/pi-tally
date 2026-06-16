import {
  activeDayAverage,
  activeDayCounts,
  daysBetween,
  fiveHourDemand,
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

export function footerText(activeBranchPrompts: number, store: TallyStore, arrow = "", now = new Date()): string {
  return `${compactNumber(activeBranchPrompts)}/${compactNumber(todayPrompts(store, now))}/${compactNumber(activeDayAverage(store, now))}${arrow}`;
}

export function buildDetailSnapshot(store: TallyStore, activeBranchPrompts: number, now = new Date()): DetailSnapshot {
  const today = todayStr(now);
  return {
    activeBranchPrompts,
    todayPrompts: todayPrompts(store, now),
    hourlyRate: todayHourlyRate(store, now),
    fiveHourDemand: fiveHourDemand(store, now),
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
    `5h demand      avg ${compactNumber(s.fiveHourDemand.average)} / high ${compactNumber(s.fiveHourDemand.high)} / peak ${compactNumber(s.fiveHourDemand.peak)}`,
    `Active days    ${compactNumber(s.fiveHourDemand.activeDays)} in last ${s.fiveHourDemand.lookbackDays}d`,
    `Today          ${compactNumber(s.todayPrompts)} so far${hourlySuffix}`,
    `This branch    ${compactNumber(s.activeBranchPrompts)}`,
    `Daily avg      ${compactNumber(s.activeDayAverage)}/day on active days`,
    `7d avg         ${compactNumber(s.weeklyAverage)}/day on active days`,
    `30d avg        ${compactNumber(s.monthlyAverage)}/day on active days`,
    `All time       ${compactNumber(s.allTimePrompts)} across ${compactNumber(s.totalSessions)} sessions`,
    `Indexed since  ${s.earliestDate || "?"} (${compactNumber(s.activeDays)} active / ${compactNumber(s.calendarDays)} calendar days)`,
  ];
}

export function statusLines(paths: TallyPaths, store: TallyStore): string[] {
  return [
    "pi-tally status",
    "───────────────",
    `Store      ${paths.storeFile}`,
    `Sessions   ${paths.sessionsDir}`,
    `Indexed    ${compactNumber(Object.keys(store.files).length)} session files`,
    `Footer     ${store.footerEnabled === false ? "disabled" : "enabled"}`,
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
