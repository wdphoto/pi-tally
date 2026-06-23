import { ACTIVE_DAY_MIN_PROMPTS, FIVE_HOUR_DEMAND_LOOKBACK_DAYS, FIVE_HOUR_WINDOW_HOURS } from "./config.ts";
import { STORE_VERSION, type FileRecord, type FiveHourDemandStats, type PiCrumbs, type PromptFact, type ResponseFact, type ResponseSpeedStats, type TallyStore } from "./types.ts";

export function createEmptyStore(now = new Date()): TallyStore {
  return {
    version: STORE_VERSION,
    files: {},
    daily: {},
    hourly: {},
    sessions: {},
    crumbs: emptyPiCrumbs(),
    footerEnabled: true,
    toksEnabled: true,
    updatedAt: now.toISOString(),
  };
}

function emptyPiCrumbs(): PiCrumbs {
  return {
    totalChars: 0,
    dailyChars: {},
    longestPromptChars: 0,
  };
}

function charCount(text: string): number {
  return Array.from(text).length;
}

export function userMessageCharCount(message: unknown, depth = 0): number {
  if (depth > 4) return 0;
  if (typeof message === "string") return charCount(message);
  if (Array.isArray(message)) return message.reduce((sum, part) => sum + userMessageCharCount(part, depth + 1), 0);
  if (!message || typeof message !== "object") return 0;

  const m = message as { content?: unknown; text?: unknown; value?: unknown; type?: unknown };
  if (typeof m.content !== "undefined") return userMessageCharCount(m.content, depth + 1);
  if (typeof m.text === "string") return charCount(m.text);
  if ((m.type === "text" || m.type === "input_text") && typeof m.value === "string") return charCount(m.value);
  return 0;
}

function promptChars(prompt: PromptFact): number {
  return typeof prompt.chars === "number" && Number.isFinite(prompt.chars) && prompt.chars > 0 ? Math.floor(prompt.chars) : 0;
}

function computePiCrumbs(files: Record<string, FileRecord>): PiCrumbs {
  const crumbs = emptyPiCrumbs();
  for (const record of Object.values(files)) {
    for (const prompt of record.prompts) {
      const chars = promptChars(prompt);
      if (chars <= 0) continue;
      crumbs.totalChars += chars;
      crumbs.dailyChars[prompt.date] = (crumbs.dailyChars[prompt.date] ?? 0) + chars;
      crumbs.longestPromptChars = Math.max(crumbs.longestPromptChars, chars);
    }
  }
  return crumbs;
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function bucketFromTimestamp(ts: unknown, fallback = Date.now()): { timestamp: number; date: string; hour: string } {
  const candidateMs = timestampMs(ts) ?? fallback;
  const candidate = new Date(candidateMs);
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
    crumbs: emptyPiCrumbs(),
    footerEnabled: store.footerEnabled !== false,
    toksEnabled: store.toksEnabled !== false,
    updatedAt: now.toISOString(),
    ...(store.previousActiveDayAverage !== undefined ? { previousActiveDayAverage: store.previousActiveDayAverage } : {}),
  };

  for (const record of Object.values(store.files)) {
    next.sessions[record.sessionId] = (next.sessions[record.sessionId] ?? 0) + record.prompts.length;
    for (const prompt of record.prompts) {
      next.daily[prompt.date] = (next.daily[prompt.date] ?? 0) + 1;
      next.hourly[`${prompt.date} ${prompt.hour}`] = (next.hourly[`${prompt.date} ${prompt.hour}`] ?? 0) + 1;
      const chars = promptChars(prompt);
      if (chars > 0) {
        next.crumbs.totalChars += chars;
        next.crumbs.dailyChars[prompt.date] = (next.crumbs.dailyChars[prompt.date] ?? 0) + chars;
        next.crumbs.longestPromptChars = Math.max(next.crumbs.longestPromptChars, chars);
      }
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

function adjustValue(map: Record<string, number>, key: string, delta: number): void {
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
  const dailyChars = { ...store.crumbs.dailyChars };
  let totalChars = store.crumbs.totalChars;
  let longestPrompt = store.crumbs.longestPromptChars;
  let removedLongestPrompt = false;
  let addedLongestPrompt = 0;

  if (previous) {
    adjustCount(sessions, previous.sessionId, -previous.prompts.length);
    for (const prompt of previous.prompts) {
      adjustCount(daily, prompt.date, -1);
      adjustCount(hourly, `${prompt.date} ${prompt.hour}`, -1);
      const chars = promptChars(prompt);
      if (chars > 0) {
        totalChars -= chars;
        adjustValue(dailyChars, prompt.date, -chars);
        if (chars >= store.crumbs.longestPromptChars) removedLongestPrompt = true;
      }
    }
  }

  adjustCount(sessions, record.sessionId, record.prompts.length);
  for (const prompt of record.prompts) {
    adjustCount(daily, prompt.date, 1);
    adjustCount(hourly, `${prompt.date} ${prompt.hour}`, 1);
    const chars = promptChars(prompt);
    if (chars > 0) {
      totalChars += chars;
      adjustValue(dailyChars, prompt.date, chars);
      addedLongestPrompt = Math.max(addedLongestPrompt, chars);
      longestPrompt = Math.max(longestPrompt, chars);
    }
  }

  if (removedLongestPrompt && addedLongestPrompt < store.crumbs.longestPromptChars) {
    longestPrompt = computePiCrumbs(files).longestPromptChars;
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
    crumbs: {
      totalChars: Math.max(0, totalChars),
      dailyChars,
      longestPromptChars: longestPrompt,
    },
    footerEnabled: store.footerEnabled !== false,
    toksEnabled: store.toksEnabled !== false,
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
  const chars = userMessageCharCount(e.message);
  return {
    ...(typeof e.id === "string" ? { id: e.id } : {}),
    timestamp: bucket.timestamp,
    date: bucket.date,
    hour: bucket.hour,
    ...(chars > 0 ? { chars } : {}),
  };
}

function assistantOutputTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const usage = (message as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return 0;
  const output = (usage as { output?: unknown }).output;
  return typeof output === "number" && Number.isFinite(output) && output > 0 ? Math.floor(output) : 0;
}

function assistantModelLabel(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as { provider?: unknown; model?: unknown };
  const provider = typeof m.provider === "string" ? m.provider : undefined;
  const model = typeof m.model === "string" ? m.model : undefined;
  if (!model) return undefined;
  return provider ? `${provider}/${model}` : model;
}

function isAssistantMessageEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as { type?: unknown; message?: { role?: unknown } };
  return e.type === "message" && e.message?.role === "assistant";
}

function responseFactFromParts(options: { id?: unknown; endTimestamp: number; startedAt: number | undefined; message: unknown }): ResponseFact | undefined {
  const outputTokens = assistantOutputTokens(options.message);
  if (outputTokens <= 0) return undefined;
  const durationMs = typeof options.startedAt === "number" && Number.isFinite(options.startedAt) ? Math.round(options.endTimestamp - options.startedAt) : 0;
  if (durationMs <= 0) return undefined;
  const bucket = bucketFromTimestamp(options.endTimestamp);
  const model = assistantModelLabel(options.message);
  return {
    ...(typeof options.id === "string" ? { id: options.id } : {}),
    timestamp: bucket.timestamp,
    date: bucket.date,
    hour: bucket.hour,
    outputTokens,
    durationMs,
    ...(model ? { model } : {}),
  };
}

export function responseFactFromEntry(entry: unknown, fallbackEnd = Date.now()): ResponseFact | undefined {
  if (!isAssistantMessageEntry(entry)) return undefined;
  const e = entry as { id?: unknown; timestamp?: unknown; message?: { timestamp?: unknown } };
  const endTimestamp = timestampMs(e.timestamp) ?? timestampMs(e.message?.timestamp) ?? fallbackEnd;
  return responseFactFromParts({ id: e.id, endTimestamp, startedAt: timestampMs(e.message?.timestamp), message: e.message });
}

export function responseFactFromAssistantMessage(message: unknown, startedAt: number | undefined, endedAt = Date.now()): ResponseFact | undefined {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") return undefined;
  return responseFactFromParts({ endTimestamp: endedAt, startedAt, message });
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

function activeDayCountsForOffsetWindow(store: Pick<TallyStore, "daily">, startOffsetDays: number, windowDays: number, now = new Date()): number[] {
  const counts: number[] = [];
  for (let i = startOffsetDays; i < startOffsetDays + windowDays; i++) {
    const count = store.daily[nDaysAgo(i, now)] ?? 0;
    if (count >= ACTIVE_DAY_MIN_PROMPTS) counts.push(count);
  }
  return counts;
}

export function rollingAverageTrendArrow(store: TallyStore, windowDays: number, now = new Date()): "" | "↑" | "↓" {
  const current = avgCounts(activeDayCountsForOffsetWindow(store, 0, windowDays, now));
  const previous = avgCounts(activeDayCountsForOffsetWindow(store, windowDays, windowDays, now));
  if (current <= 0 || previous <= 0) return "";
  return current >= previous ? "↑" : "↓";
}

export function todayPrompts(store: TallyStore, now = new Date()): number {
  return store.daily[todayStr(now)] ?? 0;
}

export function rollingPromptCount(store: TallyStore, hours: number, now = new Date()): number {
  const end = now.getTime();
  const start = end - Math.max(0, hours) * 60 * 60 * 1000;
  let count = 0;
  for (const record of Object.values(store.files)) {
    for (const prompt of record.prompts) {
      if (Number.isFinite(prompt.timestamp) && prompt.timestamp >= start && prompt.timestamp <= end) count++;
    }
  }
  return count;
}

export function todayHourlyRate(store: TallyStore, now = new Date()): string {
  const hours = now.getHours() + now.getMinutes() / 60;
  if (hours < 0.5) return "—";
  const rate = todayPrompts(store, now) / hours;
  return rate >= 0.05 ? rate.toFixed(1) : "—";
}

function responseTps(response: ResponseFact): number | undefined {
  if (response.outputTokens <= 0 || response.durationMs <= 0) return undefined;
  return response.outputTokens / (response.durationMs / 1000);
}

export function responseSpeedStats(store: TallyStore): ResponseSpeedStats {
  let samples = 0;
  let outputTokens = 0;
  let durationMs = 0;
  let latest: ResponseFact | undefined;

  for (const record of Object.values(store.files)) {
    for (const response of record.responses ?? []) {
      const tps = responseTps(response);
      if (tps === undefined || !Number.isFinite(tps)) continue;
      samples++;
      outputTokens += response.outputTokens;
      durationMs += response.durationMs;
      if (!latest || response.timestamp > latest.timestamp) latest = response;
    }
  }

  const latestTps = latest ? responseTps(latest) : undefined;
  const average = durationMs > 0 ? outputTokens / (durationMs / 1000) : undefined;
  return {
    ...(latestTps !== undefined ? { latest: latestTps } : {}),
    ...(average !== undefined ? { average } : {}),
    samples,
  };
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

export function totalSubmittedChars(store: TallyStore): number {
  return store.crumbs.totalChars;
}

export function averagePromptChars(store: TallyStore): number {
  const prompts = totalPrompts(store);
  return prompts > 0 ? Math.round(totalSubmittedChars(store) / prompts) : 0;
}

export function longestPromptChars(store: TallyStore): number {
  return store.crumbs.longestPromptChars;
}

function dayNumber(date: string): number | undefined {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dateFromDayNumber(day: number): string {
  const date = new Date(day * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function currentStreakDays(store: Pick<TallyStore, "daily">, now = new Date()): number {
  const today = dayNumber(todayStr(now));
  if (today === undefined) return 0;

  let streak = 0;
  for (let day = today; day >= today - 3660; day--) {
    if ((store.daily[dateFromDayNumber(day)] ?? 0) <= 0) break;
    streak++;
  }
  return streak;
}

export function longestStreakDays(store: Pick<TallyStore, "daily">): number {
  const days = Object.entries(store.daily)
    .filter(([, count]) => count > 0)
    .map(([date]) => dayNumber(date))
    .filter((day): day is number => day !== undefined)
    .sort((a, b) => a - b);

  let longest = 0;
  let current = 0;
  let previous: number | undefined;
  for (const day of days) {
    current = previous !== undefined && day === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

export function lateNightPrompts(store: Pick<TallyStore, "hourly">): number {
  let count = 0;
  for (const [bucket, prompts] of Object.entries(store.hourly)) {
    const hour = Number(bucket.slice(-2));
    if (Number.isFinite(hour) && (hour >= 23 || hour < 5)) count += prompts;
  }
  return count;
}

export function busiestDay(store: Pick<TallyStore, "daily">): { date: string; prompts: number } | undefined {
  let best: { date: string; prompts: number } | undefined;
  for (const [date, prompts] of Object.entries(store.daily)) {
    if (!best || prompts > best.prompts || (prompts === best.prompts && date > best.date)) best = { date, prompts };
  }
  return best && best.prompts > 0 ? best : undefined;
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
