import {
  averagePromptChars,
  busiestDay,
  currentStreakDays,
  lateNightPrompts,
  longestPromptChars,
  longestStreakDays,
  nDaysAgo,
  todayPrompts,
  todayStr,
  totalPrompts,
  totalSubmittedChars,
} from "./stats.ts";
import type { PromptFact, TallyStore } from "./types.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function compactNumber(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

function wholeNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function messageCount(value: number): string {
  return `${compactNumber(value)} ${value === 1 ? "message" : "messages"}`;
}

function dayCount(value: number): string {
  return `${compactNumber(value)} ${value === 1 ? "day" : "days"}`;
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function milestonePercent(part: number, total: number): number {
  return total > 0 ? Math.min(99, Math.floor((part / total) * 100)) : 0;
}

function hourLabel(hour: number): string {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  const suffix = normalized < 12 ? "am" : "pm";
  const display = normalized % 12 || 12;
  return `${display}${suffix}`;
}

function dayNumberFromDateKey(date: string): number | undefined {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function weekdayFromDateKey(date: string): number | undefined {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const value = new Date(year, month - 1, day).getDay();
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : undefined;
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return monthKey;
  return `${MONTH_NAMES[month - 1] ?? "Month"} ${year}`;
}

function allPrompts(store: TallyStore): PromptFact[] {
  const prompts: PromptFact[] = [];
  for (const record of Object.values(store.files)) prompts.push(...record.prompts);
  return prompts;
}

function sortedPromptTimestamps(prompts: PromptFact[]): number[] {
  return prompts
    .map((prompt) => prompt.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((a, b) => a - b);
}

function promptChars(prompt: PromptFact): number {
  return typeof prompt.chars === "number" && Number.isFinite(prompt.chars) && prompt.chars > 0 ? Math.floor(prompt.chars) : 0;
}

function hourOfDayCounts(store: Pick<TallyStore, "hourly">): number[] {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const [bucket, count] of Object.entries(store.hourly)) {
    const hour = Number(bucket.slice(-2));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || count <= 0) continue;
    counts[hour] = (counts[hour] ?? 0) + count;
  }
  return counts;
}

function bestIndexedValue(values: number[]): { index: number; value: number } | undefined {
  let best: { index: number; value: number } | undefined;
  values.forEach((value, index) => {
    if (value <= 0) return;
    if (!best || value > best.value || (value === best.value && index > best.index)) best = { index, value };
  });
  return best;
}

function hourlyCrumbs(store: TallyStore, totalPromptCount: number): string[] {
  if (totalPromptCount <= 0) return [];

  const counts = hourOfDayCounts(store);
  const activeHours = counts.filter((count) => count > 0).length;
  const best = bestIndexedValue(counts);
  const after10pm = [22, 23, 0, 1, 2, 3, 4].reduce((sum, hour) => sum + (counts[hour] ?? 0), 0);
  const facts: string[] = [];

  if (best && totalPromptCount >= 20 && best.value >= 10) {
    const label = hourLabel(best.index);
    const late = best.index >= 22 || best.index < 5;
    facts.push(late ? `Most suspicious hour: ${label} with ${messageCount(best.value)}.` : `Peak prompt hour: ${label} with ${messageCount(best.value)}.`);
  }

  if (activeHours === 24 && totalPromptCount >= 24) {
    facts.push("You have prompted at all 24 hours. Circadian rhythm not found.");
  }

  const lateShare = percent(after10pm, totalPromptCount);
  if (totalPromptCount >= 20 && after10pm >= 5 && lateShare >= 25) {
    facts.push(`${lateShare}% of prompts happen after 10pm. Time is a suggestion.`);
  }

  return facts;
}

function calendarCrumbs(store: TallyStore, totalPromptCount: number, now: Date): string[] {
  const activeDates = Object.entries(store.daily).filter(([, count]) => count > 0);
  if (activeDates.length === 0 || totalPromptCount <= 0) return [];

  const weekdayCounts = Array.from({ length: 7 }, () => 0);
  const monthCounts: Record<string, number> = {};
  for (const [date, count] of activeDates) {
    const weekday = weekdayFromDateKey(date);
    if (weekday !== undefined) weekdayCounts[weekday] = (weekdayCounts[weekday] ?? 0) + count;
    const monthKey = date.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(monthKey)) monthCounts[monthKey] = (monthCounts[monthKey] ?? 0) + count;
  }

  const facts: string[] = [];
  const bestWeekday = bestIndexedValue(weekdayCounts);
  if (bestWeekday && activeDates.length >= 3 && totalPromptCount >= 50) {
    const share = percent(bestWeekday.value, totalPromptCount);
    if (share >= 25) facts.push(`${WEEKDAY_NAMES[bestWeekday.index] ?? "Someday"} is your Pi day: ${share}% of indexed prompts.`);
  }

  const weekendPrompts = (weekdayCounts[0] ?? 0) + (weekdayCounts[6] ?? 0);
  const weekendShare = percent(weekendPrompts, totalPromptCount);
  if (totalPromptCount >= 20 && weekendPrompts >= 10 && weekendShare >= 20) {
    facts.push(`Weekend prompts: ${compactNumber(weekendPrompts)}. Weekend status: compromised.`);
  }

  let activeLast30 = 0;
  for (let i = 0; i < 30; i++) {
    if ((store.daily[nDaysAgo(i, now)] ?? 0) > 0) activeLast30++;
  }
  if (activeLast30 >= 20) facts.push(`You were active ${activeLast30} of the last 30 days. Suspiciously consistent.`);

  const activeDayNumbers = activeDates
    .map(([date]) => dayNumberFromDateKey(date))
    .filter((day): day is number => day !== undefined)
    .sort((a, b) => a - b);
  let longestQuietSpell = 0;
  for (let i = 1; i < activeDayNumbers.length; i++) {
    const previous = activeDayNumbers[i - 1];
    const current = activeDayNumbers[i];
    if (previous === undefined || current === undefined) continue;
    longestQuietSpell = Math.max(longestQuietSpell, current - previous - 1);
  }
  if (longestQuietSpell >= 7) facts.push(`Longest quiet spell: ${dayCount(longestQuietSpell)}. Pi probably missed you.`);

  const monthEntries = Object.entries(monthCounts);
  const bestMonth = monthEntries.reduce<{ month: string; prompts: number } | undefined>((best, [month, prompts]) => {
    if (!best || prompts > best.prompts || (prompts === best.prompts && month > best.month)) return { month, prompts };
    return best;
  }, undefined);
  if (bestMonth && monthEntries.length >= 2 && bestMonth.prompts >= 50) {
    facts.push(`Busiest month: ${monthLabel(bestMonth.month)} with ${messageCount(bestMonth.prompts)}.`);
  }

  const today = todayStr(now);
  const todayCount = store.daily[today] ?? 0;
  if (todayCount > 0 && activeDates.length >= 5 && todayCount >= 10) {
    const rank = 1 + activeDates.filter(([date, count]) => date !== today && count > todayCount).length;
    if (rank <= 3) facts.push(`Today is your #${rank} busiest day ever.`);
  }

  const record = busiestDay(store);
  if (record && record.date !== today && todayCount > 0) {
    const needed = record.prompts - todayCount + 1;
    if (needed > 0 && needed <= 20) facts.push(`Today needs ${messageCount(needed)} more to become your busiest day.`);
  }

  return facts;
}

function sessionCrumbs(store: TallyStore, totalPromptCount: number): string[] {
  const sessionCounts = Object.values(store.sessions).filter((count) => count > 0);
  if (sessionCounts.length === 0 || totalPromptCount <= 0) return [];

  const facts: string[] = [];
  const biggest = Math.max(...sessionCounts);
  if (biggest >= 50) facts.push(`Largest session: ${messageCount(biggest)}. That file has seen things.`);

  if (sessionCounts.length >= 2) {
    const average = Math.round(totalPromptCount / sessionCounts.length);
    if (average >= 10) facts.push(`Average session length: ${messageCount(average)}.`);
  }

  const sessionsByDate = new Map<string, Set<string>>();
  for (const record of Object.values(store.files)) {
    const dates = new Set(record.prompts.map((prompt) => prompt.date));
    for (const date of dates) {
      const sessions = sessionsByDate.get(date) ?? new Set<string>();
      sessions.add(record.sessionId);
      sessionsByDate.set(date, sessions);
    }
  }
  const mostSessionsInOneDay = Math.max(0, ...Array.from(sessionsByDate.values(), (sessions) => sessions.size));
  if (mostSessionsInOneDay >= 3) facts.push(`Most sessions in one day: ${compactNumber(mostSessionsInOneDay)}. Tab goblin behavior.`);

  return facts;
}

function burstCrumbs(timestamps: number[]): string[] {
  if (timestamps.length < 2) return [];

  const facts: string[] = [];
  if (timestamps.length >= 10) {
    let left = 0;
    let storm = 0;
    for (let right = 0; right < timestamps.length; right++) {
      const current = timestamps[right];
      if (current === undefined) continue;
      while (left < right && current - (timestamps[left] ?? current) > HOUR_MS) left++;
      storm = Math.max(storm, right - left + 1);
    }
    if (storm >= 10) facts.push(`Prompt storm: ${messageCount(storm)} in 60 minutes.`);
  }

  let longestGapMs = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const previous = timestamps[i - 1];
    const current = timestamps[i];
    if (previous === undefined || current === undefined) continue;
    longestGapMs = Math.max(longestGapMs, current - previous);
  }
  const longestGapDays = Math.round(longestGapMs / DAY_MS);
  if (longestGapDays >= 7) facts.push(`Longest gap between prompts: ${dayCount(longestGapDays)}. Character development.`);

  return facts;
}

function characterCrumbs(store: TallyStore, prompts: PromptFact[], totalPromptCount: number, totalChars: number, now: Date): string[] {
  if (totalChars <= 0) return [];

  const facts: string[] = [];
  const charDays = Object.entries(store.crumbs.dailyChars).filter(([, chars]) => chars > 0);
  const topCharDay = charDays.reduce<{ date: string; chars: number } | undefined>((best, [date, chars]) => {
    if (!best || chars > best.chars || (chars === best.chars && date > best.date)) return { date, chars };
    return best;
  }, undefined);
  if (topCharDay && topCharDay.chars >= 10_000) facts.push(`Top character day: ${topCharDay.date} with ${compactNumber(topCharDay.chars)} chars.`);

  const longestPrompt = longestPromptChars(store);
  const averagePrompt = averagePromptChars(store);
  if (longestPrompt >= 1_000 && averagePrompt > 0) {
    const ratio = Math.round(longestPrompt / averagePrompt);
    if (ratio >= 3) facts.push(`Your longest prompt was ${compactNumber(ratio)}x your average. Ctrl+V incident?`);
  }

  const charCounts = prompts.map(promptChars).filter((chars) => chars > 0);
  const longPrompts = charCounts.filter((chars) => chars >= 2_000).length;
  if (longPrompts > 0) facts.push(`${messageCount(longPrompts)} ${longPrompts === 1 ? "was" : "were"} over 2k chars. Paste economy thriving.`);

  const tinyPrompts = charCounts.filter((chars) => chars > 0 && chars < 10).length;
  if (tinyPrompts >= 10 && percent(tinyPrompts, charCounts.length) >= 10) {
    facts.push(`${messageCount(tinyPrompts)} were under 10 chars. Tiny little bonks.`);
  }

  const today = todayStr(now);
  const todayCount = store.daily[today] ?? 0;
  const todayChars = store.crumbs.dailyChars[today] ?? 0;
  const previousPromptCount = totalPromptCount - todayCount;
  const previousChars = totalChars - todayChars;
  if (todayCount >= 3 && previousPromptCount > 0 && previousChars > 0) {
    const todayAverage = todayChars / todayCount;
    const usualAverage = previousChars / previousPromptCount;
    if (usualAverage > 0 && todayAverage >= usualAverage * 2) facts.push(`Average prompt today is ${(todayAverage / usualAverage).toFixed(1)}x your usual length. Serious mode.`);
  }

  const pages = Math.round(totalChars / 2_500);
  if (pages >= 5) facts.push(`You have sent enough characters for about ${compactNumber(pages)} paperback pages.`);

  return facts;
}

function nextMilestone(value: number, minimum: number): number {
  const multipliers = [1, 2.5, 5, 10];
  let scale = 1;
  while (scale < minimum) scale *= 10;

  while (scale < Number.MAX_SAFE_INTEGER / 10) {
    for (const multiplier of multipliers) {
      const candidate = Math.round(multiplier * scale);
      if (candidate > value && candidate >= minimum) return candidate;
    }
    scale *= 10;
  }

  return value + minimum;
}

function milestoneCrumbs(totalPromptCount: number, totalChars: number): string[] {
  const facts: string[] = [];

  if (totalPromptCount >= 50) {
    const next = nextMilestone(totalPromptCount, 100);
    const remaining = next - totalPromptCount;
    if (remaining > 0 && remaining <= Math.max(10, Math.ceil(next * 0.1))) facts.push(`Only ${messageCount(remaining)} until ${compactNumber(next)} total.`);
  }

  if (totalChars >= 5_000) {
    const next = nextMilestone(totalChars, 10_000);
    const remaining = next - totalChars;
    if (remaining > 0 && remaining <= Math.max(1_000, Math.ceil(next * 0.1))) {
      facts.push(`Next character milestone: ${wholeNumber(next)}. You are ${milestonePercent(totalChars, next)}% there.`);
    }
  }

  return facts;
}

export function piCrumbsFacts(store: TallyStore, now = new Date(), activeModel?: string): string[] {
  const totalPromptCount = totalPrompts(store);
  const totalChars = totalSubmittedChars(store);
  const currentStreak = currentStreakDays(store, now);
  const longestStreak = longestStreakDays(store);
  const latePrompts = lateNightPrompts(store);
  const longestPrompt = longestPromptChars(store);
  const busiest = busiestDay(store);
  const prompts = allPrompts(store);
  const timestamps = sortedPromptTimestamps(prompts);
  const facts = [
    ...(totalChars > 0 ? [`${wholeNumber(totalChars)} characters sent to Pi.`] : []),
    ...(activeModel ? [`favorite model ${activeModel}`] : []),
    ...(totalChars > 0 ? [`avg prompt length ${compactNumber(averagePromptChars(store))} chars`] : []),
    ...(longestPrompt > 0 ? [`longest prompt ${compactNumber(longestPrompt)} chars`] : []),
    ...(currentStreak >= 10 ? [`You are on a ${compactNumber(currentStreak)} day streak. Seek therapy.`] : []),
    ...(longestStreak >= 10 && longestStreak !== currentStreak ? [`You had a ${compactNumber(longestStreak)} day streak. Please don't do that again.`] : []),
    ...(latePrompts > 0 ? [`${compactNumber(latePrompts)} late-night prompts indexed`] : []),
    ...(busiest ? [`busiest day ${busiest.date} with ${compactNumber(busiest.prompts)} prompts`] : []),
    ...hourlyCrumbs(store, totalPromptCount),
    ...calendarCrumbs(store, totalPromptCount, now),
    ...sessionCrumbs(store, totalPromptCount),
    ...burstCrumbs(timestamps),
    ...characterCrumbs(store, prompts, totalPromptCount, totalChars, now),
    ...milestoneCrumbs(totalPromptCount, totalChars),
  ];

  return facts.length > 0 ? facts : ["counting prompt characters from now on"];
}

export function piCrumbsFact(store: TallyStore, now = new Date(), activeModel?: string, rotationIndex?: number): string {
  if (rotationIndex === undefined) {
    const hour = now.getHours();
    const latePrompts = lateNightPrompts(store);
    if ((hour >= 23 || hour < 5) && todayPrompts(store, now) > 0) {
      return latePrompts > 0 ? `${compactNumber(latePrompts)} late-night prompts indexed. Go to bed?` : "working late. Go to bed?";
    }

    const currentStreak = currentStreakDays(store, now);
    if (currentStreak >= 10) return `You are on a ${compactNumber(currentStreak)} day streak. Seek therapy.`;
  }

  const facts = piCrumbsFacts(store, now, activeModel);
  const factIndex = rotationIndex === undefined ? Number(todayStr(now).replace(/-/g, "")) : rotationIndex;
  const normalizedIndex = ((factIndex % facts.length) + facts.length) % facts.length;
  return facts[normalizedIndex] ?? facts[0] ?? "counting prompt characters from now on";
}
