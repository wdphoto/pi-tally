# Changelog

All notable changes to `pi-tally` are tracked here.

## Unreleased

## 0.0.7 - 2026-06-20

- Added a README screenshot of the `/tally` output.
- Polished and shortened the README setup and command guidance.
- Moved first-run `/tally run` and footer-toggle notes closer to the top of the README.
- Ignored local Pi construct metadata so fetched local packages do not dirty git status.

## 0.0.6 - 2026-06-20

- Cleaned up `/tally` output: removed the header, moved `Since` to the top, renamed tree-path display to `Tree`, and moved Pi Crumbs to the bottom.
- Replaced separate 7-day and 30-day average lines with one compact `Daily` line showing all-time active-day average plus 24h, 7d, and 30d recent activity.
- Added all-time `Record` and current/record `Streak` lines to the main `/tally` output.
- Added `/tally all` for normal stats plus a full list of available Pi Crumbs.
- Added Pi Crumbs, a rotating `/tally` fun-fact line with submitted characters, favorite model, prompt length, streak, busiest-day, and late-night usage facts.

## 0.0.5 - 2026-06-17

- Added the current model to `/tally` output when Pi exposes it.
- Changed the compact footer's tree-path count to use the computer's local calendar day.
- Renamed user-facing active branch wording to tree path.
- Added a `Daily high` line to `/tally`.
- Documented local-day footer behavior and product decisions.
- Made the Pi package manifest point explicitly at the tally extension entry file.
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
