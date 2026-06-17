# Changelog

All notable changes to `pi-tally` are tracked here.

## Unreleased

- Added the current model to `/tally` output when Pi exposes it.
- Simplified README intro wording.

## 0.0.4 - 2026-06-16

- Added `/tally footer`, `/tally footer on`, and `/tally footer off` to toggle the footer tally locally.
- Put npm install/uninstall instructions before GitHub/source instructions in the README.
- Changed GitHub/source README instructions to use `pi install https://github.com/wdphoto/pi-tally` and matching `pi remove`.

## 0.0.3 - 2026-06-16

- Documented npm install usage.
- Added release sync guidance and changelog maintenance notes.
- Moved the sample footer output near the top of the README.
- Improved `/tally` 5-hour demand stats for plan selection with avg/high/peak over a 30-day default lookback.
- Documented that `/tally run` is only needed for old or missed sessions after live updates are active.

## 0.0.2 - 2026-06-15

- Fixed live tally updates.

## 0.0.1 - 2026-06-15

- Initial local Pi prompt counter extension.
- Added compact footer status.
- Added `/tally`, `/tally run`, and `/tally status` commands.
- Added local JSON store with atomic writes.
