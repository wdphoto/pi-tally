import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stat } from "node:fs/promises";
import { COMMAND_NAME, STATUS_KEY, resolveTallyPaths } from "./config.ts";
import { refreshKnownChangedFiles, rebuildStoreFromSessions } from "./scanner.ts";
import { loadStore, loadTallyPreferences, saveStoreAtomic } from "./storage.ts";
import { activeDayAverage, promptFactFromEntry, replaceFileRecordIncremental, responseFactFromAssistantMessage, responseFactFromEntry, todayStr, trendArrowForStore } from "./stats.ts";
import type { FileRecord, PromptFact, ResponseFact, TallyPaths, TallyStore } from "./types.ts";
import { allDetailLines, detailLines, footerStatusText, modelChoiceLabel, statusLines, truncatePlainLine, type FooterSpeedometer } from "./ui.ts";

function currentSessionRecord(sessionManager: any): FileRecord | undefined {
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

function promptFactFromUserMessage(message: unknown, fallback = Date.now()): PromptFact | undefined {
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

function promptFactsInclude(prompts: PromptFact[], fact: PromptFact): boolean {
  return prompts.some((prompt) => samePromptFact(prompt, fact));
}

function sameResponseFact(a: ResponseFact, b: ResponseFact): boolean {
  if (a.id && b.id) return a.id === b.id;
  return a.timestamp === b.timestamp || (a.outputTokens === b.outputTokens && Math.abs(a.timestamp - b.timestamp) < 60_000);
}

function responseFactsInclude(responses: ResponseFact[], fact: ResponseFact): boolean {
  return responses.some((response) => sameResponseFact(response, fact));
}

function assistantOutputTokens(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const output = ((message as { usage?: { output?: unknown } }).usage)?.output;
  return typeof output === "number" && Number.isFinite(output) && output > 0 ? Math.floor(output) : 0;
}

function assistantDeltaChars(assistantMessageEvent: unknown): number {
  if (!assistantMessageEvent || typeof assistantMessageEvent !== "object") return 0;
  const event = assistantMessageEvent as { delta?: unknown };
  return typeof event.delta === "string" ? Array.from(event.delta).length : 0;
}

function estimatedTokensFromChars(chars: number): number {
  return chars > 0 ? chars / 4 : 0;
}

function currentSessionRecordWithPendingUserMessage(sessionManager: any, message: unknown, now = new Date()): FileRecord | undefined {
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

function currentSessionRecordWithPendingAssistantResponse(sessionManager: any, message: unknown, startedAt: number | undefined, endedAt = Date.now()): FileRecord | undefined {
  const record = currentSessionRecord(sessionManager);
  if (!record) return undefined;

  const fact = responseFactFromAssistantMessage(message, startedAt, endedAt);
  if (!fact || responseFactsInclude(record.responses ?? [], fact)) return record;

  return {
    ...record,
    responses: [...(record.responses ?? []), fact],
  };
}

async function currentSessionRecordWithStat(sessionManager: any): Promise<FileRecord | undefined> {
  const record = currentSessionRecord(sessionManager);
  if (!record) return undefined;
  try {
    const st = await stat(record.path);
    return { ...record, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return record;
  }
}

function activeTreePathPromptFacts(sessionManager: any): PromptFact[] {
  try {
    return Array.from(sessionManager.getBranch?.() ?? []).flatMap((entry) => {
      const fact = promptFactFromEntry(entry);
      return fact ? [fact] : [];
    });
  } catch {
    return [];
  }
}

function activeTreePathPromptCount(sessionManager: any): number {
  return activeTreePathPromptFacts(sessionManager).length;
}

function activeTreePathPromptCountForDate(sessionManager: any, date: string): number {
  return activeTreePathPromptFacts(sessionManager).filter((fact) => fact.date === date).length;
}

function preserveKnownFileStats(store: TallyStore, record: FileRecord): FileRecord {
  const known = store.files[record.path];
  if (!known) return record;
  return { ...record, mtimeMs: known.mtimeMs, size: known.size, ...(record.responses ? {} : { responses: known.responses }) };
}

function reconcilePendingUserMessage(store: TallyStore, sessionManager: any, message: unknown, now = new Date()): TallyStore {
  const record = currentSessionRecordWithPendingUserMessage(sessionManager, message, now);
  if (!record) return store;
  return replaceFileRecordIncremental(store, preserveKnownFileStats(store, record), now);
}

function reconcilePendingAssistantResponse(store: TallyStore, sessionManager: any, message: unknown, startedAt: number | undefined, endedAt = Date.now()): TallyStore {
  const record = currentSessionRecordWithPendingAssistantResponse(sessionManager, message, startedAt, endedAt);
  if (!record) return store;
  return replaceFileRecordIncremental(store, preserveKnownFileStats(store, record), new Date(endedAt));
}

async function reconcileCurrentSession(store: TallyStore, sessionManager: any): Promise<TallyStore> {
  const record = await currentSessionRecordWithStat(sessionManager);
  if (!record) return store;
  return replaceFileRecordIncremental(store, preserveKnownFileStats(store, record));
}

const storeSaveQueues = new Map<string, Promise<void>>();

function enqueueStoreSave(path: string, task: () => Promise<void>): Promise<void> {
  const previous = storeSaveQueues.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.catch(() => undefined);
  storeSaveQueues.set(path, settled);
  void settled.then(() => {
    if (storeSaveQueues.get(path) === settled) storeSaveQueues.delete(path);
  });
  return run;
}

async function showLines(ctx: any, lines: string[]): Promise<void> {
  if (ctx.mode === "tui") {
    await ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value?: unknown) => void) => {
      return {
        render(width: number): string[] {
          return lines.map((line) => {
            const plain = truncatePlainLine(line, Math.min(width, 88));
            if (line.startsWith("Since:") || line.startsWith("Crumb")) return theme.fg("accent", plain);
            if (line.startsWith("Local") || line.includes("only counts")) return theme.fg("dim", plain);
            return plain;
          });
        },
        invalidate() {},
        handleInput() {
          done(undefined);
        },
      };
    });
    return;
  }

  if (ctx.hasUI) {
    ctx.ui.notify(lines.filter(Boolean).join("\n"), "info");
  }
}

export default function piTally(pi: ExtensionAPI) {
  const paths: TallyPaths = resolveTallyPaths();
  let store: TallyStore | undefined;
  let activeTreePath = 0;
  let activeTreePathToday = 0;
  let arrow = "";
  let piCrumbsRotationIndex = 0;
  let latestAssistantStartMs: number | undefined;
  let footerSpeedometer: FooterSpeedometer | undefined;
  let liveResponseMeter: { startedAt: number; estimatedTokens: number; lastStatusUpdateMs: number } | undefined;
  const assistantStartByMessageTimestamp = new Map<number, number>();

  type SaveOptions = { writeFooterPreference?: boolean; writeToksPreference?: boolean };

  async function snapshotWithCurrentPreferences(snapshot: TallyStore, options: SaveOptions = {}): Promise<TallyStore> {
    const preferences = await loadTallyPreferences(paths.storeFile);
    const footerEnabled = options.writeFooterPreference ? snapshot.footerEnabled : preferences.footerEnabled;
    const toksEnabled = options.writeToksPreference ? snapshot.toksEnabled : preferences.toksEnabled;
    if ((footerEnabled === undefined || footerEnabled === snapshot.footerEnabled) && (toksEnabled === undefined || toksEnabled === snapshot.toksEnabled)) return snapshot;
    return {
      ...snapshot,
      ...(footerEnabled !== undefined ? { footerEnabled } : {}),
      ...(toksEnabled !== undefined ? { toksEnabled } : {}),
    };
  }

  async function syncPreferences(): Promise<void> {
    if (!store) return;
    const preferences = await loadTallyPreferences(paths.storeFile);
    if ((preferences.footerEnabled !== undefined && preferences.footerEnabled !== store.footerEnabled) || (preferences.toksEnabled !== undefined && preferences.toksEnabled !== store.toksEnabled)) {
      store = {
        ...store,
        ...(preferences.footerEnabled !== undefined ? { footerEnabled: preferences.footerEnabled } : {}),
        ...(preferences.toksEnabled !== undefined ? { toksEnabled: preferences.toksEnabled } : {}),
      };
    }
  }

  function queueSave(snapshot: TallyStore, options: SaveOptions = {}): void {
    void enqueueStoreSave(paths.storeFile, async () => {
      await saveStoreAtomic(paths.storeFile, await snapshotWithCurrentPreferences(snapshot, options));
    }).catch(() => undefined);
  }

  async function saveNow(snapshot: TallyStore, options: SaveOptions = {}): Promise<void> {
    await enqueueStoreSave(paths.storeFile, async () => {
      await saveStoreAtomic(paths.storeFile, await snapshotWithCurrentPreferences(snapshot, options));
    });
  }

  async function loadAndRefresh(ctx: any): Promise<void> {
    store = await loadStore(paths.storeFile);
    store = await refreshKnownChangedFiles(store);
    store = await reconcileCurrentSession(store, ctx.sessionManager);
    activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
    activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
    arrow = trendArrowForStore(store);
    setStatus(ctx);
    queueSave(store);
  }

  function setStatus(ctx: any): void {
    if (!ctx.hasUI || !store) return;
    if (store.footerEnabled === false) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, footerStatusText(activeTreePathToday, store, arrow, store.toksEnabled === false ? undefined : (footerSpeedometer ?? { tps: 0 }), ctx.ui.theme));
  }

  function nextPiCrumbsRotationIndex(): number {
    const current = piCrumbsRotationIndex;
    piCrumbsRotationIndex = (piCrumbsRotationIndex + 1) % Number.MAX_SAFE_INTEGER;
    return current;
  }

  function assistantMessageTimestamp(message: unknown): number | undefined {
    const value = (message as { timestamp?: unknown } | undefined)?.timestamp;
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function rememberAssistantStart(message: unknown, startedAt = Date.now()): void {
    latestAssistantStartMs = startedAt;
    const messageTimestamp = assistantMessageTimestamp(message);
    if (messageTimestamp !== undefined) assistantStartByMessageTimestamp.set(messageTimestamp, startedAt);
  }

  function takeAssistantStart(message: unknown): number | undefined {
    const messageTimestamp = assistantMessageTimestamp(message);
    if (messageTimestamp !== undefined) {
      const startedAt = assistantStartByMessageTimestamp.get(messageTimestamp);
      assistantStartByMessageTimestamp.delete(messageTimestamp);
      if (startedAt !== undefined) return startedAt;
    }
    return latestAssistantStartMs ?? messageTimestamp;
  }

  pi.registerCommand(COMMAND_NAME, {
    description: "Show local Pi prompt counters",
    handler: async (args, ctx) => {
      const command = args.trim().replace(/\s+/g, " ");
      store ??= await loadStore(paths.storeFile);
      await syncPreferences();

      let detailPiCrumbsRotationIndex: number | undefined;

      if (command === "footer" || command === "footer on" || command === "footer off") {
        const enabled = command === "footer" ? store.footerEnabled === false : command === "footer on";
        store = { ...store, footerEnabled: enabled, updatedAt: new Date().toISOString() };
        activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
        activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
        await saveNow(store, { writeFooterPreference: true });
        setStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: footer ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }

      if (command === "toks" || command === "toks on" || command === "toks off") {
        const enabled = command === "toks" ? store.toksEnabled === false : command === "toks on";
        store = { ...store, toksEnabled: enabled, updatedAt: new Date().toISOString() };
        activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
        activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
        await saveNow(store, { writeToksPreference: true });
        setStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: toks meter ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }

      if (command === "run" || command === "rebuild" || command === "--rebuild") {
        if (ctx.hasUI) ctx.ui.notify("pi-tally: counting local session files...", "info");
        const previousActiveDayAverage = store.previousActiveDayAverage ?? activeDayAverage(store);
        const result = await rebuildStoreFromSessions(paths.sessionsDir);
        store = await reconcileCurrentSession({ ...result.store, previousActiveDayAverage, footerEnabled: store.footerEnabled !== false, toksEnabled: store.toksEnabled !== false }, ctx.sessionManager);
        activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
        activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
        arrow = trendArrowForStore(store);
        await saveNow(store);
        setStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: count complete (${result.skipped} skipped)`, "info");
      } else if (command === "status") {
        store = await reconcileCurrentSession(store, ctx.sessionManager);
        activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
        activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
        await saveNow(store);
        await showLines(ctx, statusLines(paths, store));
        setStatus(ctx);
        return;
      } else if (command === "all") {
        store = await reconcileCurrentSession(store, ctx.sessionManager);
        activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
        activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
        arrow = trendArrowForStore(store);
        await saveNow(store);
        setStatus(ctx);
        await showLines(ctx, allDetailLines(store, activeTreePath, new Date(), modelChoiceLabel(ctx.model)));
        return;
      } else if (command.length > 0) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /tally, /tally all, /tally run, /tally status, /tally footer [on|off], /tally toks [on|off]", "warning");
        return;
      } else {
        detailPiCrumbsRotationIndex = nextPiCrumbsRotationIndex();
        store = await reconcileCurrentSession(store, ctx.sessionManager);
        activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
        activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
        arrow = trendArrowForStore(store);
        await saveNow(store);
        setStatus(ctx);
      }

      await showLines(ctx, detailLines(store, activeTreePath, new Date(), modelChoiceLabel(ctx.model), detailPiCrumbsRotationIndex));
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await loadAndRefresh(ctx);
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message?.role !== "assistant") return;
    const startedAt = Date.now();
    rememberAssistantStart(event.message, startedAt);
    footerSpeedometer = undefined;
    liveResponseMeter = { startedAt, estimatedTokens: 0, lastStatusUpdateMs: 0 };
    setStatus(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    if (event.message?.role !== "assistant") return;
    const chars = assistantDeltaChars(event.assistantMessageEvent);
    if (chars <= 0) return;

    const now = Date.now();
    liveResponseMeter ??= { startedAt: latestAssistantStartMs ?? now, estimatedTokens: 0, lastStatusUpdateMs: 0 };
    liveResponseMeter.estimatedTokens += estimatedTokensFromChars(chars);
    if (now - liveResponseMeter.lastStatusUpdateMs < 250) return;

    const elapsedSeconds = Math.max((now - liveResponseMeter.startedAt) / 1000, 1);
    const tps = liveResponseMeter.estimatedTokens / elapsedSeconds;
    if (tps > 0) {
      footerSpeedometer = { tps, live: true };
      liveResponseMeter.lastStatusUpdateMs = now;
      setStatus(ctx);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message?.role === "user") {
      store ??= await loadStore(paths.storeFile);
      await syncPreferences();
      const now = new Date();
      const today = todayStr(now);
      const branchFacts = activeTreePathPromptFacts(ctx.sessionManager);
      const pendingFact = promptFactFromUserMessage(event.message, now.getTime());
      const shouldCountPending = !!pendingFact && !promptFactsInclude(branchFacts, pendingFact);
      activeTreePath = branchFacts.length + (shouldCountPending ? 1 : 0);
      activeTreePathToday = branchFacts.filter((fact) => fact.date === today).length + (shouldCountPending && pendingFact?.date === today ? 1 : 0);
      store = reconcilePendingUserMessage(store, ctx.sessionManager, event.message, now);
      arrow = trendArrowForStore(store, now);
      setStatus(ctx);
      queueSave(store);
      return;
    }

    if (event.message?.role === "assistant") {
      store ??= await loadStore(paths.storeFile);
      await syncPreferences();
      const endedAt = Date.now();
      const startedAt = takeAssistantStart(event.message);
      const outputTokens = assistantOutputTokens(event.message);
      if (outputTokens > 0 && typeof startedAt === "number" && endedAt > startedAt) {
        footerSpeedometer = { tps: outputTokens / ((endedAt - startedAt) / 1000) };
      } else if (liveResponseMeter && liveResponseMeter.estimatedTokens > 0) {
        const elapsedSeconds = Math.max((endedAt - liveResponseMeter.startedAt) / 1000, 1);
        footerSpeedometer = { tps: liveResponseMeter.estimatedTokens / elapsedSeconds };
      }
      liveResponseMeter = undefined;
      store = reconcilePendingAssistantResponse(store, ctx.sessionManager, event.message, startedAt, endedAt);
      setStatus(ctx);
      queueSave(store);
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    store ??= await loadStore(paths.storeFile);
    await syncPreferences();
    activeTreePath = activeTreePathPromptCount(ctx.sessionManager);
    activeTreePathToday = activeTreePathPromptCountForDate(ctx.sessionManager, todayStr());
    setStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    store ??= await loadStore(paths.storeFile);
    await syncPreferences();
    store = await reconcileCurrentSession(store, ctx.sessionManager);
    store = { ...store, previousActiveDayAverage: activeDayAverage(store) };
    await saveNow(store);
  });
}
