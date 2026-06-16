import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stat } from "node:fs/promises";
import { COMMAND_NAME, STATUS_KEY, resolveTallyPaths } from "./config.ts";
import { refreshKnownChangedFiles, rebuildStoreFromSessions } from "./scanner.ts";
import { loadStore, saveStoreAtomic } from "./storage.ts";
import { activeDayAverage, countUserMessages, promptFactFromEntry, recomputeAggregates, trendArrow } from "./stats.ts";
import type { FileRecord, TallyPaths, TallyStore } from "./types.ts";
import { detailLines, footerText, statusLines, truncatePlainLine } from "./ui.ts";

function currentSessionRecord(sessionManager: any): FileRecord | undefined {
  const sessionFile = sessionManager.getSessionFile?.();
  const sessionId = sessionManager.getSessionId?.();
  if (typeof sessionFile !== "string" || typeof sessionId !== "string") return undefined;

  const entries: unknown[] = Array.from(sessionManager.getEntries?.() ?? []);
  const prompts = entries.flatMap((entry) => {
    const fact = promptFactFromEntry(entry);
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
    ...(earliestDate ? { earliestDate } : {}),
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

function activeBranchPromptCount(sessionManager: any): number {
  try {
    return countUserMessages(sessionManager.getBranch?.() ?? []);
  } catch {
    return 0;
  }
}

async function reconcileCurrentSession(store: TallyStore, sessionManager: any): Promise<TallyStore> {
  const record = await currentSessionRecordWithStat(sessionManager);
  if (!record) return store;
  return recomputeAggregates({ ...store, files: { ...store.files, [record.path]: record } });
}

async function showLines(ctx: any, lines: string[]): Promise<void> {
  if (ctx.mode === "tui") {
    await ctx.ui.custom((_tui: unknown, theme: any, _kb: unknown, done: (value?: unknown) => void) => {
      return {
        render(width: number): string[] {
          return lines.map((line, i) => {
            const plain = truncatePlainLine(line, Math.min(width, 88));
            if (i < 2) return theme.fg("accent", plain);
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
  let activeBranch = 0;
  let arrow = "";

  async function loadAndRefresh(ctx: any): Promise<void> {
    store = await loadStore(paths.storeFile);
    store = await refreshKnownChangedFiles(store);
    store = await reconcileCurrentSession(store, ctx.sessionManager);
    activeBranch = activeBranchPromptCount(ctx.sessionManager);
    arrow = trendArrow(store.previousActiveDayAverage, activeDayAverage(store));
    await saveStoreAtomic(paths.storeFile, store);
    setStatus(ctx);
  }

  function setStatus(ctx: any): void {
    if (!ctx.hasUI || !store) return;
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", footerText(activeBranch, store, arrow)));
  }

  pi.registerCommand(COMMAND_NAME, {
    description: "Show local Pi prompt counters",
    handler: async (args, ctx) => {
      const command = args.trim();
      store ??= await loadStore(paths.storeFile);

      if (command === "run" || command === "rebuild" || command === "--rebuild") {
        if (ctx.hasUI) ctx.ui.notify("pi-tally: counting local session files...", "info");
        const result = await rebuildStoreFromSessions(paths.sessionsDir);
        store = await reconcileCurrentSession(result.store, ctx.sessionManager);
        activeBranch = activeBranchPromptCount(ctx.sessionManager);
        arrow = trendArrow(store.previousActiveDayAverage, activeDayAverage(store));
        await saveStoreAtomic(paths.storeFile, store);
        setStatus(ctx);
        if (ctx.hasUI) ctx.ui.notify(`pi-tally: count complete (${result.skipped} skipped)`, "info");
      } else if (command === "status") {
        store = await reconcileCurrentSession(store, ctx.sessionManager);
        await saveStoreAtomic(paths.storeFile, store);
        await showLines(ctx, statusLines(paths, store));
        setStatus(ctx);
        return;
      } else if (command.length > 0) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /tally, /tally run, /tally status", "warning");
      } else {
        store = await reconcileCurrentSession(store, ctx.sessionManager);
        await saveStoreAtomic(paths.storeFile, store);
      }

      await showLines(ctx, detailLines(store, activeBranch));
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await loadAndRefresh(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message?.role !== "user") return;
    store ??= await loadStore(paths.storeFile);
    activeBranch = activeBranchPromptCount(ctx.sessionManager);
    store = await reconcileCurrentSession(store, ctx.sessionManager);
    arrow = trendArrow(store.previousActiveDayAverage, activeDayAverage(store));
    await saveStoreAtomic(paths.storeFile, store);
    setStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    store ??= await loadStore(paths.storeFile);
    activeBranch = activeBranchPromptCount(ctx.sessionManager);
    setStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    store ??= await loadStore(paths.storeFile);
    store = await reconcileCurrentSession(store, ctx.sessionManager);
    store = { ...store, previousActiveDayAverage: activeDayAverage(store) };
    await saveStoreAtomic(paths.storeFile, store);
  });
}
