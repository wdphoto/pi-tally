# pi-tally

Local prompt counters for [Pi](https://pi.dev).

`pi-tally` adds a compact footer tally and a `/tally` command. It counts local Pi user messages (“prompts”) and stores the counters locally so they persist across sessions.

No collection. No network calls. No uploads.

## Install

From this repo:

```bash
pi install ~/Code/pi-tally/
```

Or from the repo directory:

```bash
pi install ./
```

Restart Pi after installing.

For a one-off test without installing:

```bash
pi -e ./extensions/tally/index.ts
```

## Use

Run this once to backfill existing Pi sessions:

```text
/tally rebuild
```

Show the full tally:

```text
/tally
```

Show storage/index info:

```text
/tally status
```

Footer format:

```text
5/52/84↑ |
```

Meaning:

- `5` — prompts on the active branch of the current session
- `52` — prompts today
- `84` — active-day average prompts/day
- `↑` / `↓` — average changed since previous shutdown

## Local data

The counter file is stored at:

```text
~/.pi/agent/pi-tally.json
```

If `PI_CODING_AGENT_DIR` is set, that directory is used instead.

## Notes

- A prompt is a Pi session entry where `message.role === "user"`.
- All-time totals may include abandoned branches in Pi’s session tree.
- The active-day average ignores days with fewer than 10 prompts when there are active days to average.

## Uninstall

```bash
pi remove ~/Code/pi-tally/
```

Delete the local counter file if you want a clean slate:

```bash
rm ~/.pi/agent/pi-tally.json
```
