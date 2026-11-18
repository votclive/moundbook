# Brier Stats public feed

Everything the fan page, the score bug and any other app (the VOTC gameday app, say) can read with no sign-in. It all lives in the `moundbook-ghs` Firestore, collection `hoopsPublic`. Read only. New fields get added over time; existing ones keep their names and meaning.

Each write costs one read for every listener, so listen to one game doc at a time and use a one-time read for `_stats`.

| Doc | What it holds | Written |
|---|---|---|
| `_season` | `{games:{<gid>: row}, off, upd}`. One row per game: `date, time, team ("boys"/"girls"), usName, opp, ha (Home/Away/Neutral), district, event, status (pre/live/final), us, them, per ("Q3 4:12", "HALF", "Final"), off (ppd/cxl), ff (W/L forfeit), rv ("review" while the final is being checked), rec (record going in), lm (last meeting), upd` | at tip-off, each period break, the final, and fixes |
| `<gid>` | `{j, upd, w}`. `j` is a JSON string, the game (below) | about every 30 s while live (Admin setting), right away at breaks and the final |
| `_bug` | the score bug's copy: teams, `sc`, `q`, `brk`, `tf`, `bonus`, `tol`, `status`, `brd` | every score, period, foul or timeout change |
| `_board` | the gym scoreboard from the relay: `home, vis, hf, vf, q, run, cs` (clock seconds at `ct`), `ct, sent, stale, n, src, at, bye` | each board change (at most once a second), starts and stops right away |
| `_stats` | `{j, upd}`. `j`: `{v, t:{boys|girls:{name, gp, p:[[pid, num, name, games, pts, reb, ast, stl, blk, to, pf, fgm, fga, tpm, tpa, ftm, fta]]}}}`, season totals from finals (shooting only from games where misses were kept) | when a final's results row goes out |
| `_faces` | `{v, f:{<pid>: "data:image/jpeg;base64,…"}, upd}` (0.17.0). Player photos, 128 by 128 JPEG, keyed by the season player id (a game's `pk` list, a `_stats` row's first item). Only kids on Rosters, never one marked number only, and the doc is deleted while the fan page is off. Read it once a visit, not with a listener. Use a value only if it starts `data:image/jpeg;base64,` and is under 24,000 characters; put it in an image's `src` or a CSS `url()`, never into markup. |

## A game's `j`

- `id, date, time, team, usName, opp, oi {mascot, girls, c1, c2, abbr}, ha, district, event, quarters`
- `status` (live/final), `q` (period), `brk` (true at a break), `sc {us, them}` (the public score: the board's final while under review, the official one after), `qs {us:[per period], them:[...]}`
- `tf`, `bonus`, `tol {us:{60, 30}, them}`, `poss`
- `box {us, them}`: one row per player who played: `[num, name, "", "", "", pts, fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, ast, stl, blk, to, pf, played, onFloor, pointsOnly, techs]`. A player kept off the public page has an empty name.
- `tt {us:[oreb, dreb, to, fgm, fga, tpm, tpa, ftm, fta, pts], them}`: the team line (plays nobody named). Rebounds and turnovers include the ones the book fills in (NFHS: every miss gets a rebound, every steal is a turnover); `pts` is a defender's tip-in into their own basket, credited to the team. Before 0.24.0 only the first three were sent, so read the rest as 0 when missing
- `plays`: the last 40 (all of them at the final): `[period, us, them, text, scored, team, timeOfDay ms, gameClock, boxRow]` (`boxRow` -1 for a team play)
- `sh`: charted shots `[team, boxRow, x, y, made, period, points, clock]`, x and y in thousandths of the half court (x across, 0 to 1000; y from the baseline, 0 to 1000 = half court); clock is the game clock when it was taken as the board shows it ("5:49", "0:45.3"), or "" without one (added in 0.13.0, so older copies have 7 entries)
- `fw`: the flow, one per scoring play: `[period, clockLeft (-1 if none), us, them]`
- `ql [period seconds, OT seconds]`, `fl` (lead changes, ties, biggest leads, current run), `x` (bench, 2nd-chance, off-TO, paint points), `brd` (1 board live, 2 lost), `rv`, `sponsor`, `every`, `upd`

## Reading it safely (0.16.3)

Any scorer's sign-in can write these documents (the scoreboard's `_board` and `_boardHb` only the scoreboard relay's sign-in or an Admin's), so a reader should treat every value as somebody else's writing:

- A play's `text` is already HTML-escaped text (an apostrophe arrives as `&#39;`). Decode it and show it as text, or strip anything that looks like a tag before putting it in a page. Never put it into a page as HTML as it comes.
- Names (`opp`, `usName`, `event`, `sponsor`, the box rows' names) are plain text: escape them when they go into HTML.
- Numbers are meant to be numbers: check they are (`Number.isFinite`) before printing or doing arithmetic.
- Brier Stats' own fan page and score bug do this on the way in (`pubSafe` in `index.html`): an angle bracket in any text becomes a look-alike (‹ ›), so nothing in a copy can turn into a tag.
