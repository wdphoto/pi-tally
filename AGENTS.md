# AGENTS.md

Project: `pi-tally`, a polished Pi package/extension for local prompt counters.

## Mission

Build a small, idiomatic Pi extension that shows useful local prompt counts without being noisy, creepy, or brittle. The extension should feel native in Pi: compact footer status, explicit slash command for details, no network calls, no background surprises.

## Non-negotiables

- Read the Pi extension docs before changing extension APIs or packaging:
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
  - Read `docs/tui.md` before touching custom UI.
- Keep the runtime extension boring. No dependencies unless they clearly earn their weight.
- No telemetry. No network. No analytics upload. No collection. Counters are stored locally only for persistence across sessions.
- Do not do expensive full-session scans in the extension factory. Avoid blocking `session_start` with large synchronous work.
- Prefer pure functions for parsing, bucketing, and rollups. The Pi event handler should be a thin orchestration layer.
- Treat Pi JSONL session parsing as an implementation detail with tests and versioned migrations.
- Use mode guards:
  - `ctx.mode === "tui"` before `ctx.ui.custom()` or terminal-specific UI.
  - `ctx.hasUI` before notifications/status updates.
- Status footer must remain compact and optional. The detailed view belongs behind `/tally`.

## Product language

Use precise terms:

- “prompt” = user message entries.
- “active branch” = `ctx.sessionManager.getBranch()` count.
- “all-time” / “today” = prompts ever written to Pi session files, including inactive branches unless explicitly stated.

Avoid pretending this is scientific productivity measurement. It is a local counter, not collection, surveillance, or truth.

## Expected package shape

Target structure:

```text
pi-tally/
  package.json
  README.md
  AGENTS.md
  BUILD-PLAN.md
  extensions/
    tally/
      index.ts        # Pi extension entrypoint
      config.ts
      scanner.ts
      storage.ts
      stats.ts
      ui.ts
      types.ts
  test/
    fixtures/
    *.test.ts
```

`package.json` should expose Pi resources with:

```json
{
  "keywords": ["pi-package", "pi-extension"],
  "pi": { "extensions": ["./extensions"] },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

Only add `@earendil-works/pi-tui` as a peer if imported directly. Put runtime third-party deps in `dependencies`; test/build-only deps in `devDependencies`.

## Coding principles

- Separate core logic from Pi wiring:
  - scanner: reads session files and emits prompt facts
  - stats: derives rollups and display values
  - storage: versioned load/save/migrate with atomic writes
  - ui: formatting/rendering helpers
  - index: Pi events and commands only
- Storage writes must be atomic: write temp file, then rename.
- Store enough indexing metadata to avoid double-counting and unnecessary rescans. At minimum track file path, mtime/size, and counted entry ids or a safe equivalent.
- Handle malformed JSONL lines defensively; never crash Pi because a session file is weird.
- Use local-time buckets for user-facing day/hour displays.
- Keep the footer format short. If it needs a legend, put the legend in `/tally` and README.
- Favor `/tally`; it is package-branded and less collision-prone.

## Testing expectations

Before claiming done, run:

```bash
npm run check
npm test
```

Tests should cover:

- malformed session files
- v3 session message entries
- active branch vs all entries semantics
- local date/hour buckets including invalid timestamps
- incremental rescan without double-counting
- storage migration/version handling
- display formatting and compact footer strings

## Release expectations

Before publishing or tagging:

- README has install, usage, privacy, command reference, footer legend, and caveats.
- `npm pack --dry-run` contains only intended files.
- Test local install with `pi -e ./extensions/tally/index.ts` and `pi install ./`.
- No personal paths, backup references, or prototype command names remain.
