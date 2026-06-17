# pi-tally

A small local prompt counter for Pi.

It adds a compact footer tally and a `/tally` command. It counts your local Pi user messages only.

Footer example:

```text
5/52/84↑
```

That means:

- `5` prompts on the active branch
- `52` prompts today
- `84` average prompts on active days
- `↑` or `↓` trend once there is enough history

Hide or restore the footer with `/tally footer off`, `/tally footer on`, or `/tally footer` to toggle.

## Install

From npm:

```bash
pi install npm:pi-tally
```

From GitHub/source:

```bash
pi install https://github.com/wdphoto/pi-tally
```

Restart Pi after installing.

## Commands

```text
/tally              show your prompt stats
/tally run          count existing Pi session history
/tally status       show storage/index info
/tally footer       toggle footer tally on/off
/tally footer on    show footer tally
/tally footer off   hide footer tally
```

Run this once after installing if you want old sessions included:

```text
/tally run
```

After that, pi-tally updates live as you use Pi. Run `/tally run` again only for missed/imported sessions or a clean rebuild.

## Notes

A `/tally` report looks roughly like this:

```text
pi-tally
────────
5h demand      avg 64 / high 91 / peak 121
Active days    18 in last 30d
Model          deepseek/deepseek-v4-pro
Today          52 so far (4.1/hr)
This branch    5
Daily avg      84/day on active days
7d avg         96/day on active days
30d avg        88/day on active days
All time       5.6k across 350 sessions
Indexed since  2026-03-07 (60 active / 101 calendar days)
```

`5h demand` summarizes active days' busiest 5-hour stretches over the last 30 days. `high` is the conservative high-use mark; `peak` is the biggest observed window.
All counts come from local Pi session files. All-time totals may include inactive branches.

## Data

The counter is stored locally at:

```text
~/.pi/agent/pi-tally.json
```

Pi session files stay where Pi already stores them.

## Uninstall

If installed from npm:

```bash
pi remove npm:pi-tally
```

If installed from GitHub/source:

```bash
pi remove https://github.com/wdphoto/pi-tally
```

Optional clean slate:

```bash
rm ~/.pi/agent/pi-tally.json
```
