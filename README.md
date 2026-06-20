# pi-tally

![pi-tally screenshot](https://raw.githubusercontent.com/wdphoto/pi-tally/main/tally.png)

A small local user prompt counter for Pi. It adds a compact tally to the footer and a `/tally` command.

Use `/tally run` after installing to count your session history.

Hide or restore the footer with `/tally footer` to toggle.

That's pretty much it. Definitely a work in progress.

Footer example:
```text
5/52/84↑
```
That means:
- `5` prompts today on the active Pi tree path
- `52` prompts today overall
- `84` average prompts on active days
- `↑` or `↓` trend once there is enough history

## Install
pi-tally is intended to be installed globally for your Pi user, not per project. I haven't even tested it any other way.

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
/tally run          count your Pi history
/tally              show your stats
/tally all          show verbose stat output
/tally footer       toggle footer tally on/off
/tally status       show storage/index info
```

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
