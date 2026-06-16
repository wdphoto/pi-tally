# pi-tally

Local prompt counters for [Pi](https://pi.dev). MIT licensed.

`pi-tally` adds a compact footer tally and a `/tally` command. It counts local Pi user messages (“prompts”) and saves those counters locally so the tally survives across sessions.

It does **not** collect data. It does **not** call the network. It does **not** upload anything. The persistence file lives on your machine next to Pi’s normal agent data.

## Install

From a local checkout:

```bash
pi install ./
```

For quick testing without installing:

```bash
pi -e ./extensions/tally/index.ts
```

From GitHub once published:

```bash
pi install git:github.com/<user>/pi-tally
```

## What you get

Footer status:

```text
5/52/84↑ |
```

Legend:

- `5` — prompts on the active branch of the current session
- `52` — prompts today
- `84` — active-day average prompts/day
- `↑` / `↓` — active-day average changed since the previous shutdown

Detailed view:

```text
/tally
```

Maintenance:

```text
/tally rebuild   # rescan local Pi session files; run once to backfill old sessions
/tally status    # show local paths and index health
```

## Privacy and storage

`pi-tally` is just a local counter.

- No telemetry.
- No network requests.
- No analytics service.
- No external database.
- No background file watcher.

By default the store file is:

```text
~/.pi/agent/pi-tally.json
```

If you set `PI_CODING_AGENT_DIR`, that directory is used instead. If you set `PI_CODING_AGENT_SESSION_DIR`, `/tally rebuild` scans that session directory.

## Caveats

- A “prompt” means a Pi session entry where `message.role === "user"`.
- “Active branch” uses Pi’s current session branch.
- All-time totals count prompts in indexed session files and may include abandoned branches in Pi’s session tree.
- Historic totals are best-effort based on Pi’s JSONL session files.
- The active-day average ignores days with fewer than 10 prompts when there are active days to average.

## Development

```bash
npm install
npm run check
npm test
npm run pack:dry
```

## Uninstall

```bash
pi remove ./
```

Or remove the Git/npm package source you installed.

The local counter file can be deleted manually if you want a clean slate:

```bash
rm ~/.pi/agent/pi-tally.json
```

## License

MIT. See [LICENSE](./LICENSE).
