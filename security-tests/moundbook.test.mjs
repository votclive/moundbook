// Security regression tests for Mound Book (index.html). Run: node --test security-tests/
// Reads ../index.html at runtime (override with MB_INDEX=/path/to/other.html).
// Needs the dev dependency "jsdom". Real templates/functions are cut out of the page source
// and executed, so these fail on the pre-fix file. Sinks tested by source-text fallback are
// listed in FALLBACK below (none at present: all six are real renders).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.MB_INDEX || path.join(here, "..", "index.html");
const SRC = fs.readFileSync(FILE, "utf8");
const FALLBACK = [];

function lineWith(needle) {
  const i = SRC.indexOf(needle);
  assert.ok(i >= 0, `cannot find in index.html: ${needle}`);
  const a = SRC.lastIndexOf("\n", i) + 1, b = SRC.indexOf("\n", i);
  return SRC.slice(a, b < 0 ? undefined : b);
}
// text from `start` through `end` (inclusive), searching within one source line
function frag(lineNeedle, start, end) {
  const line = lineWith(lineNeedle);
  const i = line.indexOf(start);
  assert.ok(i >= 0, `cannot find start "${start}" on the line with "${lineNeedle}"`);
  const j = line.indexOf(end, i);
  assert.ok(j >= 0, `cannot find end "${end}" after "${start}"`);
  return line.slice(i, j + end.length);
}
const ESC_SRC = (() => {
  const m = SRC.match(/^function esc\(s\)\{.*\}$/m);
  assert.ok(m, "cannot find function esc(s){...} in index.html");
  return m[0];
})();
const esc = new Function(ESC_SRC + "; return esc;")();
// Build a renderer from a template-literal body that uses the given scope names.
function tpl(body, names) {
  return new Function("esc", ...names, "return `" + body + "`;").bind(null, esc);
}
const unfix = (s) => s.replace(/esc\((g|x|c|e)\.id\)/g, "$1.id").replace(/esc\(x\.date\.slice\(0,4\)\)/g, "x.date.slice(0,4)");

const HOSTILE = 'x"><img src=x onerror="globalThis.__pwned=1">';
const NORMAL = "k3j9x0a1bz";

function parse(html) {
  const dom = new JSDOM(`<body><div id="r">${html}</div></body>`);
  return dom.window.document.getElementById("r");
}
function assertInert(root, why) {
  const bad = [];
  root.querySelectorAll("*").forEach((el) => {
    if (el.tagName === "IMG") bad.push("<img>");
    for (const a of el.attributes) if (/^on/i.test(a.name)) bad.push(`${el.tagName}[${a.name}]`);
  });
  assert.deepEqual(bad, [], `${why}: injected markup created ${bad.join(", ")}`);
}

const SINKS = {
  dataRow: () => frag('data-delg="', '<button class="btn small" data-open="', "Delete</button>`}"),
  option: () => frag("s.innerHTML=gs.map(g=>`<option value=\"${", '<option value="', "</option>"),
  reportRow: () => frag('data-rg="', '<label><input type="checkbox" data-rg=', "</label>"),
  logRow: () => frag('data-ask="${', '<button class="btn small" data-ask="', "Delete</button>"),
  conflict: () => frag('data-cf-keep="', '<button class="btn small" data-cf-keep="', "Use this device's</button>"),
  conflictBoth: () => frag('data-cf-both="', '<button class="btn small" data-cf-both="', "Keep both</button>"),
};

test("#14 Data-tab game row: hostile id is inert and round-trips", () => {
  const f = SINKS.dataRow();
  for (const confirm of [false, true]) {
    const root = parse(tpl(f, ["g", "ui"])({ id: HOSTILE, practice: false }, { dataConfirm: confirm ? HOSTILE : null }));
    assertInert(root, "game row");
    const want = confirm ? ["open", "prac", "delg"] : ["open", "prac", "askg"];
    for (const k of want) {
      const el = root.querySelector(`[data-${k}]`);
      assert.ok(el, `data-${k} button missing`);
      assert.equal(el.dataset[k], HOSTILE, `data-${k} must round-trip`);
    }
  }
});

test("#14 game picker option: hostile id is inert and value round-trips", () => {
  const f = SINKS.option();
  const root = parse(`<select>${tpl(f, ["g", "S", "gameName"])({ id: HOSTILE }, { cur: "" }, () => "G")}</select>`);
  assertInert(root, "picker option");
  assert.equal(root.querySelector("option").value, HOSTILE);
});

test("#14 report row: hostile id and date are inert; id round-trips", () => {
  const f = SINKS.reportRow();
  const render = tpl(f, ["x", "ui", "shortDate", "all"]);
  const all = { ps: [] };
  const root = parse(render({ id: HOSTILE, date: '2026"><img src=x onerror="globalThis.__pwned=2">' }, { report: { games: new Set() } }, () => "Mar 3", all));
  assertInert(root, "report row");
  assert.equal(root.querySelector("[data-rg]").dataset.rg, HOSTILE);
});

test("#14 log row: hostile entry id is inert and round-trips", () => {
  const root = parse(tpl(SINKS.logRow(), ["e"])({ id: HOSTILE }));
  assertInert(root, "log row");
  assert.equal(root.querySelector("[data-ask]").dataset.ask, HOSTILE);
});

test("#14 conflict buttons: hostile id is inert and round-trips", () => {
  const root = parse(tpl(SINKS.conflict(), ["c", "both"])({ id: HOSTILE }, "") + tpl(SINKS.conflictBoth(), ["c"])({ id: HOSTILE }));
  assertInert(root, "conflict buttons");
  for (const k of ["cfKeep", "cfUse", "cfBoth"]) assert.equal(root.querySelector(`[data-${k.replace(/[A-Z]/, (m) => "-" + m.toLowerCase())}]`).dataset[k], HOSTILE);
});

test("#14 mixBar: hostile pitch-type key cannot break out of aria-label", () => {
  const line = lineWith("function mixBar(");
  const mixBar = new Function("esc", "pct", "pcStyle", line + "; return mixBar;")(esc, () => 50, () => "background:#000");
  const k = 'FB"><img src=x onerror="globalThis.__pwned=3">';
  const root = parse(mixBar({ [k]: 1, CH: 1 }, [k, "CH"]));
  assertInert(root, "mixBar");
  assert.ok(root.querySelector(".mixbar").getAttribute("aria-label").startsWith(k + " 50%"));
});

test("normal ids: escaping is a no-op (markup identical to pre-fix template)", () => {
  const cases = [
    [SINKS.dataRow(), ["g", "ui"], [{ id: NORMAL, practice: true }, { dataConfirm: null }]],
    [SINKS.dataRow(), ["g", "ui"], [{ id: NORMAL, practice: false }, { dataConfirm: NORMAL }]],
    [SINKS.option(), ["g", "S", "gameName"], [{ id: NORMAL }, { cur: NORMAL }, () => "G"]],
    [SINKS.reportRow(), ["x", "ui", "shortDate", "all"], [{ id: NORMAL, date: "2026-03-03" }, { report: { games: new Set([NORMAL]) } }, () => "Mar 3", { ps: [] }]],
    [SINKS.logRow(), ["e"], [{ id: NORMAL }]],
    [SINKS.conflict(), ["c", "both"], [{ id: NORMAL }, ""]],
    [SINKS.conflictBoth(), ["c"], [{ id: NORMAL }]],
  ];
  for (const [f, names, args] of cases) {
    const fixed = tpl(f, names)(...args);
    const prefix = tpl(unfix(f), names)(...args);
    assert.equal(fixed, prefix);
    assert.ok(fixed.includes(NORMAL));
  }
});

// ---- #14 (second pass): pitcher hand and game-log values (inning, count, outs, batter hand) ----
// text from `start` up to (not including) `stop`, on one source line
function fragTo(lineNeedle, start, stop) {
  const line = lineWith(lineNeedle);
  const i = line.indexOf(start);
  assert.ok(i >= 0, `cannot find start "${start}" on the line with "${lineNeedle}"`);
  const j = line.indexOf(stop, i);
  assert.ok(j >= 0, `cannot find "${stop}" after "${start}"`);
  return line.slice(i, j);
}
const HAND = 'R"><img src=x onerror="globalThis.__pwned=1">';
const BAD = '<img src=x onerror="globalThis.__pwned=4">';
const SINKS2 = {
  chartHead: () => frag('<span class="h3note">${esc(g.pTeam||"")} · ', '<h3 style="margin:0">', "</h3>"),
  chartInning: () => frag('data-act="inn-"', '<span class="num">', "</span>"),
  chartCount: () => frag('<div class="count" aria-live="polite">', '<span class="b">', "</div>"),
  chartBatter: () => frag("switch, batting ", "<b>${", "</span>"),
  zoneHand: () => frag('font-family="Barlow Condensed,sans-serif">${', "<text ", "</text>"),
  logRow: () => fragTo('HB ${esc(d.batter||"")}', "<td>${d.n}</td>", '<td class="l">${[d.r1'),
  reportStar: () => frag("Flagged by the charter</h2>", "<li>${esc(shortDate(x.date))}, ", "</li>"),
};
const NAMES2 = {
  chartHead: ["pLabel", "p", "g", "handKnown", "L"],
  chartInning: ["L"],
  chartCount: ["L"],
  chartBatter: ["L", "batterText", "curB"],
  zoneHand: ["left", "W", "H", "o"],
  logRow: ["d"],
  reportStar: ["x", "shortDate", "ordinal", "pname", "resLabel", "paLabel"],
};
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const r2 = (k) => tpl(SINKS2[k](), NAMES2[k]);
const id = (v) => String(v);
const args2 = (hand, inning, balls, bhand) => ({
  chartHead: [() => "#12 Smith", { hand, num: "12", name: "Smith" }, { pTeam: "Westlake" }, () => true, { pop: 2 }],
  chartInning: [{ inning }],
  chartCount: [{ balls, strikes: balls }],
  chartBatter: [{ spot: 2, hand: bhand }, () => "#7 Jones", { hand: bhand }],
  zoneHand: [true, 100, 120, { hand: bhand }],
  logRow: [{ n: 9, inning, hand: bhand, batter: "Jones", balls, strikes: 1, outs: inning }],
  reportStar: [{ date: "2026-03-03", inning, balls, strikes: 1, batter: "Jones", hand: bhand, type: "FB", pa: null }, () => "Mar 3", ordinal, id, () => "Called", id],
});
// The pre-fix template: the same fragment with this pass's esc() wrappers taken off.
const UNFIX2 = ['L.spot+1', 'curB.hand==="S"?"switch, batting "+L.hand:"bats "+L.hand', "p.hand", "L.inning", "L.balls", "L.strikes",
  "d.inning", "d.hand", "d.balls", "d.strikes", "d.outs", "ordinal(x.inning)", "x.balls", "x.strikes", "x.hand", "o.hand"];
const unfix2 = (f) => UNFIX2.reduce((s, e) => s.split("esc(" + e + ")").join(e), f);

test("#14 hostile pitcher hand, batter hand, inning and count are inert (Chart tab, zone, Log, report)", () => {
  const a = args2(HAND, BAD, BAD, HAND), open = [];
  for (const k of Object.keys(SINKS2)) {
    const html = r2(k)(...a[k]);
    const root = k === "zoneHand" ? parse(`<svg>${html}</svg>`) : k === "logRow" ? parse(`<table><tbody><tr>${html}</tr></tbody></table>`) : parse(html);
    try { assertInert(root, k); } catch (e) { open.push(k); }
  }
  assert.deepEqual(open, [], `injected markup in: ${open.join(", ")}`);
});

test("normal use: legit hand, inning and count render byte-identical to the pre-fix template", () => {
  for (const [hand, bhand] of [["R", "R"], ["L", "L"], ["S", "S"], ["R", "L"]]) {
    const a = args2(hand, 3, 2, bhand);
    for (const k of Object.keys(SINKS2)) {
      const f = SINKS2[k]();
      const fixed = tpl(f, NAMES2[k])(...a[k]);
      const prefix = tpl(unfix2(f), NAMES2[k])(...a[k]);
      assert.equal(fixed, prefix, k);
      assert.ok(!/esc\(/.test(unfix2(f).replace(/esc\((?:g\.pTeam\|\|""|pLabel\(p\)|batterText\(curB\)|d\.batter\|\|""|shortDate\(x\.date\)|x\.batter\|\|"\?"|resLabel\(x\)|paLabel\(x\.pa\))\)/g, "")), `${k}: unfix2 left a wrapper`);
    }
  }
  assert.ok(tpl(SINKS2.chartHead(), NAMES2.chartHead)(...args2("L", 3, 2, "L").chartHead).includes("LHP"));
  assert.ok(tpl(SINKS2.chartInning(), ["L"])({ inning: 3 }).includes(">3<"));
});

function loadReadJoin(hostname) {
  const s = SRC.indexOf("function readJoin(text){");
  assert.ok(s >= 0, "cannot find readJoin in index.html");
  const e = SRC.indexOf("\n  }", s);
  assert.ok(e > s, "cannot find end of readJoin");
  return new Function("location", SRC.slice(s, e + 4) + "; return readJoin;")({ hostname });
}
const mb1 = (o) => "MB1:" + Buffer.from(unescape(encodeURIComponent(JSON.stringify(o))), "latin1").toString("base64");
const CODE = mb1({ firebase: { apiKey: "AIzaFake", projectId: "p" }, owner: "o", emulator: { auth: "http://evil.example:9099", host: "evil.example", port: 8080 } });

test("#15 readJoin strips the emulator block off the live site", () => {
  const o = loadReadJoin("votclive.github.io")(CODE);
  assert.ok(o && o.firebase.apiKey === "AIzaFake", "normal fields must survive");
  assert.equal(o.emulator, undefined);
});
test("#15 readJoin keeps the emulator block on localhost / 127.0.0.1", () => {
  for (const h of ["localhost", "127.0.0.1"]) {
    const o = loadReadJoin(h)(CODE);
    assert.equal(o.emulator.host, "evil.example", `kept on ${h}`);
  }
});
test("#15 the emulator hookup is guarded by the hostname test", () => {
  const line = lineWith("fb.connectAuthEmulator(");
  const cond = line.slice(line.indexOf("if("), line.indexOf("fb.connectAuthEmulator"));
  assert.match(cond, /location\.hostname\s*===\s*"localhost"/);
  assert.match(cond, /location\.hostname\s*===\s*"127\.0\.0\.1"/);
  assert.equal(SRC.split("connectAuthEmulator(").length - 1, 1, "only one hookup site expected");
});

test("#16 Let-in handler confirms before approving", () => {
  const line = lineWith('[data-ok-uid]",el)');
  const c = line.indexOf("confirm("), a = line.indexOf('approve(b.dataset.okUid,"coach")');
  assert.ok(c >= 0, "no confirm( in the Let-in handler");
  assert.ok(a >= 0, "approve call not found");
  assert.ok(c < a, "confirm( must come before approve(");
  assert.match(line, /Anyone can make an account with any name and email/);
});
