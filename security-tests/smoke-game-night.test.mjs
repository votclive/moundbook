// Game-night smoke test: "a stat keeper can start a game, log stats, and the public live page updates".
// Local Firestore emulator only (fake project "demo-moundbook"), against the repo's real rules (../hoops/firestore.rules).
// It uses the same document shapes the app writes (hoops/index.html: game save, pubSend, bugSend, seasonRow, public reader).
// The fan side is a REAL onSnapshot listener, the way the public page listens, and each update must actually arrive.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const rules = readFileSync(here("../hoops/firestore.rules"), "utf8");
const fbCfg = JSON.parse(readFileSync(here("./firebase.json"), "utf8")).emulators.firestore;
const [HOST, PORT] = process.env.FIRESTORE_EMULATOR_HOST ? process.env.FIRESTORE_EMULATOR_HOST.split(":") : [fbCfg.host, String(fbCfg.port)];

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: "demo-moundbook", firestore: { rules, host: HOST, port: Number(PORT) } }); await env.clearFirestore(); });
after(async () => { if (env) await env.cleanup(); });

const ctx = k => env.authenticatedContext("uid_" + k, { email: k + "@example.com", email_verified: true }).firestore();

// A fan's live listener. next(pred) waits (with a timeout) for a snapshot that satisfies pred; errors fail the wait.
function fanListen(db, path) {
  const seen = []; let waiter = null, error = null;
  const un = onSnapshot(doc(db, ...path.split("/")), snap => {
    const data = snap.exists() ? snap.data() : null; seen.push(data);
    if (waiter && waiter.pred(data)) { clearTimeout(waiter.t); const w = waiter; waiter = null; w.res(data); }
  }, e => { error = e; if (waiter) { clearTimeout(waiter.t); const w = waiter; waiter = null; w.rej(e); } });
  return {
    path, stop: un,
    next(pred, label, ms = 8000) {
      if (error) return Promise.reject(error);
      const have = seen.find(pred); if (have !== undefined && have !== null) { seen.length = 0; return Promise.resolve(have); }
      return new Promise((res, rej) => { waiter = { pred, res, rej, t: setTimeout(() => { waiter = null; rej(new Error("fan never received: " + label + " (" + path + ")")); }, ms) }; });
    },
  };
}

const GID = "2026-12-04-boys";
const DEV_A = "devA", DEV_B = "devB";
const game = (o = {}) => ({ id: GID, date: "2026-12-04", team: "boys", opp: "Rival", ha: "Home", status: "live", rev: 0, upd: 1, writer: DEV_A, writerAt: 1, takeover: null, deleted: false, ev: [], ...o });
// what pubSend writes: {j: JSON of the public snapshot, upd, w: the game's scorer device}
const pubCopy = (us, them, status, upd, w) => ({ j: JSON.stringify({ v: 1, id: GID, status, q: 1, sc: { us, them }, plays: [], upd }), upd, w });
const score = d => JSON.parse(d.j).sc;

test("GAME NIGHT: a stat keeper starts a game, logs stats, and the public live page updates", async () => {
  // Setup the owner would have done before game night: people let in, season list on.
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    for (const [k, v] of Object.entries({ scorer: { role: "scorer", tier: "" }, coach: { role: "scorer", tier: "coach" }, admin: { role: "scorer", tier: "admin" }, board: { role: "scorer", tier: "board" }, viewer: { role: "viewer", tier: "" } }))
      await setDoc(doc(db, "hoopsMembers", "uid_" + k), { ...v, email: k + "@example.com", name: k, at: 1 });
    await setDoc(doc(db, "hoopsPublic", "_season"), { games: { [GID]: { status: "pre", team: "boys", opp: "Rival" } }, off: false, upd: 1 });
  });
  const sc = ctx("scorer"), co = ctx("coach"), bd = ctx("board"), vw = ctx("viewer"), fan = env.unauthenticatedContext().firestore();

  // 1. The fan opens the public page: real listeners on the season list, the game's public copy and the scoreboard feed.
  const season = fanListen(fan, "hoopsPublic/_season"), pub = fanListen(fan, "hoopsPublic/" + GID), board = fanListen(fan, "hoopsPublic/_board");
  try {
    await season.next(d => d && d.games && d.games[GID], "initial season list");

    // 2. The scorer creates the game, then claims it (first write names the scoring device as writer).
    await assertSucceeds(setDoc(doc(sc, "hoopsGames", GID), game({ status: "pre", writer: null })));
    await assertSucceeds(setDoc(doc(sc, "hoopsGames", GID), game({ status: "live", rev: 1 })));

    // 3. Tip-off: the scorer publishes the season row and the game's public copy. The fan's listeners receive both.
    await assertSucceeds(setDoc(doc(sc, "hoopsPublic", GID), pubCopy(0, 0, "live", 2, DEV_A)));
    await assertSucceeds(setDoc(doc(sc, "hoopsPublic", "_season"), { games: { [GID]: { status: "live", us: 0, them: 0, team: "boys", opp: "Rival" } }, upd: 2 }, { merge: true }));
    let d = await pub.next(x => x && x.upd === 2, "tip-off copy"); assert.deepEqual(score(d), { us: 0, them: 0 });
    d = await season.next(x => x.games[GID].status === "live", "season row goes live"); assert.equal(d.games[GID].us, 0);

    // 4. The scorer logs plays (rev goes up each time) and re-publishes; every score reaches the fan.
    const plays = [[2, 0], [2, 3], [5, 3], [5, 5], [8, 5]];
    let rev = 1, upd = 2;
    for (const [us, them] of plays) {
      rev++; upd++;
      await assertSucceeds(setDoc(doc(sc, "hoopsGames", GID), game({ rev, upd, ev: Array.from({ length: rev }, (_, i) => ({ id: "e" + i })) })));
      await assertSucceeds(setDoc(doc(sc, "hoopsPublic", GID), pubCopy(us, them, "live", upd, DEV_A)));
      d = await pub.next(x => x && x.upd === upd, "score " + us + "-" + them);
      assert.deepEqual(score(d), { us, them }, "fan sees the new score");
    }
    await assertSucceeds(setDoc(doc(sc, "hoopsPublic", "_season"), { games: { [GID]: { status: "live", us: 8, them: 5 } }, upd: upd + 1 }, { merge: true }));
    d = await season.next(x => x.games[GID].us === 8, "season row at 8-5"); assert.equal(d.games[GID].them, 5);

    // 5. The scoreboard relay (board tier) writes the board feed; the fan receives it.
    await assertSucceeds(setDoc(doc(bd, "hoopsPublic", "_board"), { v: 1, home: 8, vis: 5, hf: 1, vf: 2, q: 1, run: true, cs: 412.5, ct: Date.now(), sent: Date.now(), n: 1, src: "mp80", stale: false }));
    d = await board.next(x => x && x.home === 8, "board feed"); assert.equal(d.vis, 5);
    await assertSucceeds(setDoc(doc(bd, "hoopsPublic", "_boardHb"), { v: 1, n: 2, sent: Date.now() }));
    await assertSucceeds(setDoc(doc(bd, "hoopsPublic", "_board"), { v: 1, home: 10, vis: 5, q: 1, run: true, cs: 380, ct: Date.now(), sent: Date.now(), n: 3 }));
    await board.next(x => x && x.home === 10, "board feed update");

    // 6. A coach publishes the players' photos and the schools' logos; the scorer writes the stream bug and season stats.
    await assertSucceeds(setDoc(doc(co, "hoopsPublic", "_faces"), { v: 1, f: { p1: { d: "data:image/jpeg;base64,AA", at: 1 } }, upd: upd + 2 }));
    await assertSucceeds(setDoc(doc(co, "hoopsPublic", "_logos"), { v: 1, l: { k: "data:x" }, upd: upd + 2 }));
    await assertSucceeds(setDoc(doc(sc, "hoopsPublic", "_bug"), { j: JSON.stringify({ v: 1, id: GID, status: "live", upd }), upd, w: DEV_A }));
    await assertSucceeds(setDoc(doc(sc, "hoopsPublic", "_stats"), { j: JSON.stringify({ t: {} }), upd }));
    for (const x of ["_faces", "_logos", "_bug", "_stats"]) await assertSucceeds(getDoc(doc(fan, "hoopsPublic", x)));

    // 7. The scorer's device dies. A coach takes over (names themself in takeover), publishes as the new device, finalizes.
    rev++; upd++;
    await assertSucceeds(setDoc(doc(co, "hoopsGames", GID), game({ rev, upd, writer: DEV_B, takeover: "uid_coach" })));
    await assertSucceeds(setDoc(doc(co, "hoopsPublic", GID), pubCopy(8, 5, "live", upd, DEV_B)));
    await assertFails(setDoc(doc(sc, "hoopsPublic", GID), pubCopy(0, 99, "live", upd + 1, DEV_A)));   // the old device's queued copy is refused
    rev++; upd++;
    await assertSucceeds(setDoc(doc(co, "hoopsGames", GID), game({ rev, upd, writer: DEV_B, status: "final" })));
    await assertSucceeds(setDoc(doc(co, "hoopsPublic", GID), pubCopy(52, 47, "final", upd, DEV_B)));
    await assertSucceeds(setDoc(doc(co, "hoopsPublic", "_season"), { games: { [GID]: { status: "final", us: 52, them: 47 } }, upd: upd + 1 }, { merge: true }));
    d = await pub.next(x => x && JSON.parse(x.j).status === "final", "final copy"); assert.deepEqual(score(d), { us: 52, them: 47 });
    d = await season.next(x => x.games[GID].status === "final", "season row final"); assert.equal(d.games[GID].us, 52);

    // 8. A signed-in viewer reads the final game; the fan can read the final public copy afresh.
    const fin = await assertSucceeds(getDoc(doc(vw, "hoopsGames", GID)));
    assert.equal(fin.data().status, "final"); assert.equal(fin.data().rev, rev);
    await assertSucceeds(getDoc(doc(fan, "hoopsPublic", GID)));
  } finally { season.stop(); pub.stop(); board.stop(); }
});
