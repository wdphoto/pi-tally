# AGENTS.md

Guidance for future coding agents working on `pi-tally`.

## Project

`pi-tally` is a small Pi extension that counts local Pi user prompts and shows:

- compact footer status
- `/tally` detailed stats
- `/tally run` history indexing
- `/tally status` storage/index info

Keep it boring, local, and reliable.

## Non-negotiables

- No telemetry, analytics, uploads, sync, or network calls.
- Do not add runtime dependencies unless there is a strong reason.
- Do not scan all session history on startup. Full history indexing belongs behind `/tally run`.
- Keep the README human-readable. No big manuals, no agent/internal planning notes.
- In README install/uninstall sections, list npm first and GitHub/source second.
- Keep `package.json.files` limited to runtime package contents.
- Treat Pi session JSONL parsing defensively. Bad session files must not crash Pi.

## Layout

Runtime extension:

```text
extensions/tally/
  index.ts    Pi event wiring and commands
  config.ts   constants and path resolution
  scanner.ts  session file discovery and JSONL parsing
  stats.ts    counters, averages, trends
  storage.ts  versioned local store and atomic writes
  types.ts    shared types
  ui.ts       footer and `/tally` display formatting
```

Tests live in `test/`. Pi does not load them, and npm package contents exclude them.

## Useful commands

```bash
npm run check
npm test
npm run pack:dry
```

## Releases

Keep GitHub and npm releases in sync:

- Update `CHANGELOG.md` before commits/pushes, and check it again before release.
- Bump `package.json` and `package-lock.json` together.
- Run `npm run check`, `npm test`, and `npm run pack:dry` before release.
- Commit the version bump and code changes.
- Create and push the matching git tag, e.g. `v0.0.2`.
- Publish the same version to npm.
- Create the matching GitHub Release from the tag.
- Do not leave a pushed GitHub tag/version without the matching npm publish unless the user explicitly asks to pause.

Local Pi test:

```bash
pi -e ./extensions/tally/index.ts
```

After installing/reloading Pi:

```text
/tally run
/tally
/tally status
```

## Pi docs to check before API/layout changes

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md` before touching custom UI

## Footer behavior

Footer format:

```text
tree-path-today/today/active-day-average↑
```

Example:

```text
5/52/84↑
```

- `tree-path-today` is user prompts on the current Pi tree path for the computer's local calendar day.
- `today` is all indexed/live user prompts for the computer's local calendar day.
- UTC session filenames are storage details; do not use them to decide user-facing days.
- `/tally` shows `Tree path` as the full active tree path total, including prompts from previous local days.

Do not add separators like trailing pipes. Pi composes extension statuses itself.

Users can toggle the footer with `/tally footer`, `/tally footer on`, and `/tally footer off`. This should persist locally and not require `/reload`.

## Plan and stats notes

- Keep `PLAN.md` short and user/product focused; do not turn it into an agent scratchpad.
- 5-hour demand stats are for GPT plan selection.
- Default 5-hour demand lookback should be 30 days for now; all-indexed history may come later, but only if calculation remains bounded/incremental.
- For large histories, prefer persisted per-day/window summaries over recomputing every prompt on each `/tally` display.
- Count user messages only for now; no model-specific usage tracking yet.
- `/tally run` should remain a one-time/backfill command. Normal future prompts should update live without asking users to rerun it.
- `today` means the computer's local calendar day. Do not switch it to UTC or rolling 24h unless the user explicitly asks.
- Show a plain `Daily high` line in `/tally` alongside active-day average.
- Current model display is not model usage tracking. Future model usage trends should attribute user prompts to the model that answered them, then show a simple 30-day model choice/trend line rather than all-time first.

## Storage

Default store path:

```text
~/.pi/agent/pi-tally.json
```

Respect:

- `PI_CODING_AGENT_DIR`
- `PI_CODING_AGENT_SESSION_DIR`

Storage writes must remain atomic.
