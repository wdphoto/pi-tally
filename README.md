# pi-tally

A small local prompt counter for Pi.

It adds a compact footer tally and a `/tally` command. It counts your local Pi user messages only. No network calls, uploads, or analytics.

## Install

```bash
git clone https://github.com/wdphoto/pi-tally.git
cd pi-tally
pi install ./
```

Restart Pi after installing.

## Commands

```text
/tally         show your prompt stats
/tally run     count existing Pi session history
/tally status  show storage/index info
```

Run this once after installing if you want old sessions included:

```text
/tally run
```

The footer looks like this:

```text
5/52/84↑
```

That means:

- `5` prompts on the active branch
- `52` prompts today
- `84` average prompts on active days
- `↑` or `↓` trend once there is enough history

## Notes

A `/tally` report looks roughly like this:

```text
pi-tally
────────
Active branch  5 prompts
Today          52 prompts (4.1/hr)
Peak 5h/wk     121 prompts (24.2/hr)
Active avg     84 prompts/day (days >=10)
Weekly avg     96 prompts/day (active days in rolling 7d)
Monthly avg    88 prompts/day (active days in rolling 30d)
All time       5.6k prompts across 350 sessions
Since          2026-03-07 (60 active / 101 calendar days)
```

All counts come from local Pi session files. All-time totals may include inactive branches.

## Data

The counter is stored locally at:

```text
~/.pi/agent/pi-tally.json
```

Pi session files stay where Pi already stores them.

## Uninstall

From the repo directory:

```bash
pi remove ./
```

Optional clean slate:

```bash
rm ~/.pi/agent/pi-tally.json
```
