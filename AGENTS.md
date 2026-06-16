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
active-branch/today/active-day-average↑
```

Example:

```text
5/52/84↑
```

Do not add separators like trailing pipes. Pi composes extension statuses itself.

## Storage

Default store path:

```text
~/.pi/agent/pi-tally.json
```

Respect:

- `PI_CODING_AGENT_DIR`
- `PI_CODING_AGENT_SESSION_DIR`

Storage writes must remain atomic.
