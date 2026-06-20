import {
  activeDayAverage,
  activeDayCounts,
  averagePromptChars,
  busiestDay,
  currentStreakDays,
  daysBetween,
  fiveHourDemand,
  lateNightPrompts,
  longestPromptChars,
  longestStreakDays,
  rollingAverage,
  rollingAverageTrendArrow,
  rollingPromptCount,
  todayHourlyRate,
  todayPrompts,
  todayStr,
  totalPrompts,
  totalSessions,
  totalSubmittedChars,
} from "./stats.ts";
import type { DetailSnapshot, TallyPaths, TallyStore } from "./types.ts";

export function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

export function wholeNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function footerText(activeTreePathTodayPrompts: number, store: TallyStore, arrow = "", now = new Date()): string {
  return `${compactNumber(activeTreePathTodayPrompts)}/${compactNumber(todayPrompts(store, now))}/${compactNumber(activeDayAverage(store, now))}${arrow}`;
}

export function modelChoiceLabel(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const m = model as { provider?: unknown; id?: unknown; modelId?: unknown; name?: unknown };
  const provider = typeof m.provider === "string" ? m.provider : undefined;
  const id = typeof m.id === "string" ? m.id : typeof m.modelId === "string" ? m.modelId : typeof m.name === "string" ? m.name : undefined;
  if (!id) return undefined;
  return provider ? `${provider}/${id}` : id;
}

function piCrumbsFacts(store: TallyStore, now = new Date(), activeModel?: string): string[] {
  const totalChars = totalSubmittedChars(store);
  const currentStreak = currentStreakDays(store, now);
  const longestStreak = longestStreakDays(store);
  const latePrompts = lateNightPrompts(store);
  const longestPrompt = longestPromptChars(store);
  const busiest = busiestDay(store);
  const facts = [
    ...(totalChars > 0 ? [`${wholeNumber(totalChars)} characters sent to Pi.`] : []),
    ...(activeModel ? [`favorite model ${activeModel}`] : []),
    ...(totalChars > 0 ? [`avg prompt length ${compactNumber(averagePromptChars(store))} chars`] : []),
    ...(longestPrompt > 0 ? [`longest prompt ${compactNumber(longestPrompt)} chars`] : []),
    ...(currentStreak >= 10 ? [`You have a ${compactNumber(currentStreak)}-day streak. Please don't do that again.`] : []),
    ...(longestStreak >= 10 && longestStreak !== currentStreak ? [`You had a ${compactNumber(longestStreak)}-day streak. Please don't do that again.`] : []),
    ...(latePrompts > 0 ? [`${compactNumber(latePrompts)} late-night prompts indexed`] : []),
    ...(busiest ? [`busiest day ${busiest.date} with ${compactNumber(busiest.prompts)} prompts`] : []),
  ];

  return facts.length > 0 ? facts : ["counting prompt characters from now on"];
}

function piCrumbsFact(store: TallyStore, now = new Date(), activeModel?: string): string {
  const hour = now.getHours();
  const latePrompts = lateNightPrompts(store);
  if ((hour >= 23 || hour < 5) && todayPrompts(store, now) > 0) {
    return latePrompts > 0 ? `${compactNumber(latePrompts)} late-night prompts indexed. Go to bed?` : "working late. Go to bed?";
  }

  const currentStreak = currentStreakDays(store, now);
  if (currentStreak >= 10) return `You have a ${compactNumber(currentStreak)}-day streak. Please don't do that again.`;

  const facts = piCrumbsFacts(store, now, activeModel);
  const daySeed = Number(todayStr(now).replace(/-/g, ""));
  return facts[daySeed % facts.length] ?? facts[0] ?? "counting prompt characters from now on";
}

export function buildDetailSnapshot(store: TallyStore, activeTreePathPrompts: number, now = new Date(), activeModel?: string): DetailSnapshot {
  const today = todayStr(now);
  const recordDay = busiestDay(store);
  return {
    ...(activeModel ? { activeModel } : {}),
    activeTreePathPrompts,
    todayPrompts: todayPrompts(store, now),
    hourlyRate: todayHourlyRate(store, now),
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
    piCrumbsFact: piCrumbsFact(store, now, activeModel),
    ...(store.earliestDate ? { earliestDate: store.earliestDate } : {}),
  };
}

export function detailLines(store: TallyStore, activeTreePathPrompts: number, now = new Date(), activeModel?: string): string[] {
  const s = buildDetailSnapshot(store, activeTreePathPrompts, now, activeModel);
  const hourlySuffix = s.hourlyRate !== "—" ? ` (${s.hourlyRate}/hr)` : "";
  const record = s.recordDay ? `${compactNumber(s.recordDay.prompts)} on ${s.recordDay.date}` : "—";
  const streak = s.currentStreakDays > 0 ? `${compactNumber(s.currentStreakDays)}d current / ${compactNumber(s.longestStreakDays)}d record` : "—";
  return [
    `Since:         ${s.earliestDate || "?"} (${compactNumber(s.activeDays)} active / ${compactNumber(s.calendarDays)} calendar days)`,
    `Tree:          ${compactNumber(s.activeTreePathPrompts)}`,
    `Today:         ${compactNumber(s.todayPrompts)} so far${hourlySuffix}`,
    `Daily:         avg ${compactNumber(s.activeDayAverage)}   24h ${compactNumber(s.last24HourPrompts)}   7d ${compactNumber(s.weeklyAverage)}${s.weeklyTrend}   30d ${compactNumber(s.monthlyAverage)}${s.monthlyTrend}`,
    `5h window:     avg ${compactNumber(s.fiveHourDemand.average)}   high ${compactNumber(s.fiveHourDemand.high)}   peak ${compactNumber(s.fiveHourDemand.peak)}`,
    `Streak:        ${streak}`,
    `Record:        ${record}`,
    `Total:         ${compactNumber(s.allTimePrompts)} across ${compactNumber(s.totalSessions)} sessions`,
    "",
    `Pi Crumbs:     ${s.piCrumbsFact}`,
  ];
}

export function allDetailLines(store: TallyStore, activeTreePathPrompts: number, now = new Date(), activeModel?: string): string[] {
  const s = buildDetailSnapshot(store, activeTreePathPrompts, now, activeModel);
  const hourlySuffix = s.hourlyRate !== "—" ? ` (${s.hourlyRate}/hr)` : "";
  const record = s.recordDay ? `${compactNumber(s.recordDay.prompts)} on ${s.recordDay.date}` : "—";
  const streak = s.currentStreakDays > 0 ? `${compactNumber(s.currentStreakDays)}d current / ${compactNumber(s.longestStreakDays)}d record` : "—";
  return [
    `Since:         ${s.earliestDate || "?"} (${compactNumber(s.activeDays)} active / ${compactNumber(s.calendarDays)} calendar days)`,
    `Tree:          ${compactNumber(s.activeTreePathPrompts)}`,
    `Today:         ${compactNumber(s.todayPrompts)} so far${hourlySuffix}`,
    `Daily:         avg ${compactNumber(s.activeDayAverage)}   24h ${compactNumber(s.last24HourPrompts)}   7d ${compactNumber(s.weeklyAverage)}${s.weeklyTrend}   30d ${compactNumber(s.monthlyAverage)}${s.monthlyTrend}`,
    `5h window:     avg ${compactNumber(s.fiveHourDemand.average)}   high ${compactNumber(s.fiveHourDemand.high)}   peak ${compactNumber(s.fiveHourDemand.peak)}`,
    `Streak:        ${streak}`,
    `Record:        ${record}`,
    `Total:         ${compactNumber(s.allTimePrompts)} across ${compactNumber(s.totalSessions)} sessions`,
    "",
    "Pi Crumbs:",
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
