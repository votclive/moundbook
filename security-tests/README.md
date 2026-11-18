# Security tests for Mound Book and Brier Stats

This folder holds automatic checks. They exist so that a change to the app or to the database rules can't quietly reopen a hole that was already closed, or break something people use on game night.

## Running them

You need Node 20 or newer and Java 11 or newer on the computer (the Java is for the Firebase emulator).

    cd security-tests
    npm install
    npm test

`npm test` runs three things: the database-rules tests plus the game-night smoke test (a stat keeper starts a game, logs stats, and a fan's live page receives every update), the Brier Stats app tests, and the two Python checks. Every line should say ok. Any "not ok" means something is wrong: don't merge.

## It cannot touch the real project

The tests only talk to a fake database that the test starts on your own computer (the "emulator"), under the made-up project name `demo-moundbook`. They hold no passwords or keys and never connect to the real Firebase project. Running them as often as you like costs nothing and changes nothing online.

## The GitHub check

Every pull request, and every push to `main`, runs two quick checks on GitHub (the file `.github/workflows/security-checks.yml`):

1. The Brier Stats "stamp" is current (`python3 hoops/stamp.py hoops --check`).
2. The two copies of the database rules inside the apps match `hoops/firestore.rules` (`python3 security-tests/check_rules_copies.py`).

A red check on a pull request means DO NOT MERGE. A stale stamp blanks the Brier Stats app on every device.

## Safe release steps

Brier Stats (hoops):

1. Make the edit.
2. Run `python3 hoops/stamp.py hoops`.
3. Run `python3 hoops/stamp.py hoops --check`. It must say "stamps are current".
4. Merge on a non-game day. Never merge from 2 hours before tip-off until the final horn.
5. Wait 15 minutes.
6. Open the app twice, with signal, on every device, until Setup > About shows the new version.
7. ONLY THEN, if the rules changed, paste the new rules into the Firebase console.

Mound Book (the baseball app):

1. Bump `MB_VERSION` in `index.html` and the `CACHE` name in `sw.js`.
2. Push.
3. Wait 10 minutes or more.
4. Open the app twice, with signal, on each device.
