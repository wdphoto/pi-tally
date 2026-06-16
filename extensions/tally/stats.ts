import { ACTIVE_DAY_MIN_PROMPTS } from "./config.ts";
import { STORE_VERSION, type FileRecord, type PromptFact, type TallyStore } from "./types.ts";

export function createEmptyStore(now = new Date()): TallyStore {
  return {
    version: STORE_VERSION,
    files: {},
    daily: {},
    hourly: {},
    sessions: {},
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

export function replaceFileRecord(store: TallyStore, record: FileRecord): TallyStore {
  return recomputeAggregates({ ...store, files: { ...store.files, [record.path]: record } });
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

export function peak5hWeekly(store: TallyStore, now = new Date()): { prompts: number; rate: string } {
  const buckets: number[] = [];
  for (let day = 6; day >= 0; day--) {
    const d = nDaysAgo(day, now);
    for (let h = 0; h < 24; h++) {
      buckets.push(store.hourly[`${d} ${String(h).padStart(2, "0")}`] ?? 0);
    }
  }

  let max = 0;
  for (let start = 0; start <= buckets.length - 5; start++) {
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += buckets[start + i] ?? 0;
    if (sum > max) max = sum;
  }

  return max > 0 ? { prompts: max, rate: (max / 5).toFixed(1) } : { prompts: 0, rate: "—" };
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
