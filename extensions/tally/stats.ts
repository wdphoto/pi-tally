import { ACTIVE_DAY_MIN_PROMPTS, FIVE_HOUR_DEMAND_LOOKBACK_DAYS, FIVE_HOUR_WINDOW_HOURS } from "./config.ts";
import { STORE_VERSION, type FileRecord, type FiveHourDemandStats, type PromptFact, type TallyStore } from "./types.ts";

export function createEmptyStore(now = new Date()): TallyStore {
  return {
    version: STORE_VERSION,
    files: {},
    daily: {},
    hourly: {},
    sessions: {},
    footerEnabled: true,
    updatedAt: now.toISOString(),
  };
}

export function bucketFromTimestamp(ts: unknown, fallback = Date.now()): { timestamp: number; date: string; hour: string } {
  const value = typeof ts === "number" || typeof ts === "string" ? ts : fallback;
  const candidate = new Date(value);
  const safe = Number.isNaN(candidate.getTime()) ? new Date(fallback) : candidate;
  const date = `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}-${String(safe.getDate()).padStart(2, "0")}`;
  const hour = String(safe.getHours()).padStart(2, "0");
  return { timestamp: safe.getTime(), date, hour };
}

export function todayStr(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function nDaysAgo(n: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

export function daysBetween(a: string, b: string): number {
  const parse = (s: string): number => {
    const [y = 1970, m = 1, d = 1] = s.split("-").map(Number);
    return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
  };
  return Math.max(1, Math.floor(Math.abs(parse(b) - parse(a)) / 86_400_000) + 1);
}

export function recomputeAggregates(store: TallyStore, now = new Date()): TallyStore {
  const next: TallyStore = {
    version: STORE_VERSION,
    files: store.files,
    daily: {},
    hourly: {},
    sessions: {},
    footerEnabled: store.footerEnabled !== false,
    updatedAt: now.toISOString(),
    ...(store.previousActiveDayAverage !== undefined ? { previousActiveDayAverage: store.previousActiveDayAverage } : {}),
  };

  for (const record of Object.values(store.files)) {
    next.sessions[record.sessionId] = (next.sessions[record.sessionId] ?? 0) + record.prompts.length;
    for (const prompt of record.prompts) {
      next.daily[prompt.date] = (next.daily[prompt.date] ?? 0) + 1;
      next.hourly[`${prompt.date} ${prompt.hour}`] = (next.hourly[`${prompt.date} ${prompt.hour}`] ?? 0) + 1;
      if (!next.earliestDate || prompt.date < next.earliestDate) next.earliestDate = prompt.date;
    }
    if (record.earliestDate && (!next.earliestDate || record.earliestDate < next.earliestDate)) {
      next.earliestDate = record.earliestDate;
    }
  }

  return next;
}

function adjustCount(map: Record<string, number>, key: string, delta: number): void {
  const next = (map[key] ?? 0) + delta;
  if (next <= 0) delete map[key];
  else map[key] = next;
}

function earliestForRecord(record: FileRecord): string | undefined {
  if (record.earliestDate) return record.earliestDate;
  return record.prompts.reduce<string | undefined>((earliest, prompt) => {
    if (!earliest || prompt.date < earliest) return prompt.date;
    return earliest;
  }, undefined);
}

export function replaceFileRecordIncremental(store: TallyStore, record: FileRecord, now = new Date()): TallyStore {
  const previous = store.files[record.path];
  const files = { ...store.files, [record.path]: record };
  const daily = { ...store.daily };
  const hourly = { ...store.hourly };
  const sessions = { ...store.sessions };

  if (previous) {
    adjustCount(sessions, previous.sessionId, -previous.prompts.length);
    for (const prompt of previous.prompts) {
      adjustCount(daily, prompt.date, -1);
      adjustCount(hourly, `${prompt.date} ${prompt.hour}`, -1);
    }
  }

  adjustCount(sessions, record.sessionId, record.prompts.length);
  for (const prompt of record.prompts) {
    adjustCount(daily, prompt.date, 1);
    adjustCount(hourly, `${prompt.date} ${prompt.hour}`, 1);
  }

  let earliestDate: string | undefined;
  for (const file of Object.values(files)) {
    const candidate = earliestForRecord(file);
    if (candidate && (!earliestDate || candidate < earliestDate)) earliestDate = candidate;
  }

  return {
    version: STORE_VERSION,
    files,
    daily,
    hourly,
    sessions,
    footerEnabled: store.footerEnabled !== false,
    updatedAt: now.toISOString(),
    ...(earliestDate ? { earliestDate } : {}),
    ...(store.previousActiveDayAverage !== undefined ? { previousActiveDayAverage: store.previousActiveDayAverage } : {}),
  };
}

export function replaceFileRecord(store: TallyStore, record: FileRecord): TallyStore {
  return replaceFileRecordIncremental(store, record);
}

export function isUserMessageEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as { type?: unknown; message?: { role?: unknown } };
  return e.type === "message" && e.message?.role === "user";
}

export function countUserMessages(entries: Iterable<unknown>): number {
  let count = 0;
  for (const entry of entries) {
    if (isUserMessageEntry(entry)) count++;
  }
  return count;
}

export function promptFactFromEntry(entry: unknown, fallback = Date.now()): PromptFact | undefined {
  if (!isUserMessageEntry(entry)) return undefined;
  const e = entry as { id?: unknown; timestamp?: unknown; message?: { timestamp?: unknown } };
  const bucket = bucketFromTimestamp(e.message?.timestamp ?? e.timestamp, fallback);
  return {
    ...(typeof e.id === "string" ? { id: e.id } : {}),
    timestamp: bucket.timestamp,
    date: bucket.date,
    hour: bucket.hour,
  };
}

export function activeDayCounts(store: Pick<TallyStore, "daily">, windowDays?: number, now = new Date()): number[] {
  if (typeof windowDays === "number") {
    const counts: number[] = [];
    for (let i = 0; i < windowDays; i++) {
      const count = store.daily[nDaysAgo(i, now)] ?? 0;
      if (count >= ACTIVE_DAY_MIN_PROMPTS) counts.push(count);
    }
    return counts;
  }
  return Object.values(store.daily).filter((count) => count >= ACTIVE_DAY_MIN_PROMPTS);
}

export function avgCounts(counts: number[]): number {
  if (counts.length === 0) return 0;
  return Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length);
}

export function activeDayAverage(store: TallyStore, now = new Date()): number {
  const activeCounts = activeDayCounts(store, undefined, now);
  if (activeCounts.length > 0) return avgCounts(activeCounts);

  const total = totalPrompts(store);
  const days = daysBetween(store.earliestDate || todayStr(now), todayStr(now));
  return Math.round(total / days);
}

export function dailyHigh(store: Pick<TallyStore, "daily">): number {
  return Math.max(0, ...Object.values(store.daily));
}

export function rollingAverage(store: TallyStore, windowDays: number, now = new Date()): number {
  return avgCounts(activeDayCounts(store, windowDays, now));
}

export function todayPrompts(store: TallyStore, now = new Date()): number {
  return store.daily[todayStr(now)] ?? 0;
}

export function todayHourlyRate(store: TallyStore, now = new Date()): string {
  const hours = now.getHours() + now.getMinutes() / 60;
  if (hours < 0.5) return "—";
  const rate = todayPrompts(store, now) / hours;
  return rate >= 0.05 ? rate.toFixed(1) : "—";
}

function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((values[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentileNearestRank(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function maxRollingWindowCount(starts: number[], allTimestamps: number[], windowMs: number): number {
  let max = 0;
  for (const start of starts) {
    const from = lowerBound(allTimestamps, start);
    const to = lowerBound(allTimestamps, start + windowMs);
    max = Math.max(max, to - from);
  }
  return max;
}

export function fiveHourDemand(store: TallyStore, now = new Date(), lookbackDays = FIVE_HOUR_DEMAND_LOOKBACK_DAYS): FiveHourDemandStats {
  const endDate = todayStr(now);
  const startDate = nDaysAgo(Math.max(lookbackDays - 1, 0), now);
  const activeDates = Object.keys(store.daily)
    .filter((date) => date >= startDate && date <= endDate && (store.daily[date] ?? 0) >= ACTIVE_DAY_MIN_PROMPTS)
    .sort();
  const activeDateSet = new Set(activeDates);
  const startsByDate = new Map<string, number[]>();
  const allTimestamps: number[] = [];

  for (const record of Object.values(store.files)) {
    for (const prompt of record.prompts) {
      if (prompt.date < startDate || prompt.date > endDate || !Number.isFinite(prompt.timestamp)) continue;
      allTimestamps.push(prompt.timestamp);
      if (!activeDateSet.has(prompt.date)) continue;
      const starts = startsByDate.get(prompt.date) ?? [];
      starts.push(prompt.timestamp);
      startsByDate.set(prompt.date, starts);
    }
  }

  allTimestamps.sort((a, b) => a - b);
  const windowMs = FIVE_HOUR_WINDOW_HOURS * 60 * 60 * 1000;
  const dailyPeaks = activeDates.map((date) => maxRollingWindowCount(startsByDate.get(date) ?? [], allTimestamps, windowMs));

  return {
    average: avgCounts(dailyPeaks),
    high: percentileNearestRank(dailyPeaks, 0.9),
    peak: dailyPeaks.length > 0 ? Math.max(...dailyPeaks) : 0,
    activeDays: dailyPeaks.length,
    lookbackDays,
  };
}

export function totalPrompts(store: TallyStore): number {
  return Object.values(store.daily).reduce((sum, count) => sum + count, 0);
}

export function totalSessions(store: TallyStore): number {
  return Object.keys(store.sessions).length;
}

export function trendArrow(previous: number | undefined, current: number): "" | "↑" | "↓" {
  if (previous === undefined) return "";
  return current >= previous ? "↑" : "↓";
}

export function trendArrowForStore(store: TallyStore, now = new Date()): "" | "↑" | "↓" {
  const current = activeDayAverage(store, now);
  const storedTrend = trendArrow(store.previousActiveDayAverage, current);
  if (storedTrend) return storedTrend;

  const activeCounts = activeDayCounts(store, undefined, now);
  if (activeCounts.length < 2) return "";

  const recentAverage = rollingAverage(store, 7, now);
  if (recentAverage > 0) return recentAverage >= current ? "↑" : "↓";

  const latestActiveCount = Object.entries(store.daily)
    .sort(([a], [b]) => b.localeCompare(a))
    .find(([, count]) => count >= ACTIVE_DAY_MIN_PROMPTS)?.[1];
  return latestActiveCount === undefined ? "" : latestActiveCount >= current ? "↑" : "↓";
}
