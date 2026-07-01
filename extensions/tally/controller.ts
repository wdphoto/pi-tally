import { resolveTallyPaths } from "./config.ts";
import {
  activeTreePathSnapshot,
  activeTreePathSnapshotWithPendingUserMessage,
  currentSessionRecordWithPendingAssistantResponse,
  currentSessionRecordWithPendingUserMessage,
  currentSessionRecordWithStat,
  preserveKnownFileStats,
  type SessionManagerLike,
} from "./pi-adapter.ts";
import { refreshKnownChangedFiles, rebuildStoreFromSessions } from "./scanner.ts";
import { enqueueStoreSave } from "./save-queue.ts";
import { AssistantSpeedTracker } from "./speedometer.ts";
import { loadStore, loadTallyPreferences, saveStoreAtomic } from "./storage.ts";
import { activeDayAverage, replaceFileRecordIncremental, todayStr, trendArrowForStore } from "./stats.ts";
import type { TallyPaths, TallyStore } from "./types.ts";
import { footerStatusText, type FooterSpeedometer } from "./ui.ts";

type SaveOptions = { writeFooterPreference?: boolean; writeToksPreference?: boolean };
type ThemeLike = { fg?: (color: string, value: string) => string };

export interface BackfillResult {
  store: TallyStore;
  skipped: number;
}

export interface TallyDetailState {
  store: TallyStore;
  activeTreePath: number;
  piCrumbsRotationIndex?: number;
}

export class TallyController {
  readonly paths: TallyPaths;
  private store: TallyStore | undefined;
  private activeTreePath = 0;
  private activeTreePathToday = 0;
  private arrow = "";
  private piCrumbsRotationIndex = 0;
  private footerSpeedometer: FooterSpeedometer | undefined;
  private readonly speedTracker = new AssistantSpeedTracker();

  constructor(paths: TallyPaths = resolveTallyPaths()) {
    this.paths = paths;
  }

  footerStatus(theme?: ThemeLike, now = new Date()): string | undefined {
    if (!this.store || this.store.footerEnabled === false) return undefined;
    return footerStatusText(
      this.activeTreePathToday,
      this.store,
      this.arrow,
      this.store.toksEnabled === false ? undefined : (this.footerSpeedometer ?? { tps: 0 }),
      theme,
      now,
    );
  }

  async isFooterEnabled(): Promise<boolean> {
    const store = await this.ensureSyncedStore();
    return store.footerEnabled !== false;
  }

  async isToksEnabled(): Promise<boolean> {
    const store = await this.ensureSyncedStore();
    return store.toksEnabled !== false;
  }

  async sessionStart(sessionManager: SessionManagerLike): Promise<TallyStore> {
    this.store = await loadStore(this.paths.storeFile);
    this.store = await refreshKnownChangedFiles(this.store);
    this.store = await this.reconcileCurrentSession(this.store, sessionManager);
    this.updateActiveTreePath(sessionManager);
    this.arrow = trendArrowForStore(this.store);
    this.queueSave(this.store);
    return this.store;
  }

  async setFooterEnabled(sessionManager: SessionManagerLike, enabled: boolean): Promise<TallyStore> {
    const store = await this.ensureSyncedStore();
    this.store = { ...store, footerEnabled: enabled, updatedAt: new Date().toISOString() };
    this.updateActiveTreePath(sessionManager);
    await this.saveNow(this.store, { writeFooterPreference: true });
    return this.store;
  }

  async setToksEnabled(sessionManager: SessionManagerLike, enabled: boolean): Promise<TallyStore> {
    const store = await this.ensureSyncedStore();
    this.store = { ...store, toksEnabled: enabled, updatedAt: new Date().toISOString() };
    this.updateActiveTreePath(sessionManager);
    await this.saveNow(this.store, { writeToksPreference: true });
    return this.store;
  }

  async runBackfill(sessionManager: SessionManagerLike): Promise<BackfillResult> {
    const store = await this.ensureSyncedStore();
    const previousActiveDayAverage = store.previousActiveDayAverage ?? activeDayAverage(store);
    const result = await rebuildStoreFromSessions(this.paths.sessionsDir);
    this.store = await this.reconcileCurrentSession({
      ...result.store,
      previousActiveDayAverage,
      footerEnabled: store.footerEnabled !== false,
      toksEnabled: store.toksEnabled !== false,
    }, sessionManager);
    this.updateActiveTreePath(sessionManager);
    this.arrow = trendArrowForStore(this.store);
    await this.saveNow(this.store);
    return { store: this.store, skipped: result.skipped };
  }

  async status(sessionManager: SessionManagerLike): Promise<TallyStore> {
    const store = await this.ensureSyncedStore();
    this.store = await this.reconcileCurrentSession(store, sessionManager);
    this.updateActiveTreePath(sessionManager);
    await this.saveNow(this.store);
    return this.store;
  }

  async detail(sessionManager: SessionManagerLike, rotateCrumb: boolean): Promise<TallyDetailState> {
    const store = await this.ensureSyncedStore();
    const piCrumbsRotationIndex = rotateCrumb ? this.nextPiCrumbsRotationIndex() : undefined;
    this.store = await this.reconcileCurrentSession(store, sessionManager);
    this.updateActiveTreePath(sessionManager);
    this.arrow = trendArrowForStore(this.store);
    await this.saveNow(this.store);
    return {
      store: this.store,
      activeTreePath: this.activeTreePath,
      ...(piCrumbsRotationIndex !== undefined ? { piCrumbsRotationIndex } : {}),
    };
  }

  async userMessageEnd(sessionManager: SessionManagerLike, message: unknown, now = new Date()): Promise<void> {
    const store = await this.ensureSyncedStore();
    const snapshot = activeTreePathSnapshotWithPendingUserMessage(sessionManager, message, now);
    this.activeTreePath = snapshot.total;
    this.activeTreePathToday = snapshot.today;
    this.store = this.reconcilePendingUserMessage(store, sessionManager, message, now);
    this.arrow = trendArrowForStore(this.store, now);
    this.queueSave(this.store);
  }

  assistantMessageStart(message: unknown): void {
    this.speedTracker.start(message);
    this.footerSpeedometer = undefined;
  }

  assistantMessageUpdate(assistantMessageEvent: unknown): boolean {
    const speedometer = this.speedTracker.update(assistantMessageEvent);
    if (!speedometer) return false;
    this.footerSpeedometer = speedometer;
    return true;
  }

  async assistantMessageEnd(sessionManager: SessionManagerLike, message: unknown, endedAt = Date.now()): Promise<void> {
    const store = await this.ensureSyncedStore();
    const result = this.speedTracker.end(message, endedAt);
    if (result.speedometer) this.footerSpeedometer = result.speedometer;
    this.store = this.reconcilePendingAssistantResponse(store, sessionManager, message, result.startedAt, endedAt);
    this.queueSave(this.store);
  }

  async sessionTree(sessionManager: SessionManagerLike): Promise<void> {
    await this.ensureSyncedStore();
    this.updateActiveTreePath(sessionManager);
  }

  async sessionShutdown(sessionManager: SessionManagerLike): Promise<TallyStore> {
    const store = await this.ensureSyncedStore();
    this.store = await this.reconcileCurrentSession(store, sessionManager);
    this.store = { ...this.store, previousActiveDayAverage: activeDayAverage(this.store) };
    await this.saveNow(this.store);
    return this.store;
  }

  private async ensureSyncedStore(): Promise<TallyStore> {
    this.store ??= await loadStore(this.paths.storeFile);
    await this.syncPreferences();
    return this.store;
  }

  private async syncPreferences(): Promise<void> {
    if (!this.store) return;
    const preferences = await loadTallyPreferences(this.paths.storeFile);
    if ((preferences.footerEnabled !== undefined && preferences.footerEnabled !== this.store.footerEnabled) || (preferences.toksEnabled !== undefined && preferences.toksEnabled !== this.store.toksEnabled)) {
      this.store = {
        ...this.store,
        ...(preferences.footerEnabled !== undefined ? { footerEnabled: preferences.footerEnabled } : {}),
        ...(preferences.toksEnabled !== undefined ? { toksEnabled: preferences.toksEnabled } : {}),
      };
    }
  }

  private async snapshotWithCurrentPreferences(snapshot: TallyStore, options: SaveOptions = {}): Promise<TallyStore> {
    const preferences = await loadTallyPreferences(this.paths.storeFile);
    const footerEnabled = options.writeFooterPreference ? snapshot.footerEnabled : preferences.footerEnabled;
    const toksEnabled = options.writeToksPreference ? snapshot.toksEnabled : preferences.toksEnabled;
    if ((footerEnabled === undefined || footerEnabled === snapshot.footerEnabled) && (toksEnabled === undefined || toksEnabled === snapshot.toksEnabled)) return snapshot;
    return {
      ...snapshot,
      ...(footerEnabled !== undefined ? { footerEnabled } : {}),
      ...(toksEnabled !== undefined ? { toksEnabled } : {}),
    };
  }

  private queueSave(snapshot: TallyStore, options: SaveOptions = {}): void {
    void enqueueStoreSave(this.paths.storeFile, async () => {
      await saveStoreAtomic(this.paths.storeFile, await this.snapshotWithCurrentPreferences(snapshot, options));
    }).catch(() => undefined);
  }

  private async saveNow(snapshot: TallyStore, options: SaveOptions = {}): Promise<void> {
    await enqueueStoreSave(this.paths.storeFile, async () => {
      await saveStoreAtomic(this.paths.storeFile, await this.snapshotWithCurrentPreferences(snapshot, options));
    });
  }

  private updateActiveTreePath(sessionManager: SessionManagerLike, now = new Date()): void {
    const snapshot = activeTreePathSnapshot(sessionManager, now);
    this.activeTreePath = snapshot.total;
    this.activeTreePathToday = snapshot.today;
  }

  private nextPiCrumbsRotationIndex(): number {
    const current = this.piCrumbsRotationIndex;
    this.piCrumbsRotationIndex = (this.piCrumbsRotationIndex + 1) % Number.MAX_SAFE_INTEGER;
    return current;
  }

  private async reconcileCurrentSession(store: TallyStore, sessionManager: SessionManagerLike): Promise<TallyStore> {
    const record = await currentSessionRecordWithStat(sessionManager);
    if (!record) return store;
    return replaceFileRecordIncremental(store, preserveKnownFileStats(store, record));
  }

  private reconcilePendingUserMessage(store: TallyStore, sessionManager: SessionManagerLike, message: unknown, now = new Date()): TallyStore {
    const record = currentSessionRecordWithPendingUserMessage(sessionManager, message, now);
    if (!record) return store;
    return replaceFileRecordIncremental(store, preserveKnownFileStats(store, record), now);
  }

  private reconcilePendingAssistantResponse(store: TallyStore, sessionManager: SessionManagerLike, message: unknown, startedAt: number | undefined, endedAt = Date.now()): TallyStore {
    const record = currentSessionRecordWithPendingAssistantResponse(sessionManager, message, startedAt, endedAt);
    if (!record) return store;
    return replaceFileRecordIncremental(store, preserveKnownFileStats(store, record), new Date(endedAt));
  }
}
