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

## Use

Count your existing Pi session history once:

```text
/tally run
```

Show the tally:

```text
/tally
```

Show storage/index info:

```text
/tally status
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
