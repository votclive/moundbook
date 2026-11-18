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
