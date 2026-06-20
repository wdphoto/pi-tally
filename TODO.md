# TODO

Reminders, questions, and research notes. Product direction lives in `MAP.md`; release notes live in `CHANGE.md`.

## Research / decisions

- Multi-window writes: decide whether pi-tally needs store merge/locking, or whether last-writer-wins is acceptable for now.
- Real favorite model: verify the best attribution rule from Pi session history before claiming historical model usage.
- Large history path: decide when to add persisted daily/hour/window summaries.

## Reminders

- Add an omit/exclude-project option so a project can be left out of pi-tally totals. Keep it local and explicit, likely keyed by canonical project path from session metadata/current cwd.
- Keep pi-tally global/user-scoped. `/tally footer` is global per Pi agent directory because the setting is stored in `~/.pi/agent/pi-tally.json` as `footerEnabled`.
- Clean up stale `pi-tally.json.*.tmp` files opportunistically.
