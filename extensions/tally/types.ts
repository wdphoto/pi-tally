export const STORE_VERSION = 1;

export interface PromptFact {
  id?: string;
  timestamp: number;
  date: string;
  hour: string;
  chars?: number;
}

export interface ResponseFact {
  id?: string;
  timestamp: number;
  date: string;
  hour: string;
  outputTokens: number;
  durationMs: number;
  model?: string;
}

export interface FileRecord {
  path: string;
  sessionId: string;
  mtimeMs: number;
  size: number;
  prompts: PromptFact[];
  responses?: ResponseFact[];
  earliestDate?: string;
}

export interface PiCrumbs {
  totalChars: number;
  dailyChars: Record<string, number>;
  longestPromptChars: number;
}

export interface TallyStore {
  version: typeof STORE_VERSION;
  files: Record<string, FileRecord>;
  daily: Record<string, number>;
  hourly: Record<string, number>;
  sessions: Record<string, number>;
  crumbs: PiCrumbs;
  earliestDate?: string;
  previousActiveDayAverage?: number;
  footerEnabled: boolean;
  toksEnabled: boolean;
  updatedAt: string;
}

export interface TallyPaths {
  agentDir: string;
  sessionsDir: string;
  storeFile: string;
}

export interface ScanResult {
  files: Record<string, FileRecord>;
  skipped: number;
}

export interface FiveHourDemandStats {
  average: number;
  high: number;
  peak: number;
  activeDays: number;
  lookbackDays: number;
}

export interface ResponseSpeedStats {
  latest?: number;
  average?: number;
  samples: number;
}

export interface DetailSnapshot {
  activeModel?: string;
  activeTreePathPrompts: number;
  todayPrompts: number;
  hourlyRate: string;
  responseSpeed: ResponseSpeedStats;
  fiveHourDemand: FiveHourDemandStats;
  activeDayAverage: number;
  last24HourPrompts: number;
  weeklyAverage: number;
  weeklyTrend: "" | "↑" | "↓";
  monthlyAverage: number;
  monthlyTrend: "" | "↑" | "↓";
  recordDay?: { date: string; prompts: number };
  currentStreakDays: number;
  longestStreakDays: number;
  allTimePrompts: number;
  totalSessions: number;
  activeDays: number;
  calendarDays: number;
  piCrumbsFact: string;
  earliestDate?: string;
}
