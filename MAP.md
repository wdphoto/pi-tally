# pi-tally map

## Direction

Keep pi-tally a tiny local Pi counter: useful prompt stats, a compact footer, and a few local-only Pi Crumbs. No telemetry, sync, or network calls.

## Current shape

- `/tally` is the short human dashboard.
- `/tally all` is the same dashboard plus every available Pi Crumb.
- `/tally run` is the explicit history backfill. Do not scan all history on startup.
- Footer stays compact: `tree-path-today/today/active-day-average↑`.
- `today` means the computer's local calendar day.
- `Tree` means the active Pi conversation tree path, not necessarily the full session file.

## Next

- Add better Pi Crumbs:
  - `Most suspicious hour: 1am with 482 prompts.`
  - `You like to work between 10pm–1am.`
  - `% of prompts after 10pm` / late-night share.
  - `1am is apparently a business hour now.`
- Move crumb generation out of `ui.ts` into `crumbs.ts`.
- Share one summary-line builder between `/tally` and `/tally all`.
- Make unknown subcommands warn and return instead of also showing stats.

## Later

- Real favorite-model stats, not just the active model label:
  - parse `model_change` entries and assistant `provider/model`
  - attribute user prompts to the model that answered them
  - prefer 30-day trends over all-time trivia
- Exclude/omit project option keyed by canonical session/project path.
- For very large histories, persist daily/hour/window summaries instead of scanning prompt records on every display.
- Consider multi-window store safety. Atomic writes prevent corruption, but two Pi windows can still last-writer-win each other.

## Not now

- No telemetry or sync.
- No startup full-history scans.
- No model-specific accounting until the attribution rules are clear.
- No rolling 24-hour replacement for user-facing `today` unless explicitly requested.
