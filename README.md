# pi-tally

A small local prompt counter for Pi.

It adds a compact footer tally and a `/tally` command. It counts your local Pi user messages only, with a small Pi Crumbs fun fact in the detailed report.

Footer example:

```text
5/52/84↑
```

That means:

- `5` prompts today on the active Pi tree path
- `52` prompts today overall
- `84` average prompts on active days
- `↑` or `↓` trend once there is enough history

Hide or restore the footer with `/tally footer off`, `/tally footer on`, or `/tally footer` to toggle.

## Install

pi-tally is intended to be installed globally for your Pi user, not per project.

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
/tally all          show stats with all Pi Crumbs
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
Since:         2026-03-07 (60 active / 101 calendar days)
Tree:          5
Today:         52 so far (4.1/hr)
Daily:         avg 84   24h 52   7d 96↑   30d 88↓
5h window:     avg 64   high 91   peak 121
Streak:        5d current / 12d record
Record:        221 on 2026-06-14
Total:         5.6k across 350 sessions

Pi Crumbs:     899,934 characters sent to Pi.
```

`Daily: avg` is your all-time active-day average. The `24h`, `7d`, and `30d` numbers are compact recent activity summaries; 7d/30d arrows compare against the previous matching window.
`5h window` summarizes active days' busiest 5-hour stretches over the last 30 days. `high` is the conservative high-use mark; `peak` is the biggest observed window.
`Pi Crumbs` rotates through small local facts such as submitted characters, favorite model, prompt length, streaks, busiest days, and late-night usage. Use `/tally all` to see every available crumb.
Footer day counts use your computer's local calendar day. UTC session filenames do not define "today".
All counts come from local Pi session files. All-time totals may include inactive tree paths.

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
