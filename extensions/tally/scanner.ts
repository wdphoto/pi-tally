import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createEmptyStore, promptFactFromEntry, recomputeAggregates, responseFactFromEntry } from "./stats.ts";
import type { FileRecord, ScanResult, TallyStore } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseSessionJsonl(content: string, filePath: string, fileStat?: { mtimeMs: number; size: number }): FileRecord | undefined {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return undefined;

  let sessionId = filePath;
  let fallbackTimestamp = Date.now();
  let earliestDate: string | undefined;
  let firstPromptLine = 0;

  try {
    const header: unknown = JSON.parse(lines[0] ?? "{}");
    if (isRecord(header) && !promptFactFromEntry(header, fallbackTimestamp)) {
      firstPromptLine = 1;
      if (typeof header.id === "string") sessionId = header.id;
      if (typeof header.timestamp === "string" || typeof header.timestamp === "number") {
        const parsed = new Date(header.timestamp);
        if (!Number.isNaN(parsed.getTime())) fallbackTimestamp = parsed.getTime();
      }
    }
  } catch {
    // Header is best-effort; malformed files should not take pi down.
  }

  const prompts = [];
  const responses = [];
  for (let i = firstPromptLine; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes('"message"')) continue;
    try {
      const entry: unknown = JSON.parse(line);
      const prompt = promptFactFromEntry(entry, fallbackTimestamp);
      if (prompt) {
        prompts.push(prompt);
        if (!earliestDate || prompt.date < earliestDate) earliestDate = prompt.date;
      }
      const response = responseFactFromEntry(entry, fallbackTimestamp);
      if (response) responses.push(response);
    } catch {
      // Ignore malformed JSONL rows.
    }
  }

  return {
    path: filePath,
    sessionId,
    mtimeMs: fileStat?.mtimeMs ?? 0,
    size: fileStat?.size ?? content.length,
    prompts,
    ...(responses.length > 0 ? { responses } : {}),
    ...(earliestDate ? { earliestDate } : {}),
  };
}

export async function scanSessionFile(filePath: string): Promise<FileRecord | undefined> {
  const [content, st] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  return parseSessionJsonl(content, filePath, { mtimeMs: st.mtimeMs, size: st.size });
}

export async function findSessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  }

  await walk(root);
  return files.sort();
}

export async function scanAllSessions(sessionsDir: string): Promise<ScanResult> {
  const files: Record<string, FileRecord> = {};
  let skipped = 0;

  for (const filePath of await findSessionFiles(sessionsDir)) {
    try {
      const record = await scanSessionFile(filePath);
      if (record) files[filePath] = record;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { files, skipped };
}

export async function rebuildStoreFromSessions(sessionsDir: string, now = new Date()): Promise<{ store: TallyStore; skipped: number }> {
  const scan = await scanAllSessions(sessionsDir);
  return {
    store: recomputeAggregates({ ...createEmptyStore(now), files: scan.files }, now),
    skipped: scan.skipped,
  };
}

export async function refreshKnownChangedFiles(store: TallyStore): Promise<TallyStore> {
  let files = store.files;
  let changed = false;

  for (const [filePath, record] of Object.entries(store.files)) {
    try {
      const st = await stat(filePath);
      if (st.mtimeMs === record.mtimeMs && st.size === record.size) continue;
      const next = await scanSessionFile(filePath);
      if (next) files = { ...files, [filePath]: next };
      else {
        const { [filePath]: _removed, ...rest } = files;
        files = rest;
      }
      changed = true;
    } catch {
      const { [filePath]: _removed, ...rest } = files;
      files = rest;
      changed = true;
    }
  }

  return changed ? recomputeAggregates({ ...store, files }) : store;
}
