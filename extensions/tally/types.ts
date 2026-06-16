export const STORE_VERSION = 1;

export interface PromptFact {
  id?: string;
  timestamp: number;
  date: string;
  hour: string;
}

export interface FileRecord {
  path: string;
  sessionId: string;
  mtimeMs: number;
  size: number;
  prompts: PromptFact[];
  earliestDate?: string;
}

export interface TallyStore {
  version: typeof STORE_VERSION;
  files: Record<string, FileRecord>;
  daily: Record<string, number>;
  hourly: Record<string, number>;
  sessions: Record<string, number>;
  earliestDate?: string;
  previousActiveDayAverage?: number;
  footerEnabled: boolean;
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

export interface DetailSnapshot {
  activeBranchPrompts: number;
  todayPrompts: number;
  hourlyRate: string;
  fiveHourDemand: FiveHourDemandStats;
  activeDayAverage: number;
  weeklyAverage: number;
  monthlyAverage: number;
  allTimePrompts: number;
  totalSessions: number;
  activeDays: number;
  calendarDays: number;
  earliestDate?: string;
}
