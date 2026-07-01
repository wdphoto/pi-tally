# pi-tally refactor notes

This is a detailed engineering review and ground-up refactor sketch for `pi-tally`.
It is intentionally internal. Keep the README short and user-facing.

## Short assessment

`pi-tally` is in good shape for a small Pi package. The important product constraints are already reflected in the code:

- It is local-only and has no runtime dependencies.
- Startup refreshes known files plus the current session, while full discovery stays behind `/tally run`.
- Session JSONL parsing is defensive and malformed rows do not crash the extension.
- The local store uses atomic writes and rebuilds aggregates from file records on load.
- Live `message_end` handling has explicit dedupe coverage.
- Footer and tok/s preferences are global per Pi agent directory and have regression tests.

The code does not need a rescue rewrite. The best refactor would make the same behavior easier to reason about: isolate Pi API adaptation, centralize store reconciliation, split raw facts from derived stats, and make expensive display-time scans easier to replace later.

## Current shape

The runtime modules are already mostly right:

- `extensions/tally/index.ts` wires Pi events, command routing, live reconciliation, footer updates, save queues, preference merging, active tree path counting, and live tok/s estimation.
- `scanner.ts` discovers and parses session files for explicit backfill and known-file refresh.
- `stats.ts` owns store creation, fact extraction, aggregate rebuilds, incremental replacement, and most analytics.
- `crumbs.ts` owns on-demand trivia from stored local facts.
- `storage.ts` owns store migration/loading and atomic persistence.
- `ui.ts` owns footer, `/tally`, `/tally all`, and `/tally status` formatting.

The main pressure point is `index.ts`. It is doing too many distinct jobs because the extension started tiny and grew naturally. The second pressure point is `stats.ts`, which mixes low-level parsing helpers, store mutation, aggregate computation, and query functions.

## Ground-up target architecture

If rebuilding from scratch, keep the same package surface and user behavior, but build around four layers.

### 1. Pi adapter layer

Goal: keep Pi-specific `any` usage and event shapes in one thin module.

Suggested files:

```text
extensions/tally/index.ts
extensions/tally/pi-adapter.ts
extensions/tally/commands.ts
extensions/tally/footer.ts
```

Responsibilities:

- Register `/tally` and Pi lifecycle/message events.
- Convert Pi `ctx.sessionManager`, `ctx.model`, and message events into local typed inputs.
- Render notifications, custom TUI output, and footer status.
- Avoid direct store mutation except through the core controller.

`index.ts` should become almost boring:

```text
resolve paths
create controller
register command handlers
register event handlers
```

This would make Pi API changes much cheaper because most files would never import Pi types or touch `ctx`.

### 2. Core controller layer

Goal: one stateful object owns the loaded store, current path counts, preference sync, and save scheduling.

Suggested files:

```text
extensions/tally/controller.ts
extensions/tally/preferences.ts
extensions/tally/save-queue.ts
```

Responsibilities:

- Load store once per extension instance.
- Refresh known changed files.
- Reconcile the current session.
- Reconcile a pending user message or assistant response without double-counting.
- Merge preference changes from disk before saving stale snapshots.
- Queue and flush atomic saves.
- Produce a `FooterSnapshot` and `DetailSnapshot`.

This is the highest-value refactor. Today, command handlers and event handlers each repeat this sequence in slightly different forms:

```text
load store if needed
sync preferences
reconcile current or pending session state
recompute active tree counts
update arrow
save now or later
set footer
```

A controller can make those flows explicit:

```typescript
await tally.onSessionStart(ctxSnapshot)
await tally.onUserMessageEnd(ctxSnapshot, message)
await tally.onAssistantMessageEnd(ctxSnapshot, message)
await tally.runBackfill()
await tally.setFooterEnabled(true)
```

The adapter can then focus on translating Pi inputs and outputs.

### 3. Data and indexing layer

Goal: separate raw immutable facts from derived summaries.

Suggested files:

```text
extensions/tally/schema.ts
extensions/tally/facts.ts
extensions/tally/indexer.ts
extensions/tally/aggregates.ts
extensions/tally/queries.ts
```

Responsibilities:

- `schema.ts`: store version, persisted shapes, migration helpers, validation.
- `facts.ts`: `PromptFact`, `ResponseFact`, content char counting, timestamp bucketing.
- `indexer.ts`: parse JSONL/session-manager entries into `FileRecord`s.
- `aggregates.ts`: rebuild and incrementally update daily/hourly/session/crumb summaries.
- `queries.ts`: active-day average, rolling counts, streaks, demand windows, response speed stats.

The current store model is a good foundation: persisted file records are the source of truth, and aggregates are derived. Keep that rule. The refactor should make it harder for future code to mutate `daily`, `hourly`, `sessions`, or `crumbs` without also updating `files`.

One good invariant to write down in code:

```text
files are authoritative
aggregates are caches
preferences are independent settings
```

### 4. Presentation layer

Goal: make display formatting deterministic and shared between `/tally` and `/tally all`.

Suggested files:

```text
extensions/tally/snapshot.ts
extensions/tally/ui.ts
extensions/tally/crumbs.ts
```

Responsibilities:

- Build one `DetailSnapshot`.
- Render the common stat lines once.
- Let `/tally` append one selected Crumb.
- Let `/tally all` append every Crumb.

`ui.ts` already has a TODO-shaped duplication: `detailLines()` and `allDetailLines()` manually build the same stat lines. Refactor that first if doing an incremental pass.

## Store model notes

The current store is healthy because it can recover derived data from file records. Preserve that in any rewrite.

Recommended next version shape:

```typescript
interface TallyStoreV2 {
  version: 2;
  files: Record<string, FileRecord>;
  summaries: {
    dailyPrompts: Record<string, number>;
    hourlyPrompts: Record<string, number>;
    sessionPrompts: Record<string, number>;
    promptChars: {
      total: number;
      byDate: Record<string, number>;
      longest: number;
    };
    responseSpeed?: {
      samples: number;
      outputTokens: number;
      durationMs: number;
      latest?: ResponseFact;
    };
  };
  preferences: {
    footerEnabled: boolean;
    toksEnabled: boolean;
  };
  metadata: {
    earliestDate?: string;
    previousActiveDayAverage?: number;
    updatedAt: string;
  };
}
```

This is not needed immediately, but grouping related fields would reduce accidental coupling. It would also let preference-only saves update `preferences` without pretending aggregate data changed.

Migration rule:

- Load unknown or invalid stores as empty.
- Load known stores by validating `files` first.
- Recompute summaries from `files`.
- Preserve preferences whenever valid.
- Preserve `updatedAt` only if it means "last persisted store write"; otherwise rename it in v2.

## Concurrency and writes

The current in-process save queue plus atomic rename is a solid baseline. The remaining risk is multiple Pi processes writing the same global store.

Options, in increasing complexity:

1. Keep current behavior and document last-writer-wins for prompt counters.
2. Before every save, load disk, merge preferences, and merge file records by path if their `mtimeMs/size` differ.
3. Add a lightweight lock file around read-modify-write.
4. Split preferences into a small separate file so preference toggles cannot be overwritten by counter saves.

The conservative next step is option 2. It keeps the no-dependency local JSON model and handles the most common multi-window case. A separate preference file is also attractive because preferences are user settings, not index data.

## Performance notes

Current behavior is fine for small and medium histories. The obvious future bottlenecks are display-time queries that scan all prompt facts:

- `rollingPromptCount()`
- `fiveHourDemand()`
- several Crumbs that call `allPrompts()` or sort timestamps
- response speed stats if response facts grow large

Do not add a background indexer. If histories become large, add persisted summaries that are updated during `/tally run` and known-file refresh.

Potential persisted summaries:

- daily prompt count
- hourly prompt count
- per-day character count
- per-day active session count
- sorted or bucketed timestamps for recent rolling windows
- response speed totals and latest sample

For now, a useful middle ground is to create query helpers that clearly mark which functions scan all records. That makes future optimization a targeted swap instead of a hunt.

## Refactor phases

### Phase 1: Low-risk cleanup

- Share one stat-line builder between `detailLines()` and `allDetailLines()`.
- Move `compactNumber()` and count label helpers into one formatting helper so `ui.ts` and `crumbs.ts` do not drift.
- Move live tok/s helper functions out of `index.ts` into `footer.ts` or `speedometer.ts`.
- Give the `ctx.sessionManager` accessors a local interface instead of scattered `any`.
- Add tests for malformed-but-loadable store records with bad `responses`, bad `prompts`, and invalid dates.

### Phase 2: Controller extraction

- Extract save queue to `save-queue.ts`.
- Extract preference load/merge behavior to `preferences.ts`.
- Create a `TallyController` with methods for command/event flows.
- Keep `index.ts` as the Pi adapter.
- Add tests that call the controller directly for session start, user message end, assistant message end, backfill, footer toggle, and tok/s toggle.

This phase should not change the persisted store shape.

### Phase 3: Data layer split

- Move fact extraction from `stats.ts` to `facts.ts`.
- Move store aggregate rebuild/replacement to `aggregates.ts`.
- Move analytics/query functions to `queries.ts`.
- Keep compatibility exports from `stats.ts` for one release if desired.
- Add an invariant test: `replaceFileRecordIncremental()` matches `recomputeAggregates()` for representative file replacements.

### Phase 4: Store v2, only if it earns its keep

- Group preferences, summaries, and metadata.
- Add migration from v1 to v2.
- Preserve the source-of-truth rule: rebuild summaries from file records on load.
- Consider a preference-only file if multi-window preference writes keep mattering.

## Testing priorities

The existing test suite covers the most important behaviors. Add coverage around the refactor seams before moving code:

- Current-session reconciliation preserves known file stats and does not drop response facts.
- Pending user messages dedupe by id and by fallback timestamp/content shape.
- Assistant response facts dedupe across persisted session entries and pending event facts.
- `/tally run` preserves preferences and previous active-day baseline.
- A loaded project picks up externally toggled `footerEnabled` and `toksEnabled` before saving.
- Incremental aggregate replacement matches full recompute after replacing, deleting, or emptying a file.
- JSONL parser handles missing headers, malformed headers, malformed rows, legacy timestamps, and first-line user messages.
- Display lines fit narrow TUI widths through `truncatePlainLine()`.

For property-style confidence without new dependencies, a small deterministic fixture generator in tests would be enough.

## Small product improvements

These are improvements even if there is no large refactor:

- Add `/tally footer status` or include explicit preference status in `/tally status` only. The current status output is probably enough, so this is low priority.
- Add an omit/exclude-project option keyed by canonical project path from session metadata/current cwd.
- Add stale temp-file cleanup for old `pi-tally.json.*.tmp` files.
- Make model trivia historical only after attribution is correct. The active model is not really a favorite model.
- Consider hiding the tok/s meter when there are no samples and nothing is streaming. `0.0 tok/s` is useful for showing the meter is enabled, but visually noisy.
- Revisit Crumb tone as the data set grows. The best Crumbs are specific, local, and earned by data; generic filler should stay out.

## Things to preserve

- No network calls.
- No runtime dependencies unless there is an unusually strong reason.
- No full-history discovery on startup.
- No taxing background work.
- Local calendar-day semantics for `today`.
- Footer active tree path count scoped to the local day.
- `/tally` `Tree` count as the full active tree path total.
- Atomic local storage writes.
- Defensive session parsing.
- README stays short and user-facing.
- `package.json.files` stays limited to runtime package contents.

## Suggested final module map

```text
extensions/tally/
  index.ts          Pi registration only
  pi-adapter.ts     typed wrappers around ctx/session/model/ui
  commands.ts       command parsing and dispatch
  controller.ts     stateful orchestration
  preferences.ts    preference read/merge/write helpers
  save-queue.ts     serialized save queue
  config.ts         constants and path resolution
  schema.ts         store versions and migration types
  facts.ts          prompt/response fact extraction
  indexer.ts        JSONL/session record parsing
  aggregates.ts     recompute and incremental updates
  queries.ts        averages, streaks, windows, totals
  crumbs.ts         on-demand local facts
  snapshot.ts       detail/footer snapshot builders
  ui.ts             render snapshots to strings
  types.ts          shared public-ish types
```

Do not split all of this at once. The useful order is controller first, then data/query split, then any store shape change.

