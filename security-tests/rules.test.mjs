// Brier Stats / Mound Book Firestore rules: the security suite.
// Runs ONLY against the local Firestore emulator with the fake project id "demo-moundbook".
// It always loads the repo's real rules file (../hoops/firestore.rules).
// Run: npm run test:rules   (starts the emulator, runs this and the smoke test, stops the emulator)
import { test, describe, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, onSnapshot } from "firebase/firestore";

const here = p => fileURLToPath(new URL(p, import.meta.url));
const rules = readFileSync(here("../hoops/firestore.rules"), "utf8");
const fbCfg = JSON.parse(readFileSync(here("./firebase.json"), "utf8")).emulators.firestore;
const [HOST, PORT] = process.env.FIRESTORE_EMULATOR_HOST ? process.env.FIRESTORE_EMULATOR_HOST.split(":") : [fbCfg.host, String(fbCfg.port)];
const PROJECT = "demo-moundbook";   // fake id on purpose: this can never reach the real project
const OWNER_EMAIL = rules.match(/email\.lower\(\) == '([^']+)'/)[1];   // read from the rules, never printed
const NOW = Date.now(), DAY = 86400000;

// "hole is closed": the attack must now be refused. "normal use still works": the everyday action must succeed.
const closed = p => assertFails(p);
const works = p => assertSucceeds(p);

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules, host: HOST, port: Number(PORT) } }); });
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// ---- helpers (document shapes copied from the app) ----
const U = {
  scorer: { role: "scorer", tier: "" }, coach: { role: "scorer", tier: "coach" }, admin: { role: "scorer", tier: "admin" },
  board: { role: "scorer", tier: "board" }, viewer: { role: "viewer", tier: "" },
};
const ctx = k => env.authenticatedContext("uid_" + k, { email: k + "@example.com", email_verified: true }).firestore();
const ctxAs = (uid, email, verified = false) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const GID = "2026-12-04-boys";
const game = (o = {}) => ({ id: GID, date: "2026-12-04", team: "boys", opp: "Rival", ha: "Home", status: "live", rev: 5, upd: 1, writer: "devA", takeover: null, deleted: false, ev: [], ...o });

async function seed(extra) {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    for (const [k, v] of Object.entries(U)) await setDoc(doc(db, "hoopsMembers", "uid_" + k), { ...v, email: k + "@example.com", name: k, at: 1 });
    if (extra) await extra(db);
  });
}
const seedGame = (o, season = { games: {}, upd: 1 }) => seed(async db => {
  await setDoc(doc(db, "hoopsGames", GID), game(o));
  await setDoc(doc(db, "hoopsPublic", GID), { j: "{}", upd: 1, w: "devA" });
  if (season) await setDoc(doc(db, "hoopsPublic", "_season"), season);
  for (const d of ["_faces", "_logos", "_stats", "_bug", "_board", "_boardHb"]) await setDoc(doc(db, "hoopsPublic", d), { v: 1, upd: 1 });
});
// Production-like state: owner claimed, a baseball admin and coach, Brier coach/admin/scorer/viewer/board.
async function seedProd(extra) {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, "config/owner"), { uid: "kevin", email: OWNER_EMAIL, at: NOW - 100 * DAY });
    await setDoc(doc(db, "members/kevin"), { role: "owner", email: OWNER_EMAIL, name: "K", at: NOW - 100 * DAY });
    await setDoc(doc(db, "members/mbadmin"), { role: "admin", email: "adm@x.com", name: "A", at: NOW });
    await setDoc(doc(db, "members/mbcoach"), { role: "coach", email: "c@x.com", name: "C", at: NOW });
    await setDoc(doc(db, "config/book"), { pitch: 1 });
    await setDoc(doc(db, "hoopsMembers/hcoach"), { role: "scorer", tier: "coach", email: "hc@x.com", name: "HC", at: NOW });
    await setDoc(doc(db, "hoopsMembers/hadmin"), { role: "scorer", tier: "admin", email: "ha@x.com", name: "HA", at: NOW });
    await setDoc(doc(db, "hoopsMembers/scorer"), { role: "scorer", tier: "", email: "s@x.com", name: "S", at: NOW });
    await setDoc(doc(db, "hoopsMembers/viewer"), { role: "viewer", tier: "", email: "v@x.com", name: "V", at: NOW });
    await setDoc(doc(db, "hoopsMembers/board"), { role: "scorer", tier: "board", email: "b@x.com", name: "B", at: NOW });
    await setDoc(doc(db, "hoopsBook/teams"), { teams: [], settings: { drive: "", pub: true, pubSec: 30 } });
    await setDoc(doc(db, "hoopsGames/2026-12-04-ghs"), { id: "2026-12-04-ghs", rev: 5, deleted: false, writer: "scorer" });
    await setDoc(doc(db, "hoopsPublic/_season"), { off: false, games: [] });
    await setDoc(doc(db, "hoopsPublic/2026-12-04-ghs"), { w: "scorer", h: 10, v: 8 });
    await setDoc(doc(db, "games/g1"), { id: "g1", rev: 1, deleted: false, writerDev: "d1" });
    if (extra) await extra(db);
  });
}
const claimBatch = (db, uid, email) => { const b = writeBatch(db);
  b.set(doc(db, "members", uid), { role: "owner", email, name: "", at: NOW });
  b.set(doc(db, "config/owner"), { uid, email, at: NOW }); return b.commit(); };
const CODE = "abcdefghijklmnopqrstuvwx";
const inv = (o = {}) => ({ email: "victim@x.com", name: "Vic", role: "scorer", tier: "coach", by: "hcoach", at: NOW, ...o });
const joinDoc = (email, o = {}) => ({ role: "scorer", tier: "coach", email, name: "x", at: NOW, inv: CODE, ...o });

// ======================= #1 scoreboard feed =======================
describe("#1 Scoreboard feed: only the scoreboard relay or an Admin writes it", () => {
  test("hole is closed: a plain scorer cannot write _board or _boardHb", async () => {
    await seedGame();
    const db = ctx("scorer");
    await closed(setDoc(doc(db, "hoopsPublic", "_board"), { v: 1, home: 999, vis: 0, cs: 1, ct: "x", n: 1, sent: 1, q: 1, run: false }));
    await closed(setDoc(doc(db, "hoopsPublic", "_boardHb"), { v: 1, n: 1, sent: 1 }));
  });
  test("hole is closed: a coach cannot write _board", async () => {
    await seedGame();
    await closed(setDoc(doc(ctx("coach"), "hoopsPublic", "_board"), { v: 1, home: 5 }));
  });
  test("hole is closed: a scorer cannot delete _board", async () => {
    await seedGame();
    await closed(deleteDoc(doc(ctx("scorer"), "hoopsPublic", "_board")));
  });
  test("normal use still works: the board tier writes _board and _boardHb (create and update, any fields)", async () => {
    await seed();
    const db = ctx("board");
    await works(setDoc(doc(db, "hoopsPublic", "_board"), { v: 1, home: 2, vis: 0, cs: 480, ct: Date.now(), n: 1, sent: Date.now(), anyNewField: { x: 1 } }));
    await works(setDoc(doc(db, "hoopsPublic", "_board"), { v: 1, home: 4 }, { merge: true }));
    await works(setDoc(doc(db, "hoopsPublic", "_boardHb"), { v: 1, n: 2, sent: Date.now() }));
  });
  test("normal use still works: the board tier still cannot delete the feed documents (unchanged)", async () => {
    await seedGame();
    const db = ctx("board");
    await closed(deleteDoc(doc(db, "hoopsPublic", "_board")));
    await closed(deleteDoc(doc(db, "hoopsPublic", "_boardHb")));
  });
  test("normal use still works: an Admin may still write _board", async () => {
    await seed();
    await works(setDoc(doc(ctx("admin"), "hoopsPublic", "_board"), { v: 1 }));
  });
  test("normal use still works: the board tier can do nothing else (no games, other public docs, booth, book, member list)", async () => {
    await seedGame();
    const db = ctx("board");
    for (const d of ["_season", "_bug", "_stats", "_faces", "_logos", GID, "newid"]) await closed(setDoc(doc(db, "hoopsPublic", d), { v: 1, w: "devA" }));
    await closed(setDoc(doc(db, "hoopsGames", "g2"), game({ id: "g2" })));
    await closed(getDoc(doc(db, "hoopsGames", GID)));
    await closed(getDoc(doc(db, "hoopsBook", "teams")));
    await closed(setDoc(doc(db, "hoopsBooth", "x"), { a: 1 }));
    await closed(getDocs(collection(db, "hoopsMembers")));
    await closed(setDoc(doc(db, "hoopsMembers", "uid_board"), { role: "scorer", tier: "admin", email: "board@example.com" }));
    await works(getDoc(doc(db, "hoopsMembers", "uid_board")));   // reads its own row
  });
  test("normal use still works: the board account reads the always-open public docs", async () => {
    await seedGame({}, { games: {}, off: true });
    const db = ctx("board");
    for (const d of ["_season", "_board", "_boardHb", "_bug"]) await works(getDoc(doc(db, "hoopsPublic", d)));
  });
});

// ======================= #2 public photos and logos =======================
describe("#2 Public photos and logos: only coaches and admins write or delete them", () => {
  test("hole is closed: a scorer cannot write or delete _faces / _logos", async () => {
    await seedGame();
    const db = ctx("scorer");
    await closed(setDoc(doc(db, "hoopsPublic", "_faces"), { v: 1, f: { p1: "data:image/jpeg;base64,AAAA", evil: "x".repeat(500000) }, upd: 1 }));
    await closed(setDoc(doc(db, "hoopsPublic", "_logos"), { v: 1, l: { k: "junk" } }));
    await closed(deleteDoc(doc(db, "hoopsPublic", "_faces")));
    await closed(deleteDoc(doc(db, "hoopsPublic", "_logos")));
  });
  test("normal use still works: viewer, board tier and anonymous still cannot write _faces or _logos (unchanged)", async () => {
    await seedGame();
    for (const db of [ctx("viewer"), ctx("board"), ctx("stranger"), anon()]) for (const d of ["_faces", "_logos"]) await closed(setDoc(doc(db, "hoopsPublic", d), { v: 1 }));
  });
  test("normal use still works: a coach and an admin publish and delete _faces and _logos", async () => {
    await seed();
    for (const k of ["coach", "admin"]) {
      const db = ctx(k);
      await works(setDoc(doc(db, "hoopsPublic", "_faces"), { v: 1, f: { p1: "data:image/jpeg;base64,AA" }, upd: 1 }));
      await works(setDoc(doc(db, "hoopsPublic", "_logos"), { v: 1, l: { k: "data:x" } }));
      await works(deleteDoc(doc(db, "hoopsPublic", "_faces")));
      await works(deleteDoc(doc(db, "hoopsPublic", "_logos")));
    }
  });
  test("normal use still works: a scorer's other public writes (game copy with the right writer, _season rows, _bug, _stats)", async () => {
    await seedGame();
    const db = ctx("scorer");
    await closed(setDoc(doc(db, "hoopsPublic", GID), { j: "{}", w: "attackerDev" }));   // wrong writer refused
    const w = (await getDoc(doc(ctx("viewer"), "hoopsGames", GID))).data().writer;
    await works(setDoc(doc(db, "hoopsPublic", GID), { j: "{\"sc\":{\"us\":0,\"them\":99}}", w }));
    await works(setDoc(doc(db, "hoopsPublic", "_season"), { games: { x: { a: 1 } } }, { merge: true }));
    await closed(setDoc(doc(db, "hoopsPublic", "_season"), { off: true }, { merge: true }));   // the fan page switch stays an Admin's
    await works(setDoc(doc(ctx("admin"), "hoopsPublic", "_season"), { off: true }, { merge: true }));
    await works(setDoc(doc(db, "hoopsPublic", "_stats"), { j: "{}" }));
    await works(setDoc(doc(db, "hoopsPublic", "_bug"), { j: "{}", w: "whatever" }));
  });
});

// ======================= #3 listing the public collection =======================
describe("#3 Listing hoopsPublic: only people let in can list it", () => {
  test("hole is closed: an anonymous visitor cannot list hoopsPublic (fan page on)", async () => {
    await seedGame({}, { games: {}, off: false });
    await closed(getDocs(collection(anon(), "hoopsPublic")));
  });
  test("hole is closed: an anonymous visitor cannot list when there is no _season doc at all", async () => {
    await seedGame({}, null);
    await closed(getDocs(collection(anon(), "hoopsPublic")));
  });
  test("normal use still works: anonymous list stays refused with the fan page off, plain or filtered", async () => {
    await seedGame({}, { games: {}, off: true });
    await closed(getDocs(collection(anon(), "hoopsPublic")));
    await closed(getDocs(query(collection(anon(), "hoopsPublic"), where("upd", ">", 0))));
  });
  test("hole is closed: a signed-in stranger (not let in) cannot list either", async () => {
    await seedGame({}, { games: {}, off: false });
    await closed(getDocs(collection(ctx("stranger"), "hoopsPublic")));
  });
  test("normal use still works: anonymous get of each public doc with the fan page on", async () => {
    await seedGame({}, { games: {}, off: false });
    for (const d of ["_season", "_board", "_boardHb", "_bug", "_stats", "_faces", "_logos", GID]) await works(getDoc(doc(anon(), "hoopsPublic", d)));
  });
  test("normal use still works: anonymous get with the fan page off (open docs yes, the rest no)", async () => {
    await seedGame({}, { games: {}, off: true });
    for (const d of ["_season", "_board", "_boardHb", "_bug"]) await works(getDoc(doc(anon(), "hoopsPublic", d)));
    for (const d of ["_stats", "_faces", GID]) await closed(getDoc(doc(anon(), "hoopsPublic", d)));
  });
  test("normal use still works: an anonymous live listener on _season, a game copy and _board", async () => {
    await seedGame({}, { games: {}, off: false });
    for (const d of ["_season", GID, "_board"]) {
      const ok = await new Promise(res => { const un = onSnapshot(doc(anon(), "hoopsPublic", d), s => { un(); res(s.exists()); }, e => res("ERR " + e.code)); });
      if (ok !== true) throw new Error(d + " snapshot: " + ok);
    }
  });
  test("normal use still works: a signed-in viewer can list (fan page on or off)", async () => {
    for (const off of [false, true]) {
      await env.clearFirestore();
      await seedGame({}, { games: {}, off });
      await works(getDocs(collection(ctx("viewer"), "hoopsPublic")));
    }
  });
});

// ======================= #20 invite time =======================
describe("#20 Invite time: an invite cannot be dated in the far future", () => {
  test("hole is closed: a coach cannot create an invite dated 10 years ahead (it would never expire)", async () => {
    await seedProd();
    await closed(setDoc(doc(ctxAs("hcoach", "hc@x.com"), "hoopsInvites/futurefuturefuturefuture"), inv({ at: NOW + 3650 * DAY })));
  });
  test("normal use still works: invite dated now, and from a phone whose clock is 2 hours fast; the invitee joins", async () => {
    await seedProd();
    const c = ctxAs("hcoach", "hc@x.com");
    await works(setDoc(doc(c, "hoopsInvites/" + CODE), inv()));
    await works(setDoc(doc(c, "hoopsInvites/fastfastfastfastfastfast"), inv({ at: NOW + 2 * 3600000 })));
    await works(getDocs(collection(c, "hoopsInvites")));
    const v = ctxAs("vic", "victim@x.com", false);
    await works(setDoc(doc(v, "hoopsMembers/vic"), joinDoc("victim@x.com")));
    await works(deleteDoc(doc(v, "hoopsInvites/" + CODE)));
  });
  test("normal use still works: invite limits unchanged (short code, coach inviting an admin, wrong email, wrong level, >14 days old, listing)", async () => {
    await seedProd(async db => {
      await setDoc(doc(db, "hoopsInvites/" + CODE), inv());
      await setDoc(doc(db, "hoopsInvites/oldoldoldoldoldoldoldold"), inv({ at: NOW - 15 * DAY }));
    });
    const c = ctxAs("hcoach", "hc@x.com");
    await closed(setDoc(doc(c, "hoopsInvites/shortcode"), inv()));
    await closed(setDoc(doc(c, "hoopsInvites/coachmakesadminaaaaaaaaa"), inv({ tier: "admin" })));
    const w = ctxAs("thief", "other@x.com");
    await closed(getDoc(doc(w, "hoopsInvites/" + CODE)));
    await closed(setDoc(doc(w, "hoopsMembers/thief"), joinDoc("other@x.com")));
    const t = ctxAs("thief", "victim@x.com");
    await closed(setDoc(doc(t, "hoopsMembers/thief"), joinDoc("victim@x.com", { tier: "admin" })));
    await closed(setDoc(doc(t, "hoopsMembers/thief"), joinDoc("victim@x.com", { inv: "oldoldoldoldoldoldoldold" })));
    await closed(getDocs(collection(t, "hoopsInvites")));
    // an existing member cannot upgrade through an invite
    const s = ctxAs("scorer", "s@x.com");
    await env.withSecurityRulesDisabled(async cx => setDoc(doc(cx.firestore(), "hoopsInvites/" + CODE), inv({ email: "s@x.com" })));
    await closed(updateDoc(doc(s, "hoopsMembers/scorer"), { tier: "coach", inv: CODE }));
  });
});

// ======================= #21 owner record =======================
describe("#21 Owner record: only Mound Book members read config/owner", () => {
  test("hole is closed: a stranger who signed up cannot read config/owner (uid and email)", async () => {
    await seedProd();
    await closed(getDoc(doc(ctxAs("stranger", "st@x.com"), "config/owner")));
    await closed(getDoc(doc(anon(), "config/owner")));
  });
  test("hole is closed: a Brier-only member (no Mound Book membership) cannot read config/owner", async () => {
    await seedProd();
    await closed(getDoc(doc(ctxAs("hcoach", "hc@x.com"), "config/owner")));
  });
  test("normal use still works: Mound Book members (coach, admin, owner) read config/owner", async () => {
    await seedProd();
    await works(getDoc(doc(ctxAs("mbcoach", "c@x.com"), "config/owner")));
    await works(getDoc(doc(ctxAs("mbadmin", "adm@x.com"), "config/owner")));
    await works(getDoc(doc(ctxAs("kevin", OWNER_EMAIL, false), "config/owner")));
  });
});

// ======================= stranger sweep =======================
describe("A stranger who signs up gets nothing", () => {
  test("a stranger may only file a request for themself: own doc, allowed fields, size-capped, own email", async () => {
    await seedProd();
    const s = ctxAs("stranger", "St@X.com");
    for (const c of ["requests", "hoopsRequests"]) {
      await works(setDoc(doc(s, c, "stranger"), { email: "st@x.com", name: "A".repeat(200), at: NOW }));
      await works(getDoc(doc(s, c, "stranger")));
      await closed(setDoc(doc(s, c, "stranger"), { email: "st@x.com", name: "A".repeat(201), at: NOW }));
      await closed(setDoc(doc(s, c, "stranger"), { email: OWNER_EMAIL, name: "x", at: NOW }));
      await closed(setDoc(doc(s, c, "stranger"), { email: "st@x.com", name: "x", at: NOW, role: "admin" }));
      await closed(setDoc(doc(s, c, "stranger"), { email: "st@x.com", name: "x", at: "now" }));
      await closed(setDoc(doc(s, c, "stranger"), { email: "st@x.com", name: 5, at: NOW }));
      await closed(setDoc(doc(s, c, "other"), { email: "st@x.com", name: "x", at: NOW }));
      await closed(getDocs(collection(s, c)));
      await works(deleteDoc(doc(s, c, "stranger")));
    }
    await closed(setDoc(doc(anon(), "requests/x"), { email: "a@x.com", name: "", at: NOW }));   // anonymous cannot file one
  });
  test("a stranger cannot write anything else", async () => {
    await seedProd();
    const s = ctxAs("stranger", "st@x.com");
    const writes = [
      ["members/stranger", { role: "coach" }], ["members/stranger", { role: "owner" }],
      ["hoopsMembers/stranger", { role: "viewer", tier: "", email: "st@x.com", name: "", at: NOW }],
      ["hoopsMembers/stranger", { role: "scorer", tier: "board", email: "st@x.com", name: "", at: NOW }],
      ["hoopsInvites/aaaaaaaaaaaaaaaaaaaaaaaa", { email: "st@x.com", name: "", role: "viewer", tier: "", by: "stranger", at: NOW }],
      ["hoopsGames/2026-12-05-x", { id: "2026-12-05-x", rev: 1, deleted: false, writer: "stranger" }],
      ["hoopsBook/teams", { teams: [] }], ["hoopsBooth/notes", { a: 1 }],
      ["hoopsPublic/_board", { h: 99 }], ["hoopsPublic/_boardHb", { at: 1 }], ["hoopsPublic/_faces", { f: {} }],
      ["hoopsPublic/_season", { off: false }], ["hoopsPublic/newdoc", { x: 1 }],
      ["games/g2", { id: "g2", rev: 1, deleted: false }], ["pitchers/p1", { id: "p1" }],
      ["teams/t1", { key: "t1", by: "stranger" }], ["devices/d1", { uid: "stranger" }],
      ["config/book", { x: 1 }], ["config/owner", { uid: "stranger" }],
    ];
    for (const [p, d] of writes) await closed(setDoc(doc(s, p), d));
  });
  test("a stranger cannot read private documents or list collections", async () => {
    await seedProd();
    const s = ctxAs("stranger", "st@x.com");
    for (const p of ["members/kevin", "hoopsMembers/hcoach", "hoopsGames/2026-12-04-ghs", "hoopsBook/teams", "hoopsBooth/notes",
      "games/g1", "pitchers/p1", "teams/t1", "devices/d1", "config/book", "requests/kevin", "hoopsRequests/kevin"]) await closed(getDoc(doc(s, p)));
    for (const c of ["members", "hoopsMembers", "hoopsGames", "hoopsInvites", "requests", "hoopsRequests", "games"]) await closed(getDocs(collection(s, c)));
  });
  test("a stranger cannot delete anything", async () => {
    await seedProd();
    const s = ctxAs("stranger", "st@x.com");
    for (const p of ["members/kevin", "hoopsMembers/hcoach", "hoopsGames/2026-12-04-ghs", "hoopsPublic/2026-12-04-ghs", "hoopsPublic/_season",
      "games/g1", "config/owner", "hoopsBook/teams"]) await closed(deleteDoc(doc(s, p)));
  });
});

// ======================= unchanged on purpose =======================
describe("Unchanged on purpose (not part of the approved fixes; the ORIGINAL behaviour is the expected one)", () => {
  test("owner claim: first claim by the owner's email works even with an unverified email (documented, unchanged)", async () => {
    await works(claimBatch(ctxAs("evil", OWNER_EMAIL, false), "evil", OWNER_EMAIL));
  });
  test("owner claim: with a verified owner email the first claim works; a non-owner email can never claim", async () => {
    await works(claimBatch(ctxAs("kevin", OWNER_EMAIL, true), "kevin", OWNER_EMAIL));
    await env.clearFirestore();
    await closed(claimBatch(ctxAs("evil", "evil@x.com", true), "evil", "evil@x.com"));
  });
  test("owner claim: once config/owner exists, every path to owner is refused, even for the owner's email", async () => {
    await seedProd();
    for (const v of [false, true]) {
      const db = ctxAs("evil", OWNER_EMAIL, v);
      await closed(claimBatch(db, "evil", OWNER_EMAIL));
      await closed(setDoc(doc(db, "config/owner"), { uid: "evil", email: OWNER_EMAIL, at: NOW }));
      await closed(updateDoc(doc(db, "config/owner"), { uid: "evil" }));
      await closed(deleteDoc(doc(db, "config/owner")));
      for (const role of ["owner", "admin", "coach"]) await closed(setDoc(doc(db, "members/evil"), { role, email: OWNER_EMAIL, at: NOW }));
      await closed(deleteDoc(doc(db, "members/kevin")));
    }
    const a = ctxAs("mbadmin", "adm@x.com");
    await closed(setDoc(doc(a, "config/owner"), { uid: "mbadmin" }));
    await closed(updateDoc(doc(a, "members/kevin"), { role: "admin" }));
  });
  test("a Mound Book admin is still a Brier Stats admin (level 4) with no Brier row", async () => {
    await seedProd();
    const a = ctxAs("mbadmin", "adm@x.com");
    await works(getDocs(collection(a, "hoopsMembers")));
    await works(setDoc(doc(a, "hoopsBook/teams"), { settings: { drive: "https://script.google.com/a/exec", pub: false, pubSec: 5 } }));
    await works(deleteDoc(doc(a, "hoopsGames/2026-12-04-ghs")));
  });
  test("a Mound Book admin can still make other Mound Book admins; the owner still makes admins", async () => {
    await seedProd();
    const a = ctxAs("mbadmin", "adm@x.com");
    await works(setDoc(doc(a, "members/sock"), { role: "admin", email: "sock@x.com", at: NOW }));
    await works(updateDoc(doc(a, "members/mbcoach"), { role: "admin" }));
    await works(updateDoc(doc(ctxAs("kevin", OWNER_EMAIL), "members/mbcoach"), { role: "coach" }));
  });
  test("an admin who wrote their own Brier row stays a Brier admin after leaving Mound Book, until a Brier admin removes the row", async () => {
    await seedProd();
    const a = ctxAs("mbadmin", "adm@x.com");
    await works(setDoc(doc(a, "hoopsMembers/mbadmin"), { role: "scorer", tier: "admin", email: "adm@x.com", name: "", at: NOW }));
    await works(deleteDoc(doc(ctxAs("kevin", OWNER_EMAIL), "members/mbadmin")));
    await closed(getDoc(doc(a, "games/g1")));
    await works(setDoc(doc(a, "hoopsBook/teams"), { settings: { drive: "https://script.google.com/x/exec", pub: true, pubSec: 30 } }));
    await works(deleteDoc(doc(ctxAs("kevin", OWNER_EMAIL), "hoopsMembers/mbadmin")));
    await closed(getDoc(doc(a, "hoopsBook/teams")));
  });
  test("invite sign-up with an unverified email still works (invitee joins at the invited level, can read the invite)", async () => {
    await seedProd(async db => { await setDoc(doc(db, "hoopsInvites/" + CODE), inv()); });
    const t = ctxAs("thief", "victim@x.com", false);
    await works(getDoc(doc(t, "hoopsInvites/" + CODE)));
    await works(setDoc(doc(t, "hoopsMembers/thief"), joinDoc("victim@x.com")));
  });
  test("any scorer can still write new public ids, _stats and _bug, and delete a game copy (documented, unchanged)", async () => {
    await seedGame();
    const db = ctx("scorer");
    await works(setDoc(doc(db, "hoopsPublic", "brand-new-id"), { anything: "x" }));
    await works(setDoc(doc(db, "hoopsPublic", "_stats"), { j: "{\"fake\":1}" }));
    await works(deleteDoc(doc(db, "hoopsPublic", "_stats")));
    await works(deleteDoc(doc(db, "hoopsPublic", GID)));
    await closed(deleteDoc(doc(db, "hoopsPublic", "_season")));
  });
  test("the real owner with an unverified email keeps every day-to-day power", async () => {
    await seedProd(async db => { await setDoc(doc(db, "members/req1"), { role: "coach", email: "r@x.com", at: NOW }); });
    const k = ctxAs("kevin", OWNER_EMAIL, false);
    await works(getDoc(doc(k, "config/owner")));
    await works(setDoc(doc(k, "config/book"), { pitch: 2 }));
    await works(setDoc(doc(k, "members/new1"), { role: "coach", email: "n@x.com", at: NOW }));
    await works(updateDoc(doc(k, "members/req1"), { role: "admin" }));
    await works(updateDoc(doc(k, "games/g1"), { rev: 2, deleted: true, writerDev: "x" }));
    await works(updateDoc(doc(k, "hoopsGames/2026-12-04-ghs"), { rev: 6, writer: "kevin-dev" }));
    await works(setDoc(doc(k, "hoopsPublic/_season"), { off: true }));
    await works(getDocs(collection(k, "hoopsMembers")));
  });
  test("game revision: nobody, not even an Admin, can write a game with a lower rev than the stored one (an old copy can't overwrite a live game)", async () => {
    await seedGame({ rev: 1000050 });
    await closed(setDoc(doc(ctx("admin"), "hoopsGames", GID), game({ rev: 40 })));
    await closed(setDoc(doc(ctx("coach"), "hoopsGames", GID), game({ rev: 40 })));
    await closed(setDoc(doc(ctx("scorer"), "hoopsGames", GID), game({ rev: 40 })));
    await closed(setDoc(doc(ctx("admin"), "hoopsGames", GID), game({ rev: NaN })));
    await works(setDoc(doc(ctx("scorer"), "hoopsGames", GID), game({ rev: 1000051 })));
  });
  test("game revision: an Admin can still delete a game document (the way back from a poisoned rev)", async () => {
    await seedGame();
    await works(setDoc(doc(ctx("scorer"), "hoopsGames", GID), game({ rev: 1e15 })));
    await closed(setDoc(doc(ctx("admin"), "hoopsGames", GID), game({ rev: 6 })));
    await works(deleteDoc(doc(ctx("admin"), "hoopsGames", GID)));
  });
});
