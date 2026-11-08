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

## A game's `j`

- `id, date, time, team, usName, opp, oi {mascot, girls, c1, c2, abbr}, ha, district, event, quarters`
- `status` (live/final), `q` (period), `brk` (true at a break), `sc {us, them}` (the public score: the board's final while under review, the official one after), `qs {us:[per period], them:[...]}`
- `tf`, `bonus`, `tol {us:{60, 30}, them}`, `poss`
- `box {us, them}`: one row per player who played: `[num, name, "", "", "", pts, fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, ast, stl, blk, to, pf, played, onFloor, pointsOnly, techs]`. A player kept off the public page has an empty name.
- `tt {us:[oreb, dreb, to], them}`: team rebounds and turnovers
- `plays`: the last 40 (all of them at the final): `[period, us, them, text, scored, team, timeOfDay ms, gameClock, boxRow]` (`boxRow` -1 for a team play)
- `sh`: charted shots `[team, boxRow, x, y, made, period, points]`, x and y in thousandths of the half court (x across, 0 to 1000; y from the baseline, 0 to 1000 = half court)
- `fw`: the flow, one per scoring play: `[period, clockLeft (-1 if none), us, them]`
- `ql [period seconds, OT seconds]`, `fl` (lead changes, ties, biggest leads, current run), `x` (bench, 2nd-chance, off-TO, paint points), `brd` (1 board live, 2 lost), `rv`, `sponsor`, `every`, `upd`
