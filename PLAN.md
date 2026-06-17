# pi-tally plan

## Current product direction

Keep pi-tally a tiny local counter: prompt counts, simple demand stats, no network, no model-specific accounting until there is a clear user need.

## Current decisions

- `today` means the computer's local calendar day.
- The compact footer is `tree-path-today / today / active-day average`.
- UTC session filenames are storage details only; user-facing day buckets use local time.
- `/tally` uses `Tree path` for the full active Pi tree path total, even across midnight.
- `/tally` shows both active-day average and daily high.

## Later, maybe

- If average feels misleading, consider richer distribution stats, but keep the default report short.
- Model usage trends may be useful later; if added, attribute user prompts to the model that answered them and prefer a 30-day trend over all-time trivia.

## Not now

- No telemetry or sync.
- No startup full-history scans.
- No rolling 24-hour `today` unless the user explicitly asks.
