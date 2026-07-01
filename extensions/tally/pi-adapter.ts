import { stat } from "node:fs/promises";
import { promptFactFromEntry, responseFactFromAssistantMessage, responseFactFromEntry, todayStr } from "./stats.ts";
import type { FileRecord, PromptFact, ResponseFact, TallyStore } from "./types.ts";

export interface SessionManagerLike {
  getSessionFile?: () => unknown;
  getSessionId?: () => unknown;
  getEntries?: () => Iterable<unknown>;
  getBranch?: () => Iterable<unknown>;
}

export interface TreePathSnapshot {
  total: number;
  today: number;
}

export function currentSessionRecord(sessionManager: SessionManagerLike): FileRecord | undefined {
  const sessionFile = sessionManager.getSessionFile?.();
  const sessionId = sessionManager.getSessionId?.();
  if (typeof sessionFile !== "string" || typeof sessionId !== "string") return undefined;

  const entries: unknown[] = Array.from(sessionManager.getEntries?.() ?? []);
  const prompts = entries.flatMap((entry) => {
    const fact = promptFactFromEntry(entry);
    return fact ? [fact] : [];
  });
  const responses = entries.flatMap((entry) => {
    const fact = responseFactFromEntry(entry);
    return fact ? [fact] : [];
  });
  const earliestDate = prompts.reduce<string | undefined>((earliest, prompt) => {
    if (!earliest || prompt.date < earliest) return prompt.date;
    return earliest;
  }, undefined);

  return {
    path: sessionFile,
    sessionId,
    mtimeMs: 0,
    size: 0,
    prompts,
    ...(responses.length > 0 ? { responses } : {}),
    ...(earliestDate ? { earliestDate } : {}),
  };
}

export async function currentSessionRecordWithStat(sessionManager: SessionManagerLike): Promise<FileRecord | undefined> {
  const record = currentSessionRecord(sessionManager);
  if (!record) return undefined;
  try {
    const st = await stat(record.path);
    return { ...record, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return record;
  }
}

export function promptFactFromUserMessage(message: unknown, fallback = Date.now()): PromptFact | undefined {
  const m = message as { id?: unknown; timestamp?: unknown } | undefined;
  return promptFactFromEntry({
    type: "message",
    ...(typeof m?.id === "string" ? { id: m.id } : {}),
    timestamp: m?.timestamp,
    message,
  }, fallback);
}

function samePromptFact(a: PromptFact, b: PromptFact): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.timestamp === b.timestamp && a.date === b.date && a.hour === b.hour && a.chars === b.chars;
}

export function promptFactsInclude(prompts: PromptFact[], fact: PromptFact): boolean {
  return prompts.some((prompt) => samePromptFact(prompt, fact));
}

function sameResponseFact(a: ResponseFact, b: ResponseFact): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.timestamp === b.timestamp || (a.outputTokens === b.outputTokens && Math.abs(a.timestamp - b.timestamp) < 60_000);
}

function responseFactsInclude(responses: ResponseFact[], fact: ResponseFact): boolean {
  return responses.some((response) => sameResponseFact(response, fact));
}

export function currentSessionRecordWithPendingUserMessage(sessionManager: SessionManagerLike, message: unknown, now = new Date()): FileRecord | undefined {
  const record = currentSessionRecord(sessionManager);
  if (!record) return undefined;

  const fact = promptFactFromUserMessage(message, now.getTime());
  if (!fact || promptFactsInclude(record.prompts, fact)) return record;

  const earliestDate = !record.earliestDate || fact.date < record.earliestDate ? fact.date : record.earliestDate;
  return {
    ...record,
    prompts: [...record.prompts, fact],
    earliestDate,
  };
}

export function currentSessionRecordWithPendingAssistantResponse(sessionManager: SessionManagerLike, message: unknown, startedAt: number | undefined, endedAt = Date.now()): FileRecord | undefined {
  const record = currentSessionRecord(sessionManager);
  if (!record) return undefined;

  const fact = responseFactFromAssistantMessage(message, startedAt, endedAt);
  if (!fact || responseFactsInclude(record.responses ?? [], fact)) return record;

  return {
    ...record,
    responses: [...(record.responses ?? []), fact],
  };
}

export function activeTreePathPromptFacts(sessionManager: SessionManagerLike): PromptFact[] {
  try {
    return Array.from(sessionManager.getBranch?.() ?? []).flatMap((entry) => {
      const fact = promptFactFromEntry(entry);
      return fact ? [fact] : [];
    });
  } catch {
    return [];
  }
}

export function activeTreePathSnapshot(sessionManager: SessionManagerLike, now = new Date()): TreePathSnapshot {
  const today = todayStr(now);
  const facts = activeTreePathPromptFacts(sessionManager);
  return {
    total: facts.length,
    today: facts.filter((fact) => fact.date === today).length,
  };
}

export function activeTreePathSnapshotWithPendingUserMessage(sessionManager: SessionManagerLike, message: unknown, now = new Date()): TreePathSnapshot {
  const today = todayStr(now);
  const branchFacts = activeTreePathPromptFacts(sessionManager);
  const pendingFact = promptFactFromUserMessage(message, now.getTime());
  const shouldCountPending = !!pendingFact && !promptFactsInclude(branchFacts, pendingFact);
  return {
    total: branchFacts.length + (shouldCountPending ? 1 : 0),
    today: branchFacts.filter((fact) => fact.date === today).length + (shouldCountPending && pendingFact?.date === today ? 1 : 0),
  };
}

export function preserveKnownFileStats(store: TallyStore, record: FileRecord): FileRecord {
  const known = store.files[record.path];
  if (!known) return record;
  return { ...record, mtimeMs: known.mtimeMs, size: known.size, ...(record.responses ? {} : { responses: known.responses }) };
}

