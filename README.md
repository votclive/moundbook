# Mound Book

Pitch charting, scouting reports and pitch counts for a high school baseball program.

Open it at **https://votclive.github.io/moundbook/** and add it to the Home Screen (Safari: Share › Add to Home Screen). It works with no signal once it has opened once.

Live sync between the dugout device and the coaches' phones runs on the team's own Firebase project; the app's Data tab walks through setting it up.

This folder is the built app (one `index.html` plus the offline worker, icons and fonts). It is published by GitHub Pages from the `main` branch.

## Brier Stats (basketball)

The basketball scorebook lives in `hoops/` and opens at **https://votclive.github.io/moundbook/hoops/** (add it to the Home Screen the same way). One scorer enters the game, and `?announcer` opens the announcer page on its own. People get in as one of four groups: Admins run everything (Mound Book's owner and admins are Admins here too), Coaches handle rosters, the schedule and letting people in, Scorers start, score and end games, and Viewers watch live. It uses the same Firebase project and sign-in as Mound Book but keeps its own list of people. Its Firestore rules are folded into Mound Book's, so publishing the rules from either app covers both.
