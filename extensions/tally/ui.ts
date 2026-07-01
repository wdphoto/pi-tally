import {
  activeDayAverage,
  activeDayCounts,
  busiestDay,
  currentStreakDays,
  daysBetween,
  fiveHourDemand,
  longestStreakDays,
  responseSpeedStats,
  rollingAverage,
  rollingAverageTrendArrow,
  rollingPromptCount,
  todayHourlyRate,
  todayPrompts,
  todayStr,
  totalPrompts,
  totalSessions,
} from "./stats.ts";
import { piCrumbsFact, piCrumbsFacts } from "./crumbs.ts";
import type { DetailSnapshot, TallyPaths, TallyStore } from "./types.ts";

type ThemeLike = { fg?: (color: string, value: string) => string };

export interface FooterSpeedometer {
  tps: number;
  live?: boolean;
}

export function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

function messageCount(value: number): string {
  return `${compactNumber(value)} ${value === 1 ? "message" : "messages"}`;
}

function dayCount(value: number): string {
  return `${compactNumber(value)} ${value === 1 ? "day" : "days"}`;
}

function sessionCount(value: number): string {
  return `${compactNumber(value)} ${value === 1 ? "session" : "sessions"}`;
}

export function footerText(activeTreePathTodayPrompts: number, store: TallyStore, arrow = "", now = new Date()): string {
  return `${compactNumber(activeTreePathTodayPrompts)}/${compactNumber(todayPrompts(store, now))}/${compactNumber(activeDayAverage(store, now))}${arrow}`;
}

function tps(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${value.toFixed(value >= 10 ? 0 : 1)} tok/s` : "—";
}

function speedometerStage(value: number): number {
  const thresholds = [8, 16, 28, 44, 64, 90, 120];
  return thresholds.filter((threshold) => value >= threshold).length;
}

function stageColor(index: number): string {
  if (index < 2) return "dim";
  if (index < 4) return "muted";
  if (index < 5) return "text";
  return "accent";
}

function fg(theme: ThemeLike | undefined, color: string, value: string): string {
  return theme?.fg?.(color, value) ?? value;
}

export function speedometerText(speedometer: FooterSpeedometer | undefined, theme?: ThemeLike): string {
  if (!speedometer || !Number.isFinite(speedometer.tps) || speedometer.tps < 0) return "";
  const stage = speedometerStage(speedometer.tps);
  const label = fg(theme, "dim", `${speedometer.live ? "~" : ""}${tps(speedometer.tps)}`);
  const dots = Array.from({ length: 7 }, (_, index) => {
    const active = index < stage;
    return fg(theme, active ? stageColor(index) : "dim", active ? "●" : "○");
  }).join("");
  return `${label} ${dots}`;
}

export function footerStatusText(activeTreePathTodayPrompts: number, store: TallyStore, arrow = "", speedometer?: FooterSpeedometer, theme?: ThemeLike, now = new Date()): string {
  const base = fg(theme, "dim", footerText(activeTreePathTodayPrompts, store, arrow, now));
  const speed = speedometerText(speedometer, theme);
  return speed ? `${base}  ${speed}` : base;
}

export function modelChoiceLabel(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const m = model as { provider?: unknown; id?: unknown; modelId?: unknown; name?: unknown };
  const provider = typeof m.provider === "string" ? m.provider : undefined;
  const id = typeof m.id === "string" ? m.id : typeof m.modelId === "string" ? m.modelId : typeof m.name === "string" ? m.name : undefined;
  if (!id) return undefined;
  return provider ? `${provider}/${id}` : id;
}

export function buildDetailSnapshot(store: TallyStore, activeTreePathPrompts: number, now = new Date(), activeModel?: string, piCrumbsRotationIndex?: number): DetailSnapshot {
  const today = todayStr(now);
  const recordDay = busiestDay(store);
  return {
    ...(activeModel ? { activeModel } : {}),
    activeTreePathPrompts,
    todayPrompts: todayPrompts(store, now),
    hourlyRate: todayHourlyRate(store, now),
    responseSpeed: responseSpeedStats(store),
    fiveHourDemand: fiveHourDemand(store, now),
    activeDayAverage: activeDayAverage(store, now),
    last24HourPrompts: rollingPromptCount(store, 24, now),
    weeklyAverage: rollingAverage(store, 7, now),
    weeklyTrend: rollingAverageTrendArrow(store, 7, now),
    monthlyAverage: rollingAverage(store, 30, now),
    monthlyTrend: rollingAverageTrendArrow(store, 30, now),
    ...(recordDay ? { recordDay } : {}),
    currentStreakDays: currentStreakDays(store, now),
    longestStreakDays: longestStreakDays(store),
    allTimePrompts: totalPrompts(store),
    totalSessions: totalSessions(store),
    activeDays: activeDayCounts(store, undefined, now).length,
    calendarDays: daysBetween(store.earliestDate || today, today),
    piCrumbsFact: piCrumbsFact(store, now, activeModel, piCrumbsRotationIndex),
    ...(store.earliestDate ? { earliestDate: store.earliestDate } : {}),
  };
}

function responseSpeedLine(speed: DetailSnapshot["responseSpeed"]): string {
  const samples = speed.samples > 0 ? ` (${compactNumber(speed.samples)} ${speed.samples === 1 ? "sample" : "samples"})` : "";
  return `TPS meter:    latest ${tps(speed.latest)}   avg ${tps(speed.average)}${samples}`;
}

function statLines(s: DetailSnapshot): string[] {
  const hourlySuffix = s.hourlyRate !== "—" ? ` (${s.hourlyRate} messages/hr)` : "";
  const record = s.recordDay ? `${messageCount(s.recordDay.prompts)} on ${s.recordDay.date}` : "—";
  const streak = s.currentStreakDays > 0 ? `${dayCount(s.currentStreakDays)} current / ${dayCount(s.longestStreakDays)} record` : "—";
  return [
    `Since:         ${s.earliestDate || "?"} (${compactNumber(s.activeDays)} active days / ${compactNumber(s.calendarDays)} calendar days)`,
    `Tree:          ${messageCount(s.activeTreePathPrompts)} on active path`,
    `Today:         ${messageCount(s.todayPrompts)} so far${hourlySuffix}`,
    responseSpeedLine(s.responseSpeed),
    `Daily avg:     ${messageCount(s.activeDayAverage)}/day   last 24h ${messageCount(s.last24HourPrompts)}`,
    `Recent avg:    7d ${messageCount(s.weeklyAverage)}/day${s.weeklyTrend}   30d ${messageCount(s.monthlyAverage)}/day${s.monthlyTrend}`,
    `5h window:     avg ${messageCount(s.fiveHourDemand.average)}   high ${messageCount(s.fiveHourDemand.high)}   peak ${messageCount(s.fiveHourDemand.peak)}`,
    `Streak:        ${streak}`,
    `Record:        ${record}`,
    `Total:         ${messageCount(s.allTimePrompts)} across ${sessionCount(s.totalSessions)}`,
  ];
}

export function detailLines(store: TallyStore, activeTreePathPrompts: number, now = new Date(), activeModel?: string, piCrumbsRotationIndex?: number): string[] {
  const s = buildDetailSnapshot(store, activeTreePathPrompts, now, activeModel, piCrumbsRotationIndex);
  return [
    ...statLines(s),
    "",
    `Crumb:         ${s.piCrumbsFact}`,
  ];
}

export function allDetailLines(store: TallyStore, activeTreePathPrompts: number, now = new Date(), activeModel?: string): string[] {
  const s = buildDetailSnapshot(store, activeTreePathPrompts, now, activeModel);
  return [
    ...statLines(s),
    "",
    "Crumbs:",
    ...piCrumbsFacts(store, now, activeModel).map((fact) => `- ${fact}`),
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
    `Toks       ${store.toksEnabled === false ? "disabled" : "enabled"}`,
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
