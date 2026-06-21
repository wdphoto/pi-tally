# pi-tally

![pi-tally screenshot](https://raw.githubusercontent.com/wdphoto/pi-tally/main/tally.png)

A small local user prompt counter for Pi. It adds a compact tally to the footer and a `/tally` command.

Use `/tally run` after installing to count your session history.

Hide or restore the footer with `/tally footer` to toggle. The toggle applies across projects using the same Pi agent directory.

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
Since:         2026-03-07 (60 active days / 101 calendar days)
Tree:          5 messages on active path
Today:         52 messages so far (4.1 messages/hr)
Daily avg:     84 messages/day   last 24h 52 messages
Recent avg:    7d 96 messages/day↑   30d 88 messages/day↓
5h window:     avg 64 messages   high 91 messages   peak 121 messages
Streak:        5 days current / 12 days record
Record:        221 messages on 2026-06-14
Total:         5.6k messages across 350 sessions

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
