# pi-tally build plan

## Prototype review

Source reviewed: internal first prototype.

What is worth keeping:

- The core idea is good: compact footer signal plus a detailed slash-command breakdown.
- It uses the right Pi primitives: `session_start`, `message_end`, `session_tree`, `session_shutdown`, `registerCommand`, and `ctx.ui.setStatus()`.
- It correctly distinguishes active-branch prompt count from whole-session/all-time counts.
- Local date buckets are the right user-facing choice.
- The “active day” threshold is a sensible way to avoid averaging against dead/noise days.

What needs to change before public release:

- Do not ship a single big extension file. Split pure tally logic from Pi event wiring.
- Do not synchronously full-scan every session on startup/version bumps. That can freeze Pi for users with years of sessions.
- Do not store global state as an ad hoc JSON file with no migration story. Make storage versioned and atomic.
- Use `/tally`; this package is `pi-tally`.
- Do not parse session internals casually. Pi session JSONL is documented, but still an internal-ish contract. Build a scanner with fixtures and tests.
- Guard custom TUI. `ctx.ui.custom()` is TUI-only; provide a sane non-TUI path or no-op clearly.
- Be explicit that totals are local counters of prompts written to session files, not “productive work,” not collection, and may include non-active branches.

Opinionated pushback: the prototype is useful, but shipping it as-is would look like a dotfiles hack. A public Pi package should be small, tested, documented, and conservative about startup cost.

## Product scope

### v1 goals

- Pi package named `pi-tally`.
- One extension entrypoint: `src/index.ts`.
- Footer status, default compact form:

  ```text
  5/52/84↑ |
  ```

  Meaning: active-branch prompts / today prompts / active-day average, with optional trend arrow.

- Slash command:

  ```text
  /tally
  /tally rebuild
  /tally status
  ```

- Local-only counter persistence under Pi’s agent dir.
- Incremental indexing of Pi session JSONL files.
- Tests for scanner, storage, rollups, and formatting.

### Explicit non-goals for v1

- Charts, graphs, calendars, or dashboards.
- Network sync, telemetry, analytics, or any data collection.
- Watching session directories in the background.
- Measuring assistant/tool messages.
- Claiming exact productivity or time-tracking semantics.

## Architecture

```text
src/
  index.ts       Pi extension factory: events, commands, lifecycle only
  config.ts      constants, env/path resolution, command/status keys
  types.ts       storage records, prompt facts, rollup types
  storage.ts     versioned load/save/migrate, atomic writes
  scanner.ts     session-file discovery and JSONL prompt extraction
  stats.ts       buckets, averages, rolling windows, trend math
  ui.ts          footer string, detail lines, optional custom TUI renderer
```

### Data model sketch

Use a versioned storage file, likely `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pi-tally.json`.

Track enough metadata to avoid double-counting:

```ts
interface TallyStoreV1 {
  version: 1;
  files: Record<string, {
    sessionId: string;
    mtimeMs: number;
    size: number;
    promptEntryIds: string[];
  }>;
  promptsByDay: Record<string, number>;       // YYYY-MM-DD local
  promptsByHour: Record<string, number>;      // YYYY-MM-DD HH local
  sessions: Record<string, number>;           // sessionId -> total user prompts in file/tree
  previousActiveDayAverage?: number;
  earliestDate?: string;
}
```

If storing all `promptEntryIds` gets large, replace with per-file facts plus rebuild-on-change. Correctness beats cleverness for v1.

### Session semantics

- Active branch count comes from `ctx.sessionManager.getBranch()` and counts `entry.type === "message" && entry.message.role === "user"`.
- Current session total comes from `ctx.sessionManager.getEntries()`.
- Global totals come from scanning persisted session JSONL files.
- Scanner counts user message entries across the whole file/tree. README must say this includes abandoned branches.

## Implementation phases

### Phase 0 — Bootstrap repository

Create:

- `package.json`
- `README.md`
- `LICENSE`
- `src/`
- `test/`
- `tsconfig.json`
- test runner config, preferably Vitest

Package manifest requirements:

- `keywords`: include `pi-package`, `pi-extension`.
- `pi.extensions`: `[`./src/index.ts`]`.
- Pi packages as peer dependencies with `"*"` ranges when imported.
- No runtime third-party dependency unless required.

Acceptance:

- `npm install`
- `npm run check`
- `npm test`
- `npm pack --dry-run` shows sane package contents.

### Phase 1 — Pure core

Implement and test:

- `bucketFromTimestamp(ts, fallback)` using local day/hour buckets.
- `isUserPromptEntry(entry)`.
- `extractPromptFact(line)` for JSONL lines.
- `add/subtract prompt facts from aggregate buckets`.
- `activeDayCounts`, `rollingAvg`, `todayPrompts`, `peak5hWeekly`, `formatCompactNumber`.
- Footer formatting.

Acceptance:

- No Pi imports in `stats.ts` or scanner parsing helpers except shared types if unavoidable.
- Fixtures cover malformed JSON and missing timestamps.

### Phase 2 — Storage and scanner

Implement:

- Agent dir resolution:
  - stats dir: `PI_CODING_AGENT_DIR || ~/.pi/agent`
  - sessions dir: `PI_CODING_AGENT_SESSION_DIR || <agentDir>/sessions`
- `loadStore()` with migration/defaults.
- `saveStoreAtomic()` using temp file + rename.
- Session discovery under `sessions/**.jsonl`.
- Incremental rescan by file `mtimeMs` and `size`.
- Rebuild command path that clears store and scans from scratch.

Acceptance:

- Re-running scan does not double-count.
- Modifying one fixture file updates only that file’s contribution.
- Corrupt store recovers to empty with warning-friendly error result, not throw-to-Pi.

### Phase 3 — Pi extension wiring

Implement `src/index.ts`:

- Register `/tally` command.
- `session_start`:
  - load store
  - do cheap current-session reconciliation
  - set footer status
  - do not surprise full-scan synchronously unless store is empty and scan is bounded/fast
- `message_end` for user messages:
  - update active count
  - update today/hour buckets and current session total
  - save atomically
  - refresh status
- `session_tree`:
  - recompute active branch count only
  - refresh status
- `session_shutdown`:
  - reconcile current session total
  - save previous average/trend baseline

Command behavior:

```text
/tally          show detailed stats
/tally rebuild  full rescan all sessions, with notification/progress
/tally status   show storage/session paths and index health
```

Acceptance:

- `pi -e ./src/index.ts` loads.
- Footer appears and updates after a user prompt.
- `/tally` works in TUI.
- Non-TUI modes do not crash.

### Phase 4 — UI polish

Keep it native and restrained.

- Use `ctx.ui.setStatus("pi-tally", ...)` for footer.
- For `/tally` in TUI, use a small custom component or simple notification-style output.
- If using `ctx.ui.custom()`, follow `docs/tui.md`:
  - lines must not exceed render width
  - implement `render`, `invalidate`, `handleInput`
  - close on Enter/Escape
  - use theme from callback
- Do not replace the whole footer in v1.

Acceptance:

- Narrow terminal rendering does not spill lines.
- Theme changes invalidate correctly enough for this simple UI.
- Text labels are clear: “active branch,” “today,” “active-day avg,” “all-time.”

### Phase 5 — README and release hygiene

README must include:

- What it does.
- Install:

  ```bash
  pi install git:github.com/<user>/pi-tally
  # later, if published:
  pi install npm:pi-tally
  ```

- Temporary test:

  ```bash
  pi -e ./src/index.ts
  ```

- Command reference.
- Footer legend.
- Privacy statement: local counters only, no collection, no network, no telemetry.
- Caveats:
  - counts user prompts, not all messages
  - all-time totals include session-tree branches
  - historic counts are best-effort based on Pi session JSONL
- Troubleshooting:
  - `/tally rebuild`
  - where the store file lives
  - how to uninstall/remove package

Acceptance:

- No references to personal backup paths.
- No prototype command names or personal paths remain.
- Screenshots/demo optional, not blocking.

### Phase 6 — Local package testing

Run:

```bash
npm run check
npm test
npm pack --dry-run
pi -e ./src/index.ts
pi install ./
pi list
pi remove ./
```

Manual TUI checklist:

- Start fresh session.
- Send two prompts.
- Navigate `/tree`; active branch count changes.
- Run `/tally`.
- Run `/tally rebuild`.
- Resume older session.
- Quit and restart; status persists.

## Design decisions to make early

1. Default status enabled or opt-in?
   - Recommendation: enabled. It is the whole point, and it is compact.
2. Config file?
   - Recommendation: no user config in v1. Hardcode sane defaults. Add config only when someone asks.
3. Active-day threshold?
   - Recommendation: keep `10` prompts, document it. Maybe expose later.
4. Command namespace?
   - Recommendation: `/tally`. Do not ship aliases in v1; aliases invite collisions.
5. npm name?
   - If unscoped `pi-tally` is available, take it. Otherwise use a scope. Git installs work either way.

## Risks

- Pi session format changes: mitigate with small scanner, tests, and documented assumptions.
- Large history startup lag: mitigate with incremental scanner and explicit rebuild.
- Double-counting live messages after scans/reloads: mitigate with per-file indexing or current-session reconciliation tests.
- Footer clutter: keep compact and provide command docs.
- Privacy perception: README must be blunt that this is local counter persistence only; no collection, no network.

## Done definition for v1

- Public repo looks boring and professional.
- Extension can be installed as a Pi package from git.
- Tests pass.
- No startup freezes on a normal session directory.
- `/tally` and footer answer the core question without pretending to be more exact than they are.
