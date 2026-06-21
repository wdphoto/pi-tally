import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createEmptyStore, recomputeAggregates } from "./stats.ts";
import { STORE_VERSION, type FileRecord, type TallyStore } from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFileRecord(value: unknown): value is FileRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.path === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.mtimeMs === "number" &&
    typeof value.size === "number" &&
    Array.isArray(value.prompts)
  );
}

export function migrateStore(raw: unknown, now = new Date()): TallyStore {
  if (!isObject(raw) || raw.version !== STORE_VERSION) return createEmptyStore(now);

  const files: Record<string, FileRecord> = {};
  if (isObject(raw.files)) {
    for (const [path, record] of Object.entries(raw.files)) {
      if (!isFileRecord(record)) continue;
      files[path] = {
        path: record.path,
        sessionId: record.sessionId,
        mtimeMs: record.mtimeMs,
        size: record.size,
        prompts: record.prompts.flatMap((prompt) => {
          if (!isObject(prompt) || typeof prompt.timestamp !== "number" || typeof prompt.date !== "string" || typeof prompt.hour !== "string") return [];
          const chars = typeof prompt.chars === "number" && Number.isFinite(prompt.chars) && prompt.chars > 0 ? Math.floor(prompt.chars) : undefined;
          return [{
            ...(typeof prompt.id === "string" ? { id: prompt.id } : {}),
            timestamp: prompt.timestamp,
            date: prompt.date,
            hour: prompt.hour,
            ...(chars !== undefined ? { chars } : {}),
          }];
        }),
        ...(typeof record.earliestDate === "string" ? { earliestDate: record.earliestDate } : {}),
      };
    }
  }

  const migrated: TallyStore = {
    version: STORE_VERSION,
    files,
    daily: {},
    hourly: {},
    sessions: {},
    crumbs: { totalChars: 0, dailyChars: {}, longestPromptChars: 0 },
    footerEnabled: raw.footerEnabled !== false,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now.toISOString(),
    ...(typeof raw.previousActiveDayAverage === "number" ? { previousActiveDayAverage: raw.previousActiveDayAverage } : {}),
  };

  return recomputeAggregates(migrated, now);
}

export async function loadStore(path: string, now = new Date()): Promise<TallyStore> {
  try {
    const raw = await readFile(path, "utf8");
    return migrateStore(JSON.parse(raw), now);
  } catch {
    return createEmptyStore(now);
  }
}

export async function loadFooterPreference(path: string): Promise<boolean | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (isObject(raw) && raw.version === STORE_VERSION && typeof raw.footerEnabled === "boolean") return raw.footerEnabled;
  } catch {
    // Ignore missing, malformed, or partially-written files.
  }
  return undefined;
}

export async function saveStoreAtomic(path: string, store: TallyStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
