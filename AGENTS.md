# AGENTS.md

Concise revival guide for future agents working on `pi-tally`.

## What this is

`pi-tally` is a tiny local Pi extension. It counts **local Pi user prompts** and shows:

- footer status: `tree-path-today/today/active-day-average↑`
- `/tally`: compact stats plus one rotating Crumb
- `/tally all`: the same stats plus every available Crumb
- `/tally run`: explicit history backfill/indexing
- `/tally status`: storage and index info

Keep it native-first, lightweight, boringly reliable, and a little fun.

## Hard rules

- No telemetry, analytics, sync, uploads, or network calls.
- No runtime dependencies unless there is a very strong reason.
- No full-history scan on startup. Full backfill belongs behind `/tally run` only.
- No taxing background process. Normal live updates should touch only the active session/tree.
- Parse Pi session JSONL defensively; malformed files must not crash Pi.
- Keep README user-facing and short. No agent notes or internal manuals.
- In README install/uninstall sections, list npm first and GitHub/source second.
- Keep `package.json.files` limited to runtime package contents.

## Runtime layout

```text
extensions/tally/
  index.ts    Pi event wiring, commands, live reconciliation, footer updates
  config.ts   constants and path resolution
  scanner.ts  explicit session discovery and defensive JSONL parsing
  stats.ts    counters, aggregates, averages, trends, streaks
  crumbs.ts   on-demand local-only fun facts
  storage.ts  versioned local store and atomic writes
  types.ts    shared types
  ui.ts       footer and `/tally` display formatting
```

Tests live in `test/`; Pi does not load them and npm excludes them.

## Data model

Default store:

```text
~/.pi/agent/pi-tally.json
```

Respect:

- `PI_CODING_AGENT_DIR`
- `PI_CODING_AGENT_SESSION_DIR`

The store is local JSON with atomic writes. It keeps indexed file records plus derived aggregates. If aggregates look suspect, rebuild them from file records rather than trusting stale counters.

## Core behavior

- Count user messages only.
- `today` means the computer's local calendar day, not UTC and not rolling 24h.
- Footer `tree-path-today` is the current Pi tree path for the local day.
- `/tally` `Tree` is the full active tree path total, including previous local days.
- Live `message_end` should not double-count if Pi already exposes the just-ended message.
- Footer toggle is user-global for the active Pi agent directory, not project-local.
- `/tally footer`, `/tally footer on`, and `/tally footer off` must persist without `/reload`.
- Loaded projects must pick up an externally disabled footer before saving.

## Crumbs

Crumbs are on-demand, local-only trivia from data we already store. Keep them:

- cheap enough to compute when `/tally` runs
- unique/funny/interesting, not generic filler
- privacy-safe: do not store or upload prompt text

Current Crumbs use counts, timestamps, hours, dates, sessions, and character counts. If Crumbs become expensive for large histories, add persisted summaries instead of background scanning.

## Commands to run

```bash
npm run check
npm test
npm run pack:dry
```

Local Pi smoke test:

```bash
pi -e ./extensions/tally/index.ts
```

Then in Pi:

```text
/tally run
/tally
/tally all
/tally status
```

## Release checklist

- Update `CHANGE.md` before commits/pushes and check it before release.
- Bump `package.json` and `package-lock.json` together.
- Run `npm run check`, `npm test`, and `npm run pack:dry`.
- Commit code and version bump.
- Tag as `vX.Y.Z`.
- Publish the same version to npm.
- Create the matching GitHub Release.
- Do not leave a pushed GitHub tag/version without the matching npm publish unless explicitly asked to pause.

## Pi docs to read before API/layout changes

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md` before custom UI work

## If rebuilding from scratch

1. Resolve paths from Pi env vars, defaulting to `~/.pi/agent`.
2. Load the local store defensively; migrate or start empty.
3. On startup, refresh only known changed files plus the current session. Do not discover all history.
4. On `message_end`, reconcile the active session and update footer immediately.
5. Put all full session discovery behind `/tally run`.
6. Keep storage atomic and local.
7. Render compact stats from aggregates.
8. Generate Crumbs on demand from existing local aggregates/file records.
