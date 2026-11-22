/* Brier Stats, Social tab (Admins only, 0.35.0): Kevin's social post generator, running inside the app.
   This first part stands in for the runtime the generator was written for (its db, its file store and its downloads), on
   top of the app's socialApi(): games, scores and rosters from the book, what Social adds in hoopsBook/social, pictures in
   hoopsBook/simg-<id>, and files through the iPad's share sheet. The generator below is Kevin's, changed only where marked. */
(function () {
  "use strict";
  var api = null;
  try { if (window.parent !== window && typeof window.parent.socialApi === "function") api = window.parent.socialApi(); } catch (e) { api = null; }
  window.__SOC = api;
  if (!api) return; // opened by itself, or not an Admin: the generator says where to open it
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  var subs = [], sigs = {}, cur = null;
  function read() { var s = null; try { s = api.snap(); } catch (e) { s = null; } if (s) cur = s; return cur; }
  function give(sb, val) {
    if (sb.one) { sb.cb({ exists: true, id: "main", data: function () { return clone(val || {}); } }); return; }
    var docs = Object.keys(val || {}).map(function (id) { var v = val[id]; return { id: id, exists: true, data: function () { return clone(v); } }; });
    sb.cb({ docs: docs, size: docs.length });
  }
  function listen(k, one, cb) {
    var sb = { k: k, one: one, cb: cb }; subs.push(sb);
    var s = read(); if (s) { sigs[k] = JSON.stringify(s[k] || {}); give(sb, s[k] || {}); }
    return function () { subs = subs.filter(function (x) { return x !== sb; }); };
  }
  // The app calls this whenever it draws: only what changed is handed on.
  var pend = false;
  window.__socPing = function () {
    if (pend) return; pend = true;
    setTimeout(function () {
      pend = false; var s = read(); if (!s) return;
      ["games", "rosters", "photos", "sponsors", "settings"].forEach(function (k) {
        var sig = JSON.stringify(s[k] || {}); if (sigs[k] === sig) return; sigs[k] = sig;
        subs.forEach(function (sb) { if (sb.k === k) give(sb, s[k] || {}); });
      });
    }, 30);
  };
  function wrote(p) { return Promise.resolve(p).then(function () { window.__socPing(); }); }
  var db = {
    collection: function (name) { return { onSnapshot: function (cb) { return listen(name, false, cb); } }; },
    doc: function (path) {
      return {
        onSnapshot: function (cb) { return listen(String(path).split("/")[0], true, cb); },
        update: function (patch) { return wrote(api.write(path, "update", clone(patch))); },
        set: function (body) { return wrote(api.write(path, "set", clone(body))); },
        delete: function () { return wrote(api.write(path, "delete")); }
      };
    }
  };
  // Pictures: PNG, JPEG or WebP data URLs of at most 3.6 MB (four Firestore documents). Anything bigger, or an SVG logo, is
  // drawn again smaller until it fits.
  var MAX = 3600000, OK = /^data:image\/(?:png|jpeg|webp);base64,/;
  function asUrl(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(blob); }); }
  function load(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej({ code: "unsupported_type" }); }; i.src = src; }); }
  function fit(blob) {
    var jpg = /jpe?g/i.test(blob.type || "");
    return asUrl(blob).then(function (d) {
      if (OK.test(d) && d.length <= MAX) return d;
      var u = URL.createObjectURL(blob);
      return load(u).then(function (im) {
        URL.revokeObjectURL(u);
        var w = im.naturalWidth || im.width || 1200, h = im.naturalHeight || im.height || 1200, k = Math.min(1, 2400 / Math.max(w, h)), out = "";
        if (!w || !h) throw { code: "unsupported_type" };
        for (var tries = 0; tries < 8; tries++) {
          var c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          out = jpg ? c.toDataURL("image/jpeg", 0.88) : c.toDataURL("image/png");
          if (out.length <= MAX && OK.test(out)) return out;
          k *= 0.8;
        }
        throw { code: "too_large" };
      });
    });
  }
  var assets = {
    upload: function (blob) { return fit(blob).then(function (d) { return api.putImg(d); }); },
    delete: function (id) { return api.delImg(id); }
  };
  var downloads = { save: function (o) { return api.save(o.filename, o.data); } };
  window.claude = { use: function (name) { return Promise.resolve(name === "db" ? db : name === "assets" ? assets : name === "downloads" ? downloads : null); } };
  // Brier Stats scrolls as one page: the frame takes the page's height, and a new view starts at its top.
  function tell() { try { api.size(document.documentElement.scrollHeight); } catch (e) {} }
  if (window.ResizeObserver) new ResizeObserver(tell).observe(document.documentElement); else setInterval(tell, 1000);
  window.addEventListener("load", tell);
  function hash() { try { api.hash((location.hash || "").replace("#", "")); } catch (e) {} }
  hash();
  window.addEventListener("hashchange", function () { hash(); try { api.top(); } catch (e) {} });
})();

/* ---------- Kevin's social post generator (ported; changes are marked Brier Stats) ---------- */
(function () {
  "use strict";
  var MODE = "live";
  var PRACTICE = MODE === "practice";
  var PERIODS = [
    { k: "q1", label: "1st quarter", tag: "End of 1Q", after: "after one" },
    { k: "q2", label: "Halftime", tag: "HALFTIME", after: "at the half" },
    { k: "q3", label: "3rd quarter", tag: "End of 3Q", after: "after three" },
    { k: "q4", label: "End of regulation", tag: "End of regulation", after: "at the end of regulation", ot: true },
    { k: "ot1", label: "End of OT", tag: "End of OT", after: "after overtime", ot: true },
    { k: "ot2", label: "End of 2OT", tag: "End of 2OT", after: "after double overtime", ot: true }
  ];
  var state = { games: {}, settings: {}, filter: "all", open: null, tab: "x", drafts: {}, spin: {}, showOT: {}, bsOpen: {}, bsMsg: {}, readOnly: false, loaded: false,
    view: "gameday", rosters: { Girls: [], Boys: [] }, gdNight: null, gdTab: "x", gdTheme: {}, gdMsg: "", week: null, weekTier: "playful", luTab: "x" };
  var db = null;
  try { var f = localStorage.getItem("scorebook." + MODE + ".filter"); if (f) state.filter = f; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dateObj(iso) { var p = iso.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function fmtDate(iso, opts) { return dateObj(iso).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, opts)); }
  function fmtTime(t) { if (!t) return ""; var p = t.split(":").map(Number); var h = p[0] % 12 || 12; return h + ":" + String(p[1]).padStart(2, "0") + (p[0] < 12 ? " AM" : " PM"); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function hasFinal(g) { return isNum(g.gb) && isNum(g.opp); }
  function sortGames(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "99") < (b.time || "99") ? -1 : (a.time || "99") > (b.time || "99") ? 1 : 0; }
  function allGames() { return Object.keys(state.games).map(function (id) { return Object.assign({ id: id }, state.games[id]); }).sort(sortGames); }
  function nick(team) { var s = state.settings; return (team === "Boys" ? s.boys_name : s.girls_name) || (team === "Boys" ? "Bobcats" : "Lady Cats"); }
  function siteWord(g) { return g.home_away === "Away" ? "at" : "vs."; }
  function article(n) { var s = String(n); return (s.charAt(0) === "8" || n === 11 || n === 18) ? "An" : "A"; }
  function period(g, k) { var p = (g.periods || {})[k]; return p && isNum(p.gb) && isNum(p.opp) ? p : null; }
  function latestPeriod(g) { var last = null; PERIODS.forEach(function (p) { if (period(g, p.k)) last = p; }); return last; }

  var SHOW_RECORDS = false; // Kevin (2026-11-12): keep W-L records out of captions and graphics for now
  function record(team, uptoDate, uptoTime) {
    var r = { w: 0, l: 0, dw: 0, dl: 0 };
    allGames().forEach(function (g) {
      if (g.team !== team || !hasFinal(g)) return;
      if (uptoDate && (g.date > uptoDate || (g.date === uptoDate && (g.time || "99") > (uptoTime || "99")))) return;
      var win = g.gb > g.opp;
      if (win) r.w++; else r.l++;
      if (g.district) { if (win) r.dw++; else r.dl++; }
    });
    return r;
  }
  function nextGame(g) { return allGames().filter(function (x) { return x.team === g.team && x.date > g.date; })[0] || null; }
  function join(parts) { return parts.filter(function (p) { return p !== ""; }).join("\n\n"); }

  // Slang checked against 2025-26 usage: aura, locked in, cooking, HIM/HER, ate, low-cortisol, canon event, "Ballgame."
  // Never used: cooked (as in doomed), washed, mid, ratio, L, rizz and the like, "cat fight", "no cap", "sheesh".
  // Guardrails (Kevin): playful = goofy; wild = very snarky after wins, aimed at scoreboards and mascots, never at a named
  // opposing kid, never at refs, never crude. Our kids only get positive framing. Big losses stay muted in every take.
  var LINES = {
    playful: {
      win: ["Feline fine tonight. 😺💚", "Meow we're talking. 😺🐾", "Claw-some win for the {n}! 🐾", "Purr-ty good night, if you ask us. 😺", "Another one for the Cat-alog. 📚🐾", "Paws-itively purr-fect. 🐾💚"],
      thriller: ["Whisker-close! Somebody get us a nap. 😮‍💨😺", "Cardiac Cats! Somebody check on the parents. 🫀😺", "That one cost us at least one of our nine lives. 😅🐾", "Cat-and-mouse to the final horn, and the cat won. Obviously. 😺"],
      rout: ["Litter-ally everybody ate tonight. 🍽️😺", "The {n} were feline themselves tonight. 😺🔥", "Fur real, that was fun. 😺🐾", "Claws out from tip to horn. 🐾🔥"],
      comeback: ["Nine lives? We only needed one. 😺", "Down {cb}, then: meow. 😺🐾", "Never count out a cat. Comeback W for the {n}! 🐾💚", "Never in doubt. (It was very much in doubt.) 😅💚"],
      winOT: ["Bonus basketball, bonus W. ⏱️😺", "The {n} needed a little extra time to get ready. ⏱️😺", "Overtime? Cats love a long nap and a long game. ⏱️🐾"],
      rival: ["Rivalry W for the {n}. Feels good, doesn't it? 😌💚", "Bragging rights stay with the {n}. 🐾", "Rivalry night belongs to the {n}! 💚🐾"],
      road: ["Road trip snacks taste better after a W. 🚌🍿"],
      home: ["Pack the Den, get a W. That's how it works. 🏠🐾"],
      loss: ["Not our night. Cats always land on their feet. 💚", "Tough one {site}. Back to work, {n}. 💚", "Didn't go our way tonight. Proud of the effort, {n}. 💚"],
      heartbreak: ["Battled to the final horn. Proud of this group. 💚", "Came down to the wire. The {n} fought every possession. 💚", "Tough way to lose one. Heads up, {n}. 💚"],
      rough: ["Not our night. On to the next one. 💚", "Tough night. The {n} get back to work. 💚"],
      lossOT: ["Gave it everything through overtime. Proud of the fight, {n}. 💚", "Took it to overtime and battled to the end. Heads up, {n}. 💚"],
      sweep: ["Season sweep over {opp}. 🧹😺", "2-0 against {opp} this season. Tidy. 🧹"],
      firstWin: ["First W of the season is in the books! 💚", "Win No. 1 for the {n}. Many more meows to come. 😺"],
      streak: ["That's {k} straight. Somebody get the Cats a scratching post. 🔥", "{k} in a row for the {n}. 🔥😺"],
      scorer: ["Leading the way: {who} with {pts}. 🏀", "{who} paced the {n} with {pts}. 🎯"],
      big20: ["{who} was purr-fectly unstoppable with {pts}. 😺", "{who} poured in {pts}. Purr-imeter on fire. 🔥", "Cat-ch me if you can: {who} with {pts}. 🏃"],
      big30: ["{who} went off for {pts}. Somebody hide the nets. 🔥🔥", "{pts}-point night for {who}. Feline unstoppable. 😺🔥"],
      ctaIG: ["Smash that 💚 if you're feline good.", "Tag your favorite Cats fan. 👇😺", "Double-tap if you were in the Den. 🐾"],
      ctaFB: ["Congrats, {n}! 💚", "Great win, {n}! 🐾"]
    },
    wild: {
      win: ["Scoreboard. 😼", "W. 🐾 Next question.", "Sorry not sorry. 😼", "Another day, another {n} dub. Get used to it. 😼", "+1000 aura. Zero apologies. 😼", "The {n} ATE. Leftovers to go. 🥡😼"],
      thriller: ["Made it close on purpose. Character building. 🫀😼", "ICE. IN. THE. VEINS. 🧊😼", "Gave {opp} hope, then took it back. Classic. 😼", "Low-cortisol basketball when it mattered. Their cortisol? Different story. 🧊😼"],
      rout: ["{N} BY {m}. 😼 That's the post.", "{m}? We were being polite. 😼", "Running clock energy. ⏱️😼", "Light work. {n} by {m}. 😼💅", "That's not a game, that's a highlight reel. 🎬😼"],
      comeback: ["{opp} had a lead. Had. 😼", "Let 'em think they had it. 😼", "Down {cb}. Took it back. Rude of us, honestly. 😼", "Chat, we are SO back. 🔥😼"],
      winOT: ["We just wanted more time to watch ourselves win. ⏱️😼", "Overtime is Cats time. Always has been. ⏱️😼", "Extra period, same result. Yawn. 🥱😼"],
      rivalWild: ["Scoreboard. 😼", "Bragging rights: ours. Group chats: quiet. 🤫😼", "Rivalry week ended exactly how it was supposed to. 😼", "{opp}, the {n} said hi. 👋😼", "Tell your friends. Actually, they already know. 😼"],
      rivalRematch: ["See you again {rdate}. Bring a friend. 😏", "Round 2 is {rdate}. Same result, probably. 😏"],
      rivalDone: ["Same time next year? 😏", "Rent's paid through next season. 😏"],
      road: ["Thanks for having us. We'll take the W to go. 🥡😼", "Business trip: complete. 💼😼"],
      home: ["Thanks for coming. Drive safe. 👋😼", "Hope the bus ride home has good WiFi. 🚌😼"],
      loss: ["Short memory. Back in the gym. 😤", "Canon event. Claws back out next game. 😤💚", "Whoever's next on the schedule: our condolences. 😤"],
      heartbreak: ["Lost the score, not the fight. 😤💚", "Respectfully, we'll see you in the rematch. 😤", "That one stings. This group will be back hungry. 😤"],
      rough: ["Tough night. We'll be back. 💚", "On to the next one. 💚"],
      lossOT: ["Overtime didn't go our way, but that fight? Elite. 😤💚", "Took it the distance. Proud of every one of you, {n}. 💚"],
      sweep: ["SEASON SWEEP. Brooms out. 🧹😼", "2-0 vs. {opp} this year. Clean house. 🧹😼"],
      firstWin: ["First dub of the season. Plenty more where that came from. 😼", "The {n} are on the board. Everybody else, update your notes. 😼"],
      streak: ["{k} STRAIGHT. Somebody stop us. (You can't.) 😼", "Win streak: {k}. Heater activated. 🔥😼"],
      scorer: ["{who} led the way with {pts}. 🔥", "{who} with {pts}. Locked in. 🔒"],
      big20: ["Let {her} cook: {who} with {pts}. 🧑‍🍳🔥", "{who} said \"my turn\" and dropped {pts}. 🎯", "{who} is {HER}. {pts} points. 😤"],
      big30: ["{pts} PIECE from {who}. 🔥🔥🔥", "{who} put up {pts}. Somebody check on the nets. 🥵", "{who}: {pts} points. {who} is {HER}. 😤"],
      ctaIG: ["Drop a 😼 if you were there.", "Say it with your chest, Cats fans. 💚👇", "Tag somebody who needs to see this. Especially if they're from {opp}. 👇😼"],
      ctaFB: ["Cats fans, let 'em hear it! 💚", "What a night for the {n}! 🐾"]
    }
  };
  LINES.playful.rivalWild = LINES.playful.rival; LINES.playful.rivalRematch = []; LINES.playful.rivalDone = [];
  LINES.wild.rival = LINES.wild.rivalWild;
  // EXTREME (Kevin, 2026-11-15): the wild take turned up, roasting the other team's MASCOT, rivals hardest.
  // Same guardrails: mascots, school names and scoreboards only, never a kid, never refs, nothing crude, no politics.
  // Losses fall back to the wild take's proud lines, because our kids never get roasted.
  // Every pool is its own (nothing borrowed from wild), so the extreme headline never repeats the wild one.
  // Heritage is a personal rivalry: jokes stay on the Patriots name and history. Never anything about who plays where.
  LINES.extreme = {
    win: ["The {N} just ruined {opp}'s whole weekend. 😼", "Another week, another {masV} trophy on the wall. 🖼️😼", "{opp} came in with a plan. Cute. 😼", "Somebody tell {opp} the scoreboard isn't broken. 📟😼", "Cats eat. {Mas} watch. 🍽️😼"],
    thriller: ["{opp} really thought. Bless their hearts. 😼", "Let {mas} smell it, then took it away. Evil? Effective. 😈😼", "Close game? Nah. We were just bored. 🥱😼"],
    rout: ["{N} BY {m}. Mercy rule? Never heard of her. 😼", "Public service announcement: don't play the Cats. 📢😼", "{m}-point W. Somebody send {mas} a sympathy card. 💐😼", "{N} BY {m}. {opp}'s bus driver had the best night of anybody in red. 🚌😼"],
    comeback: ["{opp} led by {cb}. Then the Cats got bored. 😼", "Blew a {cb}-point lead to the Cats. {opp}, that one's going to sting for a while. 😼", "{Mas} had a {cb}-point lead and a dream. Now they have neither. 😼"],
    winOT: ["{opp} begged for overtime. We said fine, then finished the job. ⏱️😼", "Four quarters, plus a bonus round of embarrassing {mas}. ⏱️😼"],
    rivalWild: ["Rivalry? {opp} has to win one first. 😼", "{opp} fans: we'll wait while you delete your group chats. 🤫😼", "Bragging rights: ours. {opp}: in shambles. 😼", "The {N} own {opp}. Rent's due monthly. 🧾😼"],
    rivalRematch: ["Round 2 is {rdate}. {masV}, bring a helmet. ⛑️😼", "See you {rdate}, {masV}. Same script, worse ending. 📜😼"],
    rivalDone: ["That's a whole year of quiet from {mas}. 🤫😼", "365 days for {mas} to think about that one. 📆😼"],
    road: ["Walked into {opp}'s house and changed the locks. 🔑😼", "Thanks for hosting, {opp}. We'll let ourselves out. With the W. 🚪😼"],
    home: ["{Mas} fans, the exit is to your left. Don't let it hit you. 👋😼", "Den rules: we win, you leave. 🏠😼"],
    // losses: still never down on our kids, just defiant
    loss: ["Mark it down. The {n} remember everything. 📝😤", "One game. That's all {opp} gets. 😤"],
    heartbreak: ["{opp} got one tonight. The {n} will be back for it. 😤", "Close isn't good enough for this group. They'll be back hungry. 😤💚"],
    rough: ["Not our night. Next one's ours. 💚", "Short memory, long season. 💚"],
    lossOT: ["Took it the distance. That fight isn't going anywhere. 😤💚", "Overtime went the other way. This group's fight never does. 😤💚"],
    sweep: ["SWEPT. {opp}, the brooms are ours now. 🧹😼", "Season sweep. {opp} can try again next year. 🧹😼"],
    firstWin: ["First W. Everybody else: you've been warned. 😼", "Win No. 1. The {n} are coming for the whole schedule. 😼"],
    streak: ["{k} straight. Somebody call the league. 📞😼", "{k} in a row. Who's next? Asking for a friend. 😼"],
    scorer: ["{who} with {pts}. Different breed. 😤", "{who} led the way with {pts}. Unbothered. 😤"],
    big20: ["{who} cooked for {pts}. Kitchen's closed. 🧑‍🍳🔥", "{who} with {pts}. Unguardable. 🔥", "{pts} for {who}. Somebody get {her} a bigger stage. 🎤🔥"],
    big30: ["{pts} PIECE. {who} is a problem. 😤🔥", "{who}: {pts}. Somebody file a missing nets report. 🥵", "{who} went for {pts}. {HER}. 😤🔥"],
    ctaIG: ["Tag a {opp} fan. Do it. 👇😼", "Drop a 😼 if you were there. Drop two if a {opp} fan is reading this.", "Say it louder for {mas} in the back. 📣😼"],
    ctaFB: ["Share this with your favorite {opp} fan. 😼", "Cats fans, let 'em hear it all the way to {opp}. 📣😼"]
  };
  LINES.extreme.rival = LINES.extreme.rivalWild;

  var LIVE = {
    playful: {
      tied: ["All square {after}. Buckle up. 🍿", "Tied {after}. Cats like a little suspense. 😺"],
      lead: ["Claws out: {n} by {d} {after}. 🐾", "{n} up {d} {after}. Purr-ty good start. 😺", "{n} lead by {d} {after}. Locked in. 🔒"],
      bigLead: ["{n} up {d} {after}. Feline fine. 😺🔥", "{n} rolling, up {d} {after}. Cats cooking. 🧑‍🍳"],
      trail: ["Within {d} {after}. Plenty of ball left. 📣", "Down {d} {after}. No cat naps, just adjustments. 💚"],
      bigTrail: ["Down {d} {after}. Long way to go. Let's go, {n}! 💚"],
      toOT: ["Tied {after}. Bonus basketball, coming right up! ⏱️😺", "Knotted up {after}. Overtime, here we come. ⏱️"],
      rivalLead: ["Rivalry night, and the {n} have the edge {after}. 😌"],
      homeLead: ["Home cooking: {n} up {d} {after}. 🏠🔥"]
    },
    wild: {
      tied: ["Tied {after}. We're just making it interesting. 😼", "Dead even {after}. Get loud, Cats fans! 📣"],
      lead: ["{n} up {d} {after}. Locked. In. 🔒😼", "{N} UP {d} {after}. Get comfortable. 😼"],
      bigLead: ["UP {d} {after}. Somebody check on the other bench. 😼", "{n} up {d} {after}. The {opp} fans got quiet. 🤫😼", "UP {d} {after}. The {n} are feasting. 🍽️😼"],
      trail: ["Down {d} {after}. Nine lives, baby. 🐾😤", "Down {d} {after}. Comeback loading... ⏳😤"],
      bigTrail: ["Down {d} {after}. Keep the energy up, Cats fans. 💚"],
      toOT: ["OVERTIME! ⏱️🔥 Nobody leave.", "Tied {after}. WE'RE GOING EXTRA. ⏱️😤"],
      rivalLead: ["Rivalry night, and the {n} are up {d} {after}. Sounds about right. 😼", "Rivalry night vs. {opp}, and the {n} have the lead {after}. Shocking. (Not really.) 😼"],
      homeLead: ["Our Den. Our lead. {n} up {d} {after}. 🏠😼"]
    }
  };
  LIVE.extreme = {
    tied: ["Tied {after}. We're just letting {opp} feel something. 😼", "All square {after}. Enjoy it while it lasts, {opp}. 😼"],
    lead: ["{n} up {d} {after}. Nervous energy on the {opp} bench. 😬😼", "{N} UP {d} {after}. {masV}, it's not looking great. 😼"],
    bigLead: ["UP {d} {after}. Somebody call {mas} a ride home. 🚕😼", "UP {d} {after}. {opp} fans are entering witness protection. 🕶️😼", "{N} UP {d} {after}. {opp} fans found the exits. 🚪😼"],
    trail: ["Down {d} {after}. The Cats were just warming up. 😤", "Down {d} {after}. {opp}, don't get comfortable. 😤"],
    bigTrail: ["Down {d} {after}. Keep it loud, Cats fans. This group never quits. 💚"],
    toOT: ["OVERTIME. {opp} wants more? Fine. ⏱️😤", "Tied {after}. Bonus round. Cats love a bonus round. ⏱️😼"],
    rivalLead: ["Rivalry night, and trouble is already brewing for {mas} {after}. 😼", "{n} up {d} {after}. Hard lessons for {mas} tonight. 📚😼"],
    homeLead: ["Our Den, our lead. {opp} fans, the parking lot's that way. 🏠😼"]
  };

  // ---------- Caption engine ----------
  // Every caption comes in three takes: straight (just the facts), playful, and wild (gloating allowed).
  // The mood follows the scoreboard: losses stay low-key in all three, big wins get loud, and a win over a
  // rival lets the wild take talk a little trash at the matchup and the mascot, never at a kid.
  // "New takes" shuffles the playful and wild lines; the straight take never changes.
  var TIERS = [{ k: "straight", label: "Straight" }, { k: "playful", label: "Playful" }, { k: "wild", label: "Wild" }, { k: "extreme", label: "Extreme" }];
  function isW(t) { return t === "wild" || t === "extreme"; } // extreme follows every wild rule, then adds mascot roasts
  var DEFAULT_RIVALS = "White House Heritage, White House, Springfield";
  // Opponent mascots (verified on TSSAA directory pages, Oct 2026).
  // play  = goofy wordplay for the playful take after a win.
  // snark = the wild take's jab after a win over a non-rival; wild = the spicier rival version.
  // Jabs hit the mascot or the scoreboard, never a kid. No wordplay at all on East Robertson's mascot.
  var MASCOTS = {
    "springfield": { name: "Yellow Jackets", roast: ["Yellow Jackets: loud, annoying, and gone by the fourth quarter. 🐝😼", "Springfield got swatted, sprayed and sent home. 🪰😼", "Yellow Jackets only get one sting. They used it in warmups. 🐝😼", "Springfield called an exterminator. Turns out it was us. 🐝🚫😼"], pre: ["Yellow Jackets tonight. Bug spray: loaded. 🐝😼", "Springfield's buzzing. Give it two hours. 🐝⏳😼", "Swat team is on site. 🪰😼"],  play: ["Springfield brought the buzz. The Cats brought the bug spray. 🐝🐾"],
      wild: ["Buzzkill. 🐝🚫😼", "No stings attached. 😼", "Pest control: handled. 🐾😼", "Springfield, y'all can buzz off now. 🐝👋😼"] },
    "white house": { name: "Blue Devils", roast: ["The Blue Devils got exorcised. No priest required. 😇😼", "The Blue Devils went down to Georgia. Should have stayed there. 🎻😼", "Vetoed. Overruled. Adjourned. 🏛️😼", "The White House is green now. Paint's still drying. 🎨😼"], pre: ["Blue Devils tonight. Holy water: packed. 💧😼", "Devils in the building. Bring a halo, they'll need it. 😇😼", "The White House is about to get repainted green. 🎨😼"],  play: ["Forest green over royal blue tonight. 💚"],
      wild: ["The White House just got vetoed. 🏛️😼", "Feeling blue? We're not. 💚😼", "Cats over Devils. Simple math. 😼", "Somebody tell the Blue Devils this isn't Durham. 😼"] },
    "white house heritage": { name: "Patriots", roast: ["Heritage? After tonight, that's just history. 📜😼", "The Patriots got sacked, flagged and sent home. 🚩😼", "Liberty, justice, and an L for Heritage. 🗽😼", "Somebody tell the Patriots the Revolution is over. They lost. 🗽😼", "Heritage just learned a new chapter of American history. Spoiler: Cats win. 📚😼", "Red, white and blue? Try red-faced, white-flagged and feeling blue. 🏳️😼"], pre: ["Patriots tonight. The fireworks are on us. 🎆😼", "Heritage week. The Cats are rewriting the history books. 📜😼", "Patriots in the building. Hope they packed a white flag. 🏳️😼", "Heritage tonight. Lock in, Cats fans. Get LOUD. 🔒📣😼"],  play: ["Green and white over red, white and blue. 💚"],
      wild: ["Give me liberty or give me a W. We took the W. 🗽😼", "Independence Day came early. For us. 🎆😼", "Heritage is all about history. Tonight's history lesson: Cats win. 📚😼"] },
    "watertown": { name: "Purple Tigers", roast: ["Purple Tigers? Sounds like a cartoon. 📺😼", "Grape-flavored tigers got squashed. 🍇😼"],  play: ["Big Cat Summit goes to the Cats in green. 🐯🐾"], snark: ["Purple reign? Not tonight. ☔😼", "Tigers are cool and all. Bobcats just hit different. 😼"] },
    "wilson central": { name: "Wildcats", roast: ["Two cats walked in. Only one is talking about it today. 😼", "Wildcats? Mild cats. 🥛😼"],  play: ["Cats vs. Cats, and the green ones landed on their feet. 🐾"], snark: ["Only room for one set of Cats in this story. 😼", "Wild? Cute. 😼"] },
    "portland": { name: "Panthers", roast: ["Panthers got declawed. 💅😼", "Portland brought the Pink Panther theme music. Fitting. 🎵😼"],  play: ["Big-cat battle goes to the Cats in green. 🐾"], snark: ["Big-cat rankings: updated. 😼", "Panthers? Tonight they were house cats. 🏠😼"] },
    "liberty creek": { name: "Wolves", roast: ["The big bad wolf huffed and puffed. The Cats are still standing. 🏠😼", "Wolves hunt in packs. Should have brought a bigger pack. 🐺😼"],  play: ["The pack ran hard. The Cats ran harder. 🐺🐾"], snark: ["Who's afraid of the big bad wolf? Not us. 🐺😼", "Howl about that? 😼"] },
    "station camp": { name: "Bison", roast: ["Stampede canceled due to Cats. 🦬🚫😼", "Buffalo wings on the menu tonight. 🍗😼"],  play: ["A stampede of a game, and the Cats came out on top. 🦬🐾"], snark: ["Bison? More like bye-son. 👋🦬😼", "Stampede? We'll call it a light jog. 😼"] },
    "gallatin": { name: "Green Wave", roast: ["Green Wave? We surfed it. 🏄😼", "Low tide in Gallatin tonight. 🌊😼"],  play: ["Two shades of green, one Cats W. 💚🌊"], snark: ["Only one shade of green leaves with a W. 💚😼", "Wave? We barely felt a ripple. 🌊😼"] },
    "jo byrns": { name: "Red Devils", roast: ["The Red Devils got a cold shower. 🚿😼", "Devils down, Cats up. Easy math. 😼"],  play: ["Red-hot battle, green-and-white finish. 🔥💚"], snark: ["Turned the heat right down. 🧊😼", "Red-hot? We brought the ice. 🧊😼"] },
    "merrol hyde": { name: "Hawks", roast: ["The Hawks got plucked. 🪶😼", "Bird-watching session: over. 🔭😼"],  play: ["Hawks flew high. Cats flew higher. 🦅🐾"], snark: ["Cats 1, birds 0. Nature is healing. 🐦😼", "Grounded. ✈️🚫😼"] },
    "kipp antioch": { name: "Huskies", roast: ["The Huskies got sent to the kennel. 🐶😼", "Who let the dogs out? Doesn't matter. They lost. 🐶😼"],  play: ["Raining cats and dogs (and threes). 🐾🐶"], snark: ["Cats over dogs. It's science. 🐶😼", "Cats win this argument every time. 😼"] },
    "east robertson": { name: "East Robertson" }
  };
  var ROAST_ANY = ["{opp} came to play. The Cats came to win. Different hobbies. 😼", "{opp} fans, the exit is to your left. 👋😼", "Somebody tell {opp} the bus is warmed up. 🚌😼"];
  var ROAST_PRE = ["Tonight's forecast for {opp}: 100% chance of Cats. ⛈️😼", "{opp}, it's not personal. It's just Cats season. 😼", "Somebody warn {opp}. Actually, don't. 😼"];
  function theMas(opp) { var m = mascotOf(opp); return m && m.name && norm(m.name) !== norm(opp) ? "the " + m.name : opp; } // "the Yellow Jackets", or just the school
  function roastOf(opp, pre) { var m = mascotOf(opp), own = m && (pre ? m.pre : m.roast); return own && own.length ? own : pre ? ROAST_PRE : ROAST_ANY; }
  // Kevin's own tags lead every caption (Caption settings can change them). Platform caps: X 2, Instagram 5 (hard limit), Facebook 2, TikTok 5.
  var DEFAULT_CORE = "#GreenbrierBasketball #GoBobcats";
  var TEAM_TAGS = { Girls: [], Boys: [] };
  var TAG_POOL = {
    Girls: ["#LadyCats", "#GirlsHoops", "#HerHoops"],
    Boys: ["#HSHoops", "#HoopsSZN"],
    any: ["#TNHoops", "#TSSAA", "#WeAreRCSTN"],
    tiktok: ["#basketball", "#highschoolbasketball", "#hooptok", "#tennessee"]
  };

  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pick(arr, g, key) { if (!arr || !arr.length) return ""; return arr[(hashStr(g.id + "|" + key) + (state.spin[g.id] || 0)) % arr.length]; }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function rivalsList() { var r = state.settings.rivals; return (r == null || r === "" ? DEFAULT_RIVALS : r).split(",").map(norm).filter(Boolean); }
  function isRival(opp) { return rivalsList().indexOf(norm(opp)) >= 0; }
  function mascotOf(opp) { return MASCOTS[norm(opp)] || null; }
  function cap1(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fillT(t, v) { return String(t || "").replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
  function shortDate(iso) { return fmtDate(iso, { weekday: "short", month: "short", day: "numeric" }); }

  function parseTop(top) {
    var out = [], re = /([A-Za-z][A-Za-z.'\- ]*?)\s*[-:]?\s*(\d{1,2})\b/g, m;
    while ((m = re.exec(top || ""))) out.push({ who: m[1].trim(), pts: Number(m[2]) });
    out.sort(function (a, b) { return b.pts - a.pts; });
    return out;
  }
  function tagList(s) { return String(s || "").split(/[\s,]+/).filter(function (t) { return /^#\w+/.test(t); }); }
  function tagsFor(g, tier, max, extra) {
    var core = state.settings.hashtags; var list = tagList(core == null || core === "" ? DEFAULT_CORE : core).concat(TEAM_TAGS[g.team] || []);
    if (tier !== "straight") list = list.concat(extra || []).concat([pick(TAG_POOL[g.team] || [], g, "tag1"), pick(TAG_POOL.any, g, "tag2")]);
    var seen = {}, out = [];
    list.forEach(function (t) { if (t && !seen[t.toLowerCase()] && out.length < max) { seen[t.toLowerCase()] = 1; out.push(t); } });
    return out.join(" ");
  }
  function fitX(parts) { // drop the least important pieces until it fits in 280
    var p = parts.slice();
    while (join(p.map(function (x) { return x.t; })).length > 280) {
      var drop = -1, lo = 99;
      p.forEach(function (x, i) { if (x.t && x.pri < lo) { lo = x.pri; drop = i; } });
      if (drop < 0 || lo >= 9) break;
      p[drop] = { t: "", pri: 99 };
    }
    return join(p.map(function (x) { return x.t; }));
  }

  // The situation a final describes, used to pick the mood and the lines.
  function situation(g) {
    var win = g.gb > g.opp, m = Math.abs(g.gb - g.opp), n = nick(g.team), q3 = period(g, "q3"), q2 = period(g, "q2"), q1 = period(g, "q1");
    var ot = !!period(g, "ot1") || /overtime|\bot\b/i.test(g.note || "");
    var rival = isRival(g.opponent), mas = mascotOf(g.opponent);
    var prior = allGames().filter(function (x) { return x.team === g.team && hasFinal(x) && (x.date < g.date || (x.date === g.date && (x.time || "") < (g.time || ""))); });
    var streak = 0;
    if (win) { streak = 1; for (var i = prior.length - 1; i >= 0 && prior[i].gb > prior[i].opp; i--) streak++; }
    var firstWin = win && prior.every(function (x) { return x.gb < x.opp; });
    var sweep = win && prior.some(function (x) { return norm(x.opponent) === norm(g.opponent) && x.gb > x.opp; });
    var rematch = allGames().filter(function (x) { return x.team === g.team && norm(x.opponent) === norm(g.opponent) && x.date > g.date; })[0] || null;
    var comeback = win && ((q3 && q3.gb < q3.opp) || (q2 && q2.opp - q2.gb >= 6)) ? (q3 && q3.gb < q3.opp ? q3.opp - q3.gb : q2.opp - q2.gb) : 0;
    var mood;
    if (win) mood = m >= 20 ? "rout" : m <= 5 || ot ? "thriller" : "win";
    else mood = m >= 15 ? "rough" : m <= 5 || ot ? "heartbreak" : "loss";
    var top = parseTop(g.top), lead = top[0] || null;
    var r = record(g.team, g.date, g.time);
    var nx = nextGame(g);
    var v = {
      n: n, N: n.toUpperCase(), opp: g.opponent, mas: theMas(g.opponent), Mas: cap1(theMas(g.opponent)), masV: theMas(g.opponent).replace(/^the /, ""), gb: g.gb, op: g.opp, m: m, cb: comeback,
      who: lead ? lead.who : "", pts: lead ? lead.pts : "", her: g.team === "Girls" ? "her" : "him", HER: g.team === "Girls" ? "HER" : "HIM", she: g.team === "Girls" ? "she" : "he",
      rec: r.w + "-" + r.l + (r.dw + r.dl > 0 ? " (" + r.dw + "-" + r.dl + " District 9)" : ""), k: streak,
      site: g.home_away === "Home" ? "at home" : g.home_away === "Neutral" ? "vs. " + g.opponent : "at " + g.opponent,
      rdate: rematch ? shortDate(rematch.date) : "", next: nx ? shortDate(nx.date) : ""
    };
    var story = "";
    if (ot) story = win ? "Won it in overtime." : "Fell in overtime.";
    else if (win && q3 && q3.gb < q3.opp) story = "Trailed " + q3.opp + "-" + q3.gb + " after three, then won the fourth quarter " + (g.gb - q3.gb) + "-" + (g.opp - q3.opp) + ".";
    else if (win && q3 && (g.gb - q3.gb) - (g.opp - q3.opp) >= 6) story = "Pulled away with a " + (g.gb - q3.gb) + "-" + (g.opp - q3.opp) + " fourth quarter.";
    else if (win && q1 && q1.gb - q1.opp >= 10) story = "Set the tone early, up " + q1.gb + "-" + q1.opp + " after one.";
    else if (!win && q3 && q3.gb >= q3.opp) story = "Led " + q3.gb + "-" + q3.opp + " after three.";
    return { win: win, m: m, ot: ot, rival: rival, mas: mas, streak: streak, firstWin: firstWin, sweep: sweep, rematch: rematch, comeback: comeback,
      mood: mood, top: top, lead: lead, nx: nx, v: v, story: story, home: g.home_away === "Home" };
  }

  var MOOD_NOTE = {
    rout: "Big win. The wild take gets loud.", thriller: "Close one. Lean into the drama.", win: "Solid win.",
    heartbreak: "Close loss. All three stay proud and low-key.", loss: "Loss. All three stay low-key.", rough: "Rough night. All three stay muted."
  };

  function headlineFor(g, S, tier) {
    var v = S.v, key = "h-" + tier;
    if (tier === "straight") return S.win ? n_(S) + " win " + v.site + (g.district ? " in District 9 play" : "") + "." : n_(S) + " fall " + (S.home ? "at home to " + g.opponent : v.site) + (g.district ? " in District 9 play" : "") + ".";
    var L = LINES[tier];
    var pool;
    if (!S.win) pool = S.ot ? L.lossOT : L[S.mood];
    else if (S.rival && tier === "extreme") pool = L.rivalWild; // the hardest rival lines lead; no polite sign-offs
    else if (S.rival && isW(tier)) pool = L.rivalWild.concat(S.rematch ? L.rivalRematch : L.rivalDone);
    else if (S.rival) pool = L.rival;
    else if (S.ot) pool = L.winOT;
    else if (S.comeback) pool = L.comeback;
    else pool = L[S.mood].concat((S.home ? L.home : g.home_away === "Away" ? L.road : null) || []);
    return fillT(pick(pool, g, key), v);
  }
  function n_(S) { return S.v.n; }

  function extrasFor(g, S, tier) { // streak, sweep, first win, opponent-mascot wordplay
    if (!S.win || tier === "straight") {
      if (tier === "straight" && S.win && S.sweep) return "Completes the season sweep of " + g.opponent + ".";
      return "";
    }
    var v = S.v, L = LINES[tier], out = [];
    if (S.sweep) out.push(fillT(pick(L.sweep, g, "sw"), v));
    if (S.firstWin) out.push(fillT(pick(L.firstWin, g, "fw"), v));
    else if (S.streak >= 3) out.push(fillT(pick(L.streak, g, "st"), v));
    if (S.mas && tier === "playful" && S.mas.play && !S.rival) out.push(fillT(pick(S.mas.play, g, "mp"), v));
    if (S.mas && tier === "wild") { var jab = S.rival ? S.mas.wild : S.mas.snark; if (jab) out.push(fillT(pick(jab, g, "mw"), v)); }
    if (tier === "extreme") out.push(fillT(pick(roastOf(g.opponent), g, "mx"), v));
    return out.join("\n");
  }

  function scorerFor(g, S, tier, short) {
    var v = S.v, top = (g.top || "").trim();
    if (!top) return "";
    if (tier === "straight" || !S.win || !S.lead) {
      if (!S.lead) return (short ? "" : "Top scorers: ") + top;
      return short ? S.lead.who + " " + S.lead.pts : (S.win ? "Top scorers: " + top : S.lead.who + " led the " + v.n + " with " + S.lead.pts + ".");
    }
    var L = LINES[tier], pool = S.lead.pts >= 30 ? L.big30 : S.lead.pts >= 20 ? L.big20 : L.scorer;
    var line = fillT(pick(pool, g, "sc"), v);
    return short || S.top.length < 2 ? line : line + "\nTop scorers: " + top;
  }

  function nextFor(g, S, tier) {
    var nx = S.nx;
    if (!nx) return "";
    var t = shortDate(nx.date) + " " + siteWord(nx) + " " + nx.opponent + (nx.time ? ", " + fmtTime(nx.time) : "");
    if (tier !== "straight" && isRival(nx.opponent)) return "Next up: RIVALRY NIGHT 😤 " + t;
    return "Next up: " + t;
  }

  function finalTake(g, S, tier, platform) {
    var v = S.v, head = headlineFor(g, S, tier), score = (S.win ? "Greenbrier " + g.gb + ", " + g.opponent + " " + g.opp : g.opponent + " " + g.opp + ", Greenbrier " + g.gb) + (S.ot ? " (OT)" : "");
    var recLine = SHOW_RECORDS ? v.n + (S.win ? " improve to " : " now ") + v.rec + "." : "";
    var extra = extrasFor(g, S, tier), note = (g.note || "").trim(), next = nextFor(g, S, tier);
    var L = LINES[tier] || {};
    if (platform === "x") {
      var top1 = tier === "straight" || !S.win || !S.lead ? (S.lead ? "Leading scorer: " + S.lead.who + ", " + S.lead.pts : (g.top ? "Top scorers: " + g.top : "")) : scorerFor(g, S, tier, true);
      return fitX([
        { t: (tier === "straight" ? "FINAL | " + v.n + " Basketball" : (S.win ? "FINAL 🚨 " : "FINAL | ") + head) + "\n" + score, pri: 10 },
        { t: tier === "straight" ? "" : extra, pri: 2 },
        { t: [top1, recLine].filter(Boolean).join("\n"), pri: 9 },
        { t: tagsFor(g, tier, 2), pri: 1 }
      ]);
    }
    if (platform === "tt") {
      return join([tier === "straight" ? v.n + " Basketball | FINAL\n" + score : head + "\n" + score, tier === "straight" ? "" : extra, tagsFor(g, tier, 5, TAG_POOL.tiktok)]);
    }
    var cta = tier === "straight" || !S.win || S.mood === "rough" ? "" : fillT(pick(platform === "ig" ? L.ctaIG : L.ctaFB, g, "cta-" + platform), v);
    var home = S.nx && S.nx.home_away === "Home" ? "Come out and support the " + nick(S.nx.team) + "!" : "";
    if (platform === "ig") {
      return join([
        tier === "straight" ? "FINAL | " + v.n + " Basketball" : head,
        "FINAL: " + score, S.story, extra, scorerFor(g, S, tier, false), note,
        [recLine, next].filter(Boolean).join("\n"), cta, tagsFor(g, tier, tier === "straight" ? 3 : 5)
      ]);
    }
    return join([ // Facebook: full sentences, community first
      v.n + " Basketball | FINAL", (tier === "straight" ? head : head + "\n") + " " + score + ".", S.story, extra, scorerFor(g, S, tier, false), note,
      [recLine, next ? next + "." : ""].filter(Boolean).join("\n"), home || cta, tagsFor(g, tier, 2)
    ].map(function (x) { return x.replace(/\n /g, "\n"); }));
  }

  function finalCaptions(g) {
    var S = situation(g), out = { mood: MOOD_NOTE[S.mood] + (S.rival ? (S.win ? " Rival game, so wild talks a little trash and extreme roasts the mascot." : " Rival game, but no trash talk after a loss.") + (S.win ? "" : " Extreme stays proud after a loss: no roasting when we lose.") : "") };
    ["x", "ig", "fb", "tt"].forEach(function (p) {
      out[p] = {};
      TIERS.forEach(function (t) { out[p][t.k] = finalTake(g, S, t.k, p); });
    });
    return out;
  }

  function liveCaptions(g, p) {
    var s = period(g, p.k), n = nick(g.team), d = s.gb - s.opp, ad = Math.abs(d), rival = isRival(g.opponent);
    var score = "Greenbrier " + s.gb + ", " + g.opponent + " " + s.opp;
    var shout = ((state.drafts[g.id] || {}).live_note != null ? state.drafts[g.id].live_note : (g.live_note || "")).trim();
    var toOT = d === 0 && p.ot;
    var st = toOT ? "toOT" : d === 0 ? "tied" : d >= 15 ? "bigLead" : d > 0 ? "lead" : d <= -10 ? "bigTrail" : "trail";
    var mo = mascotOf(g.opponent), v = { n: n, N: n.toUpperCase(), opp: g.opponent, mas: theMas(g.opponent), Mas: cap1(theMas(g.opponent)), masV: theMas(g.opponent).replace(/^the /, ""), d: ad, after: p.after, gb: s.gb, op: s.opp, tag: p.tag };
    var straightStatus = toOT ? "All tied up. We're headed to overtime!" : d === 0 ? "All tied up " + p.after + "." : n + (d > 0 ? " lead by " : " trail by ") + ad + " " + p.after + ".";
    var out = { straight: join([p.tag + " | " + n + " Basketball " + siteWord(g) + " " + g.opponent + "\n" + score, straightStatus + (shout ? "\n" + shout : ""), tagsFor(g, "straight", 2)]) };
    ["playful", "wild", "extreme"].forEach(function (tier) {
      var L = LIVE[tier], pool = (rival && d > 0 && L.rivalLead) ? L[st].concat(L.rivalLead) : L[st];
      if (g.home_away === "Home" && d > 0 && L.homeLead) pool = pool.concat(L.homeLead);
      var line = fillT(pick(pool, g, "live-" + p.k + "-" + tier), v);
      out[tier] = join([p.tag + " " + (isW(tier) && d > 0 ? "😼" : "🐾") + "\n" + score, line + (shout ? "\n" + shout : ""), tagsFor(g, tier, 2)]);
    });
    return out;
  }

  // ---------- Gameday and starting-lineup posts ----------
  // Gameday: one post per matchup. When both teams play the same school that night it's one combined
  // doubleheader post (Kevin's rule); different schools get their own posts. Pre-game wild takes hype us
  // and needle rival mascots, never a kid. Ticket, admission and stream lines only go on home games.
  var GD = {
    playful: {
      any: ["Cats fans, it's go time! 😺🏀", "Feline good about this one. 😺", "Rise and grind, Cats fans. 🐾☀️", "Paws up! 🐾🏀", "Mood: purr-fectly locked in. 😺🔒"],
      both: ["Double feature tonight: the {n}. 🍿🐾", "Two games, one night, zero excuses. 🐾🐾", "Twice the Cats, twice the fun. 😺😺"],
      home: ["Pack the Den tonight! 🏠🐾", "The Den is open. Come be loud. 📣🐾", "Home cooking on the menu tonight. 🏠🧑‍🍳"],
      away: ["Road trip! Cats fans, follow the bus. 🚌🐾", "Bring the green to {opp} tonight. 💚🚌", "Cats on the road. Pack a snack. 🚌🍿"],
      rival: ["Rivalry night vs. {opp}. Wear green, bring your voice. 💚📣", "It's {opp} night. You know what to do. 💚", "Circle it, underline it: rivalry night. 💚🐾"],
      opener: ["Season opener! The wait is over. 🏀😺", "Basketball is BACK. Let's go, Cats! 🏀🐾", "Opening night for the {n}. Let's get it. 💚"],
      openerOne: ["The {o} open their season tonight! 🏀😺", "Opening night for the {o}! 💚🐾"],
      district: ["District 9 play tonight. Every game counts. 🐾"],
      mascot: ["Cats vs. {mas} tonight. Pick a side (it's us). 🐾", "{mas} on the schedule. Cats on the prowl. 🐾"],
      ctaIG: ["Tag who you're bringing. 👇", "Drop a 💚 if you'll be there.", "Who's coming? 👇😺"],
      ctaFB: ["See you there, Cats fans! 💚", "Come out and support the {n}! 🐾"]
    },
    wild: {
      any: ["Lock in. 🔒😼", "The Cats are hungry. 🍽️😼", "{opp}, hope you stretched. 😼", "Clear your calendar. Cats play tonight. 😼", "Aura levels: dangerous. 😼"],
      both: ["Double dose of Cats tonight. {opp} gets two problems. 😼", "Two games. One mission. 😼"],
      home: ["Our gym. Our rules. Pack the Den. 🏠😼", "Den's open. Visitors, good luck. 😼", "Home game. Get there early, get LOUD. 📣😼"],
      away: ["Road game. We'll bring our own noise. 🚌😼", "Taking the show on the road. {opp}, get your popcorn. 🍿😼", "Business trip to {opp}. 💼😼"],
      rival: ["Rivalry night. You already know. 😤😼", "{opp} week. Circle it, underline it, show up. 😤", "It's {opp}. Enough said. 😤😼"],
      opener: ["Season opener. Somebody's about to find out. 😼", "The Cats are BACK. Act accordingly. 😼", "Opening night. Everybody's undefeated. For about two more hours. 😼"],
      openerOne: ["The {o} open their season tonight. Somebody's about to find out. 😼", "Opening night for the {o}. Act accordingly. 😼"],
      district: ["District 9 play. Every one of these matters. 😤"],
      ctaIG: ["Tag your loudest friend. 👇😼", "Be there. Be loud. 😼", "If you're not there, we'll know. 👀😼"],
      ctaFB: ["Get there early and get LOUD. 📣😼", "Bring your voice, Cats fans. You'll need it. 😼"]
    }
  };
  GD.extreme = {
    any: ["{opp}, warm up the bus. 🚌😼", "The Cats are hungry and {opp} is on the menu. 🍽️😼", "Tonight's forecast for {opp}: rough. ⛈️😼", "{opp}, lock your doors. The Cats are out. 🔒😼"],
    both: ["Two games. Two chances for {opp} to suffer. 😼", "Double feature tonight. {opp} gets the horror movie. 🎬😼"],
    home: ["Welcome to the Den, {opp}. Nobody leaves happy. 🏠😼", "Home game. Visitors, we're sorry in advance. (We're not.) 😼"],
    away: ["Road trip to {opp}. Borrowing their gym and their W. 🚌😼", "{opp}'s house tonight. Hope they cleaned up for company. 🧹😼"],
    rival: ["RIVALRY NIGHT. {opp}, we've been waiting all year. 😤😼", "{opp} week. Nobody's being polite tonight. 😤😼", "{opp}. Tonight. Bring tissues. 🧻😼", "Circle it in red: {opp} is about to have a long night. ⭕😼"],
    opener: ["Season opener. Somebody's about to be our first victim. 😼", "The Cats are BACK, and somebody has to pay for it. 😼", "Opening night. {opp}, you drew the short straw. 😼"],
    openerOne: ["The {o} open tonight. {opp}, you drew the short straw. 😼", "Opening night for the {o}. {opp}, sorry about your luck. 😼"],
    district: ["District 9 play. No friends in this district. 😤😼"],
    ctaIG: ["Tag a {opp} fan so they know what's coming. 👇😼", "Be there. Be loud. Make {opp} hear it. 📣😼"],
    ctaFB: ["Pack it out. Let {opp} hear the Den. 📣😼", "Bring your voice. {opp} is bringing theirs. Ours is louder. 😼"]
  };
  // Pre-game jabs at rival mascots for the wild take (the matchup, never a player).
  var GD_RIVAL = {
    "springfield": ["Yellow Jackets on the schedule. Bug spray: packed. 🐝😼", "Springfield's bringing the buzz. We're bringing the swatter. 🐝😼"],
    "white house": ["Blue Devils tonight. Time to paint it green. 💚😼", "The White House is in session. The Cats have the floor. 🏛️😼"],
    "white house heritage": ["Patriots tonight. The Cats are fixing to make some history of our own. 📜😼", "Heritage on deck. Let's write a new chapter. 📜😼"]
  };
  var LU = {
    playful: { any: ["Your starting five tonight. 🐾", "The Cats Five is set. 😺", "Meet tonight's starting five, purr-fessionally assembled. 😺", "Lineup locked. Let's go, {n}! 🔒🐾"],
      rival: ["Rivalry-night starting five. Let's go, {n}! 💚🐾"] },
    wild: { any: ["Starting five. Lock in. 🔒😼", "Tonight's starting five. Good luck, {opp}. 😼", "The five starting tonight. {opp}, take notes. 📝😼", "Lineup's set. Tip-off can't come soon enough. 😤"],
      rival: ["Rivalry night starters. Five reasons to show up early. 😤😼", "Your rivalry-night five. {opp}, you've been warned. 😼"] },
    extreme: { any: ["Your starting five. {opp}'s new problem. 😼", "Five Cats. One job: ruin {opp}'s night. 😼", "Starting five, locked and loaded. {masV}, good luck. You'll need it. 😼"],
      rival: ["Rivalry night five. {masV}, meet the reason your weekend is ruined. 😼", "Five Cats vs. {mas}. Somebody tell their bench to buckle up. 😼"] },
    ctaIG: ["Drop a 💚 for the starting five.", "Show the starters some love. 👇💚"],
    ctaFB: ["Let's go, {n}! 💚"]
  };

  function vis(g) { return state.filter === "all" || g.team === state.filter; }
  function nights() { var seen = {}, out = []; allGames().forEach(function (g) { if (vis(g) && !seen[g.date]) { seen[g.date] = 1; out.push(g.date); } }); return out; }
  function defaultNight(list) { var t = todayISO(); for (var i = 0; i < list.length; i++) if (list[i] >= t) return list[i]; return list.length ? list[list.length - 1] : null; }
  function groupsOn(date) {
    var groups = [];
    allGames().forEach(function (g) {
      if (g.date !== date || !vis(g)) return;
      var grp = groups.filter(function (x) { return norm(x[0].opponent) === norm(g.opponent) && x.every(function (y) { return y.team !== g.team; }); })[0];
      if (grp) grp.push(g); else groups.push([g]);
    });
    return groups;
  }
  function recordBefore(team, date) {
    var r = { w: 0, l: 0, dw: 0, dl: 0, n: 0 };
    allGames().forEach(function (g) { if (g.team !== team || !hasFinal(g) || g.date >= date) return; var w = g.gb > g.opp; r.n++; if (w) r.w++; else r.l++; if (g.district) { if (w) r.dw++; else r.dl++; } });
    return r;
  }
  function isOpener(g) { return !allGames().some(function (x) { return x.team === g.team && x.date < g.date; }); }
  function gdKey(grp) { return "gd:" + grp.map(function (g) { return g.id; }).join("+"); }
  function gymName() { return (state.settings.gym || "").trim() || "Greenbrier High School"; }
  function setting(k) { return String(state.settings[k] || "").trim(); }

  function gamedayTake(grp, tier, platform) {
    var g0 = grp[0], both = grp.length > 1, opp = g0.opponent, rival = isRival(opp), mas = mascotOf(opp);
    var K = { id: gdKey(grp), team: both ? "" : g0.team };
    var who = both ? nick("Girls") + " & " + nick("Boys") : nick(g0.team);
    var home = g0.home_away === "Home";
    var v = { n: who, N: who.toUpperCase(), opp: opp, mas: mas && norm(mas.name) !== norm(opp) ? mas.name : "" };
    var matchup = who + " " + siteWord(g0) + " " + opp;
    var times = grp.map(function (g) { return (both ? nick(g.team) + " " : "") + (fmtTime(g.time) || "time TBD"); }).join(" · ");
    var when = (both ? "" : "Tip-off ") + times;
    var where = home ? "📍 " + gymName() : g0.home_away === "Neutral" ? "📍 Neutral site" : "";
    var ev = [g0.event, grp.some(function (g) { return g.district; }) ? "District 9 game" : ""].filter(Boolean).join(" · ");
    var rr = grp.map(function (g) { var r = recordBefore(g.team, g.date); return r.n ? nick(g.team) + " " + r.w + "-" + r.l + (r.dw + r.dl ? " (" + r.dw + "-" + r.dl + " D9)" : "") : ""; });
    var recs = SHOW_RECORDS && rr.every(Boolean) ? rr.join(" · ") : ""; // only when every team in the post has a record to show
    var theme = (grp.map(function (g) { return g.theme || ""; }).filter(Boolean)[0] || "").trim();
    var adm = home && setting("admission") ? "🎟️ Admission: " + setting("admission") : "";
    var tix = home && setting("tickets") ? "🎟️ Tickets: " + setting("tickets") : "";
    var stream = home && setting("stream") ? "📺 Watch live: " + setting("stream") : "";
    var head, extra = "";
    if (tier === "straight") head = "GAMEDAY | Greenbrier Basketball";
    else {
      var L = GD[tier], pool;
      var openers = grp.filter(isOpener);
      v.o = openers.map(function (g) { return nick(g.team); }).join(" & ");
      if (rival && tier === "extreme") pool = L.rival; // rivalry beats everything, even opening night
      else if (openers.length === grp.length) pool = L.opener;
      else if (openers.length) pool = L.openerOne;
      else if (rival) pool = L.rival;
      else pool = L.any.concat(both ? L.both : []).concat(home ? L.home : g0.home_away === "Away" ? L.away : []).concat(grp.some(function (g) { return g.district; }) ? L.district : []);
      head = "GAMEDAY | " + fillT(pick(pool, K, "gd-h-" + tier), v);
      if (tier === "extreme") extra = fillT(pick(roastOf(opp, true), K, "gd-x"), v);
      else if (tier === "wild" && rival && GD_RIVAL[norm(opp)]) extra = pick(GD_RIVAL[norm(opp)], K, "gd-r");
      else if (tier === "playful" && v.mas && !rival) extra = fillT(pick(L.mascot, K, "gd-m"), v);
    }
    var tags = function (max, more) { return tagsFor(K, tier, max, more); };
    if (platform === "x") {
      return fitX([
        { t: head + "\n" + matchup + "\n" + when, pri: 10 },
        { t: ev, pri: 4 }, { t: extra, pri: 2 }, { t: theme, pri: 8 }, { t: recs ? "Records: " + recs : "", pri: 3 },
        { t: [tix || adm, stream].filter(Boolean).join("\n"), pri: 6 }, { t: tags(2), pri: 1 }
      ]);
    }
    if (platform === "tt") return join([head + "\n" + matchup + "\n" + when, theme, extra, tags(5, TAG_POOL.tiktok)]);
    var Lc = GD[tier] || {};
    var cta = tier === "straight" ? (platform === "fb" && home ? "Come out and support the " + who + "!" : "") : fillT(pick(platform === "ig" ? Lc.ctaIG : Lc.ctaFB, K, "gd-cta-" + platform), v);
    return join([
      head, matchup + "\n" + when + (where ? "\n" + where : ""), ev, extra, theme, recs ? "Records: " + recs : "",
      [adm, tix, stream].filter(Boolean).join("\n"), cta, tags(platform === "ig" ? (tier === "straight" ? 3 : 5) : 2)
    ]);
  }
  function gamedayCaptions(grp) {
    var out = {};
    ["x", "ig", "fb", "tt"].forEach(function (p) { out[p] = {}; TIERS.forEach(function (t) { out[p][t.k] = gamedayTake(grp, t.k, p); }); });
    return out;
  }

  // Players: "3 Jane Smith Sr G", "#3, Jane Smith, 12", or tab-separated from a spreadsheet. Heights are ignored.
  var GRADES = { sr: "Sr.", senior: "Sr.", "12": "Sr.", "12th": "Sr.", jr: "Jr.", junior: "Jr.", "11": "Jr.", "11th": "Jr.",
    so: "So.", soph: "So.", sophomore: "So.", "10": "So.", "10th": "So.", fr: "Fr.", fresh: "Fr.", freshman: "Fr.", "9": "Fr.", "9th": "Fr.", "8": "8th", "8th": "8th" };
  function parsePlayer(line) {
    var s = String(line || "").replace(/[\t,;|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return null;
    var m = s.match(/^(?:no\.?\s*|#\s*)?(\d{1,2})\b[\s.:-]*(.*)$/i), n = "", rest = s;
    if (m) { n = String(Number(m[1])); rest = m[2]; }
    var parts = rest.split(" ").filter(Boolean), gr = "", pos = "";
    while (parts.length > 1) {
      var t = parts[parts.length - 1], tl = t.toLowerCase().replace(/\.$/, "");
      if (!gr && GRADES[tl]) { gr = GRADES[tl]; parts.pop(); }
      else if (!pos && /^(g|f|c|w|pg|sg|sf|pf|g\/f|f\/c|g-f|f-c|guard|forward|center|post|wing)$/.test(tl)) { pos = t.length <= 4 ? t.toUpperCase() : cap1(tl); parts.pop(); }
      else if (/^\d['-]\d{1,2}"?$/.test(t) || /^\d{1,2}(\.\d)?$/.test(t) && parts.length > 2) parts.pop();
      else break;
    }
    var name = parts.join(" ").replace(/^[-–:]+\s*/, "");
    if (!name && !n) return null;
    return { n: n, name: name, gr: gr, pos: pos };
  }
  function parseList(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (lines.length === 1 && /,/.test(lines[0])) { var bits = lines[0].split(","); if (bits.length >= 5 || bits.every(function (b) { return /^\s*#?\d{1,2}\s*$/.test(b); })) lines = bits; }
    return lines.map(parsePlayer).filter(Boolean);
  }
  function lastName(p) { var w = String(p.name || "").split(" "); return w[w.length - 1].toLowerCase(); }
  function enrich(team, p) { // fill in a number-only or last-name-only starter from the roster
    var ros = state.rosters[team] || [], hit = null;
    if (p.n) hit = ros.filter(function (r) { return r.n === p.n; })[0];
    if (!hit && p.name) hit = ros.filter(function (r) { return r.name.toLowerCase() === p.name.toLowerCase(); })[0] || (ros.filter(function (r) { return lastName(r) === lastName(p); }).length === 1 ? ros.filter(function (r) { return lastName(r) === lastName(p); })[0] : null);
    if (!hit) return p;
    return { n: p.n || hit.n, name: p.name && p.name.split(" ").length > 1 ? p.name : hit.name || p.name, gr: p.gr || hit.gr, pos: p.pos || hit.pos };
  }
  function playerLine(p, detail) {
    var bits = detail ? [p.gr, p.pos].filter(Boolean) : [];
    return (p.n ? "#" + p.n + " " : "") + (p.name || "") + (bits.length ? " (" + bits.join(", ") + ")" : "");
  }
  function playersText(list) { return (list || []).map(function (p) { return [p.n, p.name, p.gr, p.pos].filter(Boolean).join(" "); }).join("\n"); }
  function lastStarters(g) {
    var prev = allGames().filter(function (x) { return x.team === g.team && (x.date < g.date) && x.starters && x.starters.length; });
    return prev.length ? prev[prev.length - 1] : null;
  }

  function lineupTake(g, tier, platform) {
    var five = (g.starters || []).map(function (p) { return enrich(g.team, p); });
    var n = nick(g.team), rival = isRival(g.opponent), mo = mascotOf(g.opponent), v = { n: n, N: n.toUpperCase(), opp: g.opponent, mas: theMas(g.opponent), Mas: cap1(theMas(g.opponent)), masV: theMas(g.opponent).replace(/^the /, "") };
    var head = tier === "straight" ? "STARTING FIVE | " + n + " Basketball" :
      fillT(pick(LU[tier].any.concat(rival ? LU[tier].rival : []), g, "lu-" + tier), v);
    var match = siteWord(g) + " " + g.opponent + (g.time ? " · Tip-off " + fmtTime(g.time) : "");
    var list = five.map(function (p) { return playerLine(p, platform !== "x" && platform !== "tt"); }).join("\n");
    if (platform === "x") return fitX([{ t: head + "\n" + match, pri: 10 }, { t: list, pri: 9 }, { t: tagsFor(g, tier, 2), pri: 1 }]);
    if (platform === "tt") return join([head + "\n" + match, list, tagsFor(g, tier, 5, TAG_POOL.tiktok)]);
    var cta = tier === "straight" ? "" : fillT(pick(platform === "ig" ? LU.ctaIG : LU.ctaFB, g, "lu-cta-" + platform), v);
    return join([head, n + " " + match, list, cta, tagsFor(g, tier, platform === "ig" ? (tier === "straight" ? 3 : 5) : 2)]);
  }
  function lineupCaptions(g) {
    var out = {};
    ["x", "ig", "fb", "tt"].forEach(function (p) { out[p] = {}; TIERS.forEach(function (t) { out[p][t.k] = lineupTake(g, t.k, p); }); });
    return out;
  }

  // "Copy the week": every gameday post for seven days from the night on screen, one platform and one take,
  // stacked with date headers so it can go straight into Gipper's Content Planner or TikTok's scheduler.
  function weekText(start, platform, tier) {
    var end = new Date(dateObj(start).getTime() + 6 * 864e5).toISOString().slice(0, 10), out = [];
    nights().forEach(function (d) {
      if (d < start || d > end) return;
      groupsOn(d).forEach(function (grp) {
        out.push("━━ " + fmtDate(d, { weekday: "long", month: "short", day: "numeric" }).toUpperCase() + " · " + grp.map(function (g) { return nick(g.team); }).join(" & ") + " " + siteWord(grp[0]) + " " + grp[0].opponent + " ━━\n" + gamedayTake(grp, tier, platform));
      });
    });
    return out.join("\n\n\n");
  }

  // ---------- Graphics (canvas) ----------
  // Built on the approved football "Steel Chevron" look: same background, chrome lettering and slanted score rows.
  // Player cut-outs are measured from their transparency so text is only ever laid out in the empty space beside the kid.
  var GV = {
    feed:  { W: 1080, H: 1350, bg: "bgFeed", hdr: 44, hfs: 42, sp: 1244, spH: 84, pTop: 118, pBot: 1334, tTop: 140, tBot: 1222, scrim: [[0, .55], [.18, .25], [.7, .25], [1, .7]] },
    story: { W: 1080, H: 1920, bg: "bgStory", hdr: 140, hfs: 60, sp: 1676, spH: 100, pTop: 250, pBot: 1710, tTop: 250, tBot: 1650, scrim: [[0, .6], [.2, .3], [.75, .3], [1, .75]] },
    // X/Twitter 16:9: the one shape the timeline never crops (phone, desktop or link previews). Player on one side, text on the other.
    wide:  { W: 1600, H: 900, bg: "bgFeed", hdr: 30, hfs: 34, sp: 822, spH: 62, pTop: 74, pBot: 892, tTop: 84, tBot: 806, wcap: .42, scrim: [[0, .55], [.15, .25], [.75, .25], [1, .7]] }
  };
  function sk(size, story, wide) { return size === "story" ? story : size === "wide" ? wide : 1; } // per-size type scale
  var GFX = { ready: null, img: {}, photos: {}, wcap: .66 };
  var SOFT = "#c9d1cc", GREEN = "#094A28";
  var MON = ["JAN.", "FEB.", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUG.", "SEPT.", "OCT.", "NOV.", "DEC."];
  var DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  function gDate(iso) { var d = dateObj(iso); return DAYS[d.getUTCDay()] + ", " + MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function loadImg(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error("image " + src)); }; i.src = src; }); }
  function gfxReady() {
    if (!GFX.ready) GFX.ready = Promise.all([["f700", { weight: "700" }], ["f900", { weight: "900" }], ["f900i", { weight: "900", style: "italic" }]].map(function (f) {
      var ff = new FontFace("BC", "url(gfx/" + f[0] + ".woff2)", f[1]); return ff.load().then(function () { document.fonts.add(ff); });
    }).concat(["bgFeed.jpg", "bgStory.jpg", "logoCat.png", "logoG.png"].map(function (n) { return loadImg("gfx/" + n).then(function (i) { GFX.img[n.split(".")[0]] = i; }); })))
      .catch(function (e) { GFX.ready = null; throw e; });
    return GFX.ready;
  }
  // A stored photo, plus a 160px-wide map of where the player is (one opaque span per row).
  function photoImg(id) {
    if (!GFX.photos[id]) GFX.photos[id] = imgUrl(id).then(loadImg)
      .then(function (im) { return { img: im, m: maskOf(im) }; })
      .catch(function (e) { delete GFX.photos[id]; throw e; });
    return GFX.photos[id];
  }
  function imgUrl(id) { return window.__SOC ? window.__SOC.img(id) : Promise.reject(new Error("no Brier Stats")); }
  // Library thumbnails: drawn small once, so a page of photos doesn't hold every full-size picture.
  var THUMB = {};
  function paintThumbs() {
    document.querySelectorAll("img[data-limg]").forEach(function (im) {
      var id = im.dataset.limg;
      if (!THUMB[id]) THUMB[id] = imgUrl(id).then(loadImg).then(function (i) {
        var k = Math.min(1, 320 / Math.max(i.width, i.height)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(i.width * k)); c.height = Math.max(1, Math.round(i.height * k));
        c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); return c.toDataURL("image/png");
      }).catch(function (e) { delete THUMB[id]; throw e; });
      THUMB[id].then(function (u) { if (im.getAttribute("src") !== u) im.src = u; }, function () { im.alt = "Couldn't load"; });
    });
  }
  function maskOf(im) {
    var w = 160, h = Math.max(1, Math.round(160 * im.height / im.width)), rows = [], top = -1, bot = -1, l = w, r = -1, d;
    try { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d"); x.drawImage(im, 0, 0, w, h); d = x.getImageData(0, 0, w, h).data; }
    catch (e) { for (var k = 0; k < h; k++) rows.push([0, 1]); return { rows: rows, box: [0, 0, 1, 1], head: .5 }; }
    for (var y = 0; y < h; y++) {
      var a = -1, b = -1;
      for (var i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 128) { if (a < 0) a = i; b = i; }
      rows.push(a < 0 ? null : [a / w, (b + 1) / w]);
      if (a >= 0) { if (top < 0) top = y; bot = y; l = Math.min(l, a); r = Math.max(r, b); }
    }
    var opaque = [0, w - 1, (h - 1) * w, h * w - 1].every(function (q) { return d[q * 4 + 3] > 250; }); // a JPG or any photo with a real background
    if (top < 0) return { rows: rows, box: [0, 0, 1, 1], head: .5 };
    var hs = 0, hn = 0, lim = top + Math.max(2, Math.round((bot - top) * .08));
    for (y = top; y <= lim; y++) if (rows[y]) { hs += (rows[y][0] + rows[y][1]) / 2; hn++; }
    // Cropped-off feet: the kid runs into the photo's bottom edge with real width there (not a stray pixel or a toe tip).
    var ec = 0; for (y = Math.max(0, h - 2); y < h; y++) for (i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 128) ec++;
    var cut = bot >= h - 1 && ec / 2 >= Math.max(6, (r - l + 1) * .12);
    return { rows: rows, box: [l / w, top / h, (r + 1) / w, (bot + 1) / h], head: hn ? hs / hn : (l + r) / 2 / w, cut: cut, opaque: opaque };
  }

  function noShadow(ctx) { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
  function shadow(ctx, col, blur, dy) { ctx.shadowColor = col; ctx.shadowBlur = blur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = dy || 0; }
  function spacedW(ctx, t, ls) { var ch = Array.from(t); return ch.reduce(function (a, c) { return a + ctx.measureText(c).width; }, 0) + ls * Math.max(0, ch.length - 1); }
  function spaced(ctx, t, x, y, ls, align) {
    var w = spacedW(ctx, t, ls), cx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.textAlign = "left"; Array.from(t).forEach(function (c) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + ls; }); return w;
  }
  function fit(ctx, font, t, max, maxW, min, ls) { // largest size <= max whose width fits maxW
    var s = max; ctx.font = font.replace("#", s);
    var w = spacedW(ctx, t, (ls || 0) * s); if (w > maxW) s = Math.max(min || 10, Math.floor(s * maxW / w));
    ctx.font = font.replace("#", s); return s;
  }
  function para(ctx, x, y, w, h, dx, dy) { var s = Math.tan(12 * Math.PI / 180) * h / 2; dx = dx || 0; dy = dy || 0; ctx.beginPath(); ctx.moveTo(x + s + dx, y + dy); ctx.lineTo(x + w + s + dx, y + dy); ctx.lineTo(x + w - s + dx, y + h + dy); ctx.lineTo(x - s + dx, y + h + dy); ctx.closePath(); }
  function chrome(ctx, t, x, y, fs, align, muted) {
    ctx.font = "italic 900 " + fs + "px BC"; ctx.textAlign = align || "left";
    if (muted) { shadow(ctx, "rgba(0,0,0,.8)", 16, 4); ctx.fillStyle = "#d5ddd8"; ctx.fillText(t, x, y); noShadow(ctx); return; }
    ctx.fillStyle = "#0c4a2a"; shadow(ctx, "rgba(110,255,170,.32)", 26); ctx.fillText(t, x, y);
    ctx.shadowColor = "rgba(0,0,0,.75)"; ctx.shadowBlur = 26; ctx.shadowOffsetX = .07 * fs; ctx.shadowOffsetY = .09 * fs; ctx.fillText(t, x, y); noShadow(ctx);
    ctx.fillStyle = "#03170c"; for (var i = Math.max(4, Math.round(fs * .05)); i >= 1; i--) ctx.fillText(t, x + i, y + i);
    var top = y - .82 * fs, g = ctx.createLinearGradient(0, top, 0, top + .84 * fs);
    [[0, "#ffffff"], [.30, "#ffffff"], [.44, "#dfe8e2"], [.52, "#8fa398"], [.57, "#eef3f0"], [.76, "#ffffff"], [1, "#b9c7bf"]].forEach(function (p) { g.addColorStop(p[0], p[1]); });
    ctx.fillStyle = g; ctx.fillText(t, x, y); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.strokeText(t, x, y);
  }
  function scoreRow(ctx, x, top, w, h, mine, name, score, muted) {
    if (mine) {
      ctx.fillStyle = "rgba(160,160,160,.8)"; para(ctx, x, top, w, h, 10, 12); ctx.fill();
      var g = ctx.createLinearGradient(0, top, 0, top + h); [[0, "#ffffff"], [.48, "#f3f6f4"], [.52, "#cdd6d0"], [1, "#e9eeeb"]].forEach(function (p) { g.addColorStop(p[0], p[1]); });
      if (!muted) shadow(ctx, "rgba(150,255,195,.4)", 34); ctx.fillStyle = g; para(ctx, x, top, w, h); ctx.fill(); noShadow(ctx);
    } else {
      ctx.fillStyle = "rgba(0,0,0,.45)"; para(ctx, x, top, w, h, 10, 12); ctx.fill();
      var g2 = ctx.createLinearGradient(0, top, 0, top + h); g2.addColorStop(0, "rgba(4,26,14,.92)"); g2.addColorStop(1, "rgba(1,12,6,.92)");
      ctx.fillStyle = g2; para(ctx, x, top, w, h); ctx.fill(); ctx.strokeStyle = "#cfd6d2"; ctx.lineWidth = 2; ctx.stroke();
    }
    var cy = top + h / 2, sc = Math.round(h * .86), pad = Math.round(h * .42);
    ctx.fillStyle = mine ? GREEN : "#fff"; if (!mine) shadow(ctx, "rgba(0,0,0,.8)", 10, 3);
    ctx.font = "italic 900 " + sc + "px BC"; ctx.textAlign = "right"; var sw = ctx.measureText(String(score)).width; ctx.fillText(String(score), x + w - pad, cy + .38 * sc);
    var nfs = fit(ctx, "900 #px BC", name, Math.round(h * .58), w - pad * 2 - sw - 30, 22, .03);
    spaced(ctx, name, x + pad, cy + .37 * nfs, .03 * nfs); noShadow(ctx);
  }
  function base(v, muted, label) {
    var c = document.createElement("canvas"); c.width = v.W; c.height = v.H; var ctx = c.getContext("2d"); ctx.textBaseline = "alphabetic";
    // Background scales to cover the canvas; one tall photo serves both feed and story (crop leans toward the top so the hoop stays in).
    var bi = GFX.img[v.bg], bs = Math.max(v.W / bi.width, v.H / bi.height), bw = bi.width * bs, bh = bi.height * bs;
    ctx.drawImage(bi, (v.W - bw) / 2, (v.H - bh) * 0.4, bw, bh);
    var g = ctx.createLinearGradient(0, 0, 0, v.H); v.scrim.forEach(function (p) { g.addColorStop(p[0], "rgba(1,12,6," + p[1] + ")"); }); ctx.fillStyle = g; ctx.fillRect(0, 0, v.W, v.H);
    if (muted) { ctx.fillStyle = "rgba(3,9,6,.5)"; ctx.fillRect(0, 0, v.W, v.H); }
    ctx.font = "700 " + v.hfs + "px BC"; shadow(ctx, "rgba(0,0,0,.9)", 12, 2); ctx.fillStyle = "#fff"; if (spacedW(ctx, label, v.hfs * .29) > v.W - 100) fit(ctx, "700 #px BC", label, v.hfs, v.W - 100, 30, .29); spaced(ctx, label, v.W / 2, v.hdr + v.hfs, parseInt(ctx.font.match(/(\d+)px/)[1], 10) * .29, "center");
    noShadow(ctx);
    return { c: c, ctx: ctx };
  }
  // The sponsor strip sits in the same reserved band on every graphic. No sponsor picked: #GOBOBCATS in that band instead.
  // The hashtag line at the bottom of graphics (and the TikTok tag card). Kevin sets it in the Library; blank = #GOBOBCATS.
  // Two free-text lines (Kevin, 2026-11-17): e.g. a tagline on line 1 and hashtags on line 2. One blank line = a single line.
  function stripLines() { var a = [state.settings.strip_tag, state.settings.strip_tag2].map(function (t) { return String(t || "").trim().toUpperCase(); }).filter(Boolean); return a.length ? a : ["#GOBOBCATS"]; }
  function stripTag() { return stripLines().join(" / "); }
  function sponsorStrip(ctx, v, sp, free) {
    var cy = v.sp + v.spH / 2, span = free ? free(v.sp, v.sp + v.spH) : [0, v.W], cx = (span[0] + span[1]) / 2;
    if (sp === false) return;
    if (!sp) {
      var lines = stripLines(), two = lines.length > 1, sizes = two ? [Math.round(Math.min(34, v.spH * .4)), Math.round(Math.min(26, v.spH * .3))] : [34];
      var drawn = lines.map(function (tg, i) { // long text shrinks to fit the width
        var fs = sizes[i], ls = fs * .26; ctx.font = "700 " + fs + "px BC"; var tw = spacedW(ctx, tg, ls);
        if (tw > v.W - 80) { fs = fit(ctx, "700 #px BC", tg, fs, v.W - 80, 14, .12); ls = fs * .12; tw = spacedW(ctx, tg, ls); }
        return { t: tg, fs: fs, ls: ls, tw: tw };
      });
      var gapL = two ? Math.round(v.spH * .1) : 0, tot = drawn.reduce(function (a, d) { return a + d.fs * .74; }, 0) + gapL, y = cy - tot / 2;
      shadow(ctx, "rgba(0,0,0,.9)", 12, 2);
      drawn.forEach(function (d, i) {
        y += d.fs * .74; ctx.font = "700 " + d.fs + "px BC"; ctx.fillStyle = i ? SOFT : "rgba(255,255,255,.95)";
        var tx = Math.max(40 + d.tw / 2, Math.min(v.W - 40 - d.tw / 2, cx)); spaced(ctx, d.t, tx, y, d.ls, "center"); y += gapL;
      });
      noShadow(ctx); return;
    }
    var ph = v.spH, maxW = 460, r = sp.width / sp.height, lw = Math.min(maxW - 36, (ph - 20) * r), lh = lw / r, pw = lw + 36;
    ctx.font = "700 26px BC"; var lab = "PRESENTED BY", lw2 = spacedW(ctx, lab, 6), gap = 22, tot = lw2 + gap + pw, x0 = Math.max(36, Math.min(v.W - 36 - tot, cx - tot / 2));
    ctx.fillStyle = "#fff"; shadow(ctx, "rgba(0,0,0,.9)", 10, 2); spaced(ctx, lab, x0, cy + 9, 6); noShadow(ctx);
    var px = x0 + lw2 + gap; shadow(ctx, "rgba(0,0,0,.55)", 18, 6); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, v.sp, pw, ph, 12) : ctx.rect(px, v.sp, pw, ph); ctx.fill(); noShadow(ctx);
    ctx.drawImage(sp, px + (pw - lw) / 2, v.sp + (ph - lh) / 2, lw, lh);
  }
  // Places a cut-out between top and bottom on one side. Returns free(y0, y1) -> [x0, x1], the span text may use on those lines.
  function hero(ctx, v, ph, side, top, bottom) {
    var im = ph.img, m = ph.m, bh = (m.box[3] - m.box[1]) * im.height, bw = (m.box[2] - m.box[0]) * im.width;
    if (m.cut) bottom = v.H; // feet cropped in the photo: run the cut edge off the bottom of the graphic so no legs end mid-air
    var s = (bottom - top) / bh; var cap = v.wcap || GFX.wcap; if (bw * s > v.W * cap) s = v.W * cap / bw;
    var dw = im.width * s, dh = im.height * s, ox = side === "left" ? 18 - m.box[0] * dw : v.W - 18 - m.box[2] * dw, oy = bottom - m.box[3] * dh;
    var gx = side === "left" ? ox + (m.box[0] + m.box[2]) / 2 * dw : ox + (m.box[0] + m.box[2]) / 2 * dw, rg = ctx.createRadialGradient(gx, oy + m.box[1] * dh + bh * s * .45, 0, gx, oy + m.box[1] * dh + bh * s * .45, bh * s * .6);
    rg.addColorStop(0, "rgba(120,255,175,.22)"); rg.addColorStop(1, "rgba(120,255,175,0)"); ctx.fillStyle = rg; ctx.fillRect(0, 0, v.W, v.H);
    ctx.save(); shadow(ctx, "rgba(0,0,0,.7)", 44, 20); ctx.drawImage(im, ox, oy, dw, dh); ctx.restore();
    var n = m.rows.length, bt = m.box[1], bb = m.box[3];
    var freeFn = function (y0, y1) {
      var lim = side === "left" ? 0 : v.W;
      for (var y = y0; y <= y1; y += 3) {
        var ry = Math.floor((y - oy) / dh * n); if (ry < 0 || ry >= n || !m.rows[ry]) continue;
        lim = side === "left" ? Math.max(lim, ox + m.rows[ry][1] * dw) : Math.min(lim, ox + m.rows[ry][0] * dw);
      }
      return side === "left" ? [Math.max(48, lim - 22), v.W - 48] : [48, Math.min(v.W - 48, lim + 22)];
    };
    // Head to chest (roughly through the jersey number) stays clear: wide blocks that would cover it drop below it (Kevin 2026-11-13).
    freeFn.guard = [oy + bt * dh, oy + (bt + (m.cut ? .5 : .42) * (bb - bt)) * dh];
    return freeFn;
  }
  // Green logo on a dark green gym needs a soft light halo behind it to read.
  function logoGlow(ctx, im, x, y, w, h) {
    var cx = x + w / 2, cy = y + h / 2, rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * .75);
    rg.addColorStop(0, "rgba(160,255,200,.28)"); rg.addColorStop(1, "rgba(160,255,200,0)"); ctx.fillStyle = rg; ctx.fillRect(x - w, y - h, w * 3, h * 3);
    shadow(ctx, "rgba(0,0,0,.8)", 30, 14); ctx.drawImage(im, x, y, w, h); noShadow(ctx);
  }
  function shieldHero(ctx, v, side, top, bottom) {
    var lg = GFX.img.logoCat, w = v.W * (v.wcap ? .3 : .44), h = w * lg.height / lg.width, x = side === "left" ? 40 : v.W - 40 - w, y = top + (Math.min(bottom, v.sp) - top - h) / 2;
    logoGlow(ctx, lg, x, y, w, h);
    return function (y0, y1) { var hit = y1 > y - 20 && y0 < y + h + 20; return !hit ? [56, v.W - 56] : side === "left" ? [x + w + 34, v.W - 56] : [56, x - 34]; };
  }
  // Text column that flows down the free side. Each block measures itself against the free span on its own lines.
  function column(ctx, free, side) {
    var api = { y: 0, align: side === "left" ? "right" : "left", marks: [] };
    api.mark = function (x0, x1, y0, y1) { api.marks.push([x0, x1, y0, y1]); };
    api.span = function (h) { return free(api.y - h, api.y + 8); };
    api.x = function (sp) { return api.align === "left" ? sp[0] : sp[1]; };
    api.chrome = function (t, max, muted) { var sp = free(api.y, api.y + max), fs = fit(ctx, "italic 900 #px BC", t, max, sp[1] - sp[0] - .1 * max, 40); api.y += fs * .86; sp = api.span(fs * .8); chrome(ctx, t, api.align === "left" ? sp[0] : sp[1] - .06 * fs, api.y, fs, api.align, muted); api.y += fs * .14; return fs; };
    api.text = function (t, font, max, color, ls, min) { var sp = free(api.y, api.y + max), fs = fit(ctx, font, t, max, sp[1] - sp[0], min || 18, ls); api.y += fs; ctx.fillStyle = color; shadow(ctx, "rgba(0,0,0,.85)", 10, 2); spaced(ctx, t, api.x(api.span(fs)), api.y, (ls || 0) * fs, api.align); noShadow(ctx); return fs; };
    api.wrap = function (t, font, max, color, ls, lines) { // up to `lines` lines, shrinking only if a single word won't fit
      var sp = free(api.y, api.y + max * lines), maxW = sp[1] - sp[0], fs = max, words = t.split(" "), out;
      for (; fs >= 30; fs -= 4) { ctx.font = font.replace("#", fs); out = []; var cur = "";
        words.forEach(function (w) { var tryT = cur ? cur + " " + w : w; if (spacedW(ctx, tryT, (ls || 0) * fs) <= maxW || !cur) cur = tryT; else { out.push(cur); cur = w; } }); out.push(cur);
        if (out.length <= lines && out.every(function (l) { return spacedW(ctx, l, (ls || 0) * fs) <= maxW; })) break; }
      out.forEach(function (l) { api.text(l, font, fs, color, ls, 18); api.y += fs * .06; }); return fs;
    };
    api.pill = function (t, fs) { ctx.font = "900 " + fs + "px BC"; var sp = free(api.y, api.y + fs * 1.6), w = Math.min(sp[1] - sp[0], spacedW(ctx, t, .04 * fs) + fs * 1.1), h = fs * 1.45, x = api.align === "left" ? sp[0] : sp[1] - w;
      if (spacedW(ctx, t, .04 * fs) + fs * 1.1 > w) fit(ctx, "900 #px BC", t, fs, w - fs * 1.1, 16, .04);
      shadow(ctx, "rgba(0,0,0,.5)", 14, 4); ctx.fillStyle = "#fff"; para(ctx, x + 6, api.y, w - 12, h); ctx.fill(); noShadow(ctx);
      ctx.fillStyle = GREEN; spaced(ctx, t, x + w / 2, api.y + h * .5 + parseInt(ctx.font.match(/(\d+)px/)[1], 10) * .36, .04 * fs, "center"); api.y += h; };
    api.bar = function (t, fs) { var sp = free(api.y, api.y + fs * 1.6), h = fs * 1.5, w = sp[1] - sp[0]; if (ctx.canvas.width > 1200 && w > 760) { sp = api.align === "left" ? [sp[0], sp[0] + 760] : [sp[1] - 760, sp[1]]; w = 760; } /* 16:9: no bar running the whole width */ ctx.fillStyle = "rgba(9,74,40,.92)"; ctx.fillRect(sp[0], api.y, w, h); ctx.fillStyle = "#cfd6d2"; ctx.fillRect(api.align === "left" ? sp[0] : sp[1] - 8, api.y, 8, h);
      var s = fit(ctx, "900 #px BC", t, fs, w - 40, 16, .05); ctx.fillStyle = "#fff"; spaced(ctx, t, api.align === "left" ? sp[0] + 24 : sp[1] - 24, api.y + h / 2 + s * .36, .05 * s, api.align); api.y += h; };
    api.gap = function (h) { api.y += h; };
    return api;
  }
  function teamLabel(teams) { return teams.length > 1 ? "GREENBRIER BASKETBALL" : nick(teams[0]).toUpperCase() + " BASKETBALL"; }

  // GAMEDAY: one hero, text in the open space.
  // Lays the column out once on scratch paper to measure it, then for real, centred in the open space.
  function flow(ctx, free, side, y0, y1, lay) {
    function probe(y) { var sc = document.createElement("canvas"); sc.width = ctx.canvas.width; sc.height = ctx.canvas.height; var m = column(sc.getContext("2d"), free, side); m.y = y; lay(m, sc.getContext("2d")); return m; }
    var m = probe(y0), pos = y0 + Math.max(0, Math.min(ctx.canvas.height > 1500 ? 340 : 140, (y1 - m.y) / 2)), g = free.guard;
    if (g) { // a block too wide for the open side would cover the kid's head or number: start the column lower so it clears the chest
      m = probe(pos); var sh = 0;
      m.marks.forEach(function (r) {
        if (r[3] <= g[0] || r[2] >= g[1]) return;
        var sp = free(Math.max(r[2], g[0]), Math.min(r[3], g[1]));
        if (side === "left" ? r[0] < sp[0] - 1 : r[1] > sp[1] + 1) sh = Math.max(sh, g[1] - r[2] + 8);
      });
      if (sh) pos += Math.max(0, Math.min(sh, y1 - m.y));
    }
    var col = column(ctx, free, side); col.y = pos; lay(col, ctx);
  }
  // Wide (16:9) has room to spare sideways but little height: take the biggest type scale whose column still fits top to bottom.
  function fitK(ctx, free, side, y0, y1, hi, lo, layK) {
    for (var k = hi; k > lo; k -= .04) { var sc = document.createElement("canvas"); sc.width = ctx.canvas.width; sc.height = ctx.canvas.height; var m = column(sc.getContext("2d"), free, side); m.y = y0; layK(k)(m, sc.getContext("2d")); if (m.y <= y1) return k; }
    return lo;
  }
  function drawGameday(size, grp, o) {
    o = o || {}; var ph = o.ph, side = o.side || "right";
    var v = GV[size], g0 = grp[0], B = base(v, false, teamLabel(grp.map(function (g) { return g.team; }))), ctx = B.ctx;
    var top = v.pTop, bottom = v.pBot, free = ph ? hero(ctx, v, ph, side, top, bottom) : shieldHero(ctx, v, side, top, bottom);
    var where = g0.home_away === "Home" ? gymName().toUpperCase() : g0.event ? g0.event.toUpperCase() : "";
    var theme = (grp.map(function (g) { return g.theme || ""; }).filter(Boolean)[0] || "").toUpperCase(), wide = size === "wide";
    var layK = function (k) { return function (col) {
      if (wide) { col.chrome("GAMEDAY", 190 * k); col.gap(18 * k); } /* 16:9 is short: one line buys the height for bigger type below */
      else { col.chrome("GAME", 240 * k); col.chrome("DAY", 240 * k); col.gap(26 * k); }
      col.text(g0.home_away === "Away" ? "AT" : "VS.", "italic 900 #px BC", (wide ? 54 : 46) * k, SOFT, .06);
      col.gap(4); col.wrap(g0.opponent.toUpperCase(), "900 #px BC", (wide ? 104 : 92) * k, "#fff", .02, 2); col.gap(22 * k);
      grp.forEach(function (g) { col.pill((grp.length > 1 ? nick(g.team).toUpperCase() + "  " : "TIP-OFF  ") + (fmtTime(g.time) || "TBA"), (wide ? 60 : 38) * k); col.gap(12 * k); });
      col.gap(8 * k); col.text(gDate(g0.date), "700 #px BC", (wide ? 54 : 40) * k, "#fff", .1);
      if (where) { col.gap(8); col.text(where, "700 #px BC", (wide ? 40 : 30) * k, SOFT, .1); }
      if (theme) { col.gap(26 * k); col.bar(theme, (wide ? 48 : 36) * k); }
    }; };
    var k = wide ? fitK(ctx, free, side, v.tTop, v.tBot, 1, .7, layK) : sk(size, 1.12, 1);
    flow(ctx, free, side, v.tTop, v.tBot, layK(k));
    sponsorStrip(ctx, v, o.sponsor, free);
    return B.c;
  }
  // FINAL: hero (optional), chrome FINAL, the two slanted score rows sized to the open space. A loss is muted, like football.
  function drawFinal(size, g, o) {
    o = o || {}; var ph = o.ph, side = o.side || "right";
    var v = GV[size], win = g.gb > g.opp, muted = !win, B = base(v, muted, teamLabel([g.team])), ctx = B.ctx, lead = parseTop(g.top)[0];
    if (!ph) {
      var sub = [period(g, "ot2") ? "DOUBLE OVERTIME" : period(g, "ot1") ? "OVERTIME" : "", lead && win ? lead.who.toUpperCase() + " \u00B7 " + lead.pts + " PTS" : ""];
      centered(ctx, v, size, "FINAL", g.gb, g.opp, g.opponent, muted, sub.filter(Boolean), gDate(g.date) + " / " + (g.home_away === "Away" ? "AT " : "VS ") + g.opponent.toUpperCase());
      sponsorStrip(ctx, v, o.sponsor);
      return B.c;
    }
    var top = v.pTop, bottom = v.pBot, free = hero(ctx, v, ph, side, top, bottom);
    var k = sk(size, 1.12, .72), ot = !!period(g, "ot1"), rh = Math.round(118 * k);
    flow(ctx, free, side, v.tTop + 14, v.tBot, function (col, cx) {
      col.chrome("FINAL", 250 * k, muted); if (ot) col.text(period(g, "ot2") ? "DOUBLE OVERTIME" : "OVERTIME", "900 #px BC", 40 * k, SOFT, .14);
      col.gap(40 * k);
      [["GREENBRIER", g.gb, true], [g.opponent.toUpperCase(), g.opp, false]].forEach(function (row) {
        var sp = free(col.y - 10, col.y + rh + 14), rw = Math.max(sp[1] - sp[0] - 28, 600), rx = side === "left" ? sp[1] - 14 - rw : sp[0] + 14; col.mark(rx, rx + rw, col.y, col.y + rh); scoreRow(cx, rx, col.y, rw, rh, row[2], row[0], row[1], muted); col.y += rh + 26 * k;
      });
      col.gap(16 * k);
      var wd = size === "wide";
      if (lead && win) { col.text(lead.who.toUpperCase() + " \u00B7 " + lead.pts + " PTS", "900 #px BC", wd ? 54 : 46 * k, "#fff", .04); col.gap(14 * k); }
      col.text(gDate(g.date) + " / " + (g.home_away === "Away" ? "AT " : "VS ") + g.opponent.toUpperCase(), "700 #px BC", wd ? 36 : 30 * k, "#fff", .08);
    });
    sponsorStrip(ctx, v, o.sponsor, free);
    return B.c;
  }
  // Shield, a big chrome headline, two full-width score rows, then small lines; the block is centred in the text-safe zone.
  function centered(ctx, v, size, head, gb, opp, oppName, muted, subs, foot) {
    var W = v.W, k = sk(size, 1.3, .58), rw = Math.min(W - 100, 1000), rx = (W - rw) / 2, sh = GFX.img.logoCat, sw = 330 * k, shh = sw * sh.height / sh.width;
    var hfs = fit(ctx, "italic 900 #px BC", head, (head === "FINAL" ? 280 : 210) * k, 900, 60), rh = Math.round(150 * k), sfs = size === "wide" ? 50 : 46 * k, ffs = size === "wide" ? 36 : 34 * k;
    var total = shh + 36 * k + hfs * .86 + 50 * k + 2 * rh + 30 * k + subs.length * (sfs + 14 * k) + (size === "wide" ? 36 * k + ffs : 70 * k);
    var y = v.tTop + Math.max(0, (v.tBot - v.tTop - total) / 2);
    ctx.globalAlpha = muted ? .85 : 1; logoGlow(ctx, sh, (W - sw) / 2, y, sw, shh); ctx.globalAlpha = 1;
    y += shh + 36 * k + hfs * .82; chrome(ctx, head, W / 2 - 10, y, hfs, "center", muted); y += 50 * k;
    scoreRow(ctx, rx, y, rw, rh, true, "GREENBRIER", gb, muted); y += rh + 30 * k;
    scoreRow(ctx, rx, y, rw, rh, false, String(oppName).toUpperCase(), opp, muted); y += rh;
    shadow(ctx, "rgba(0,0,0,.9)", 12, 2); ctx.fillStyle = "#fff";
    subs.forEach(function (t) { y += 14 * k + sfs; fit(ctx, "900 #px BC", t, sfs, W - 120, 24, .04); spaced(ctx, t, W / 2, y, .04 * sfs, "center"); });
    y += size === "wide" ? 36 * k + ffs : 62 * k; fit(ctx, "700 #px BC", foot, ffs, W - 120, 20, .2); spaced(ctx, foot, W / 2, y, size === "wide" ? ffs * .14 : 7 * k, "center"); noShadow(ctx);
  }
  // QUARTER: no player. Centered, same as the football in-game template.
  function drawQuarter(size, g, pk, o) {
    o = o || {};
    var v = GV[size], p = PERIODS.filter(function (x) { return x.k === pk; })[0], s = period(g, pk), B = base(v, false, teamLabel([g.team])), ctx = B.ctx, W = v.W;
    var head = { q1: "END OF 1ST", q2: "HALFTIME", q3: "END OF 3RD", q4: "END OF 4TH", ot1: "END OF OT", ot2: "END OF 2OT" }[pk];
    centered(ctx, v, size, head, s.gb, s.opp, g.opponent, false, [], gDate(g.date) + " / " + (g.home_away === "Away" ? "AT " : "VS ") + g.opponent.toUpperCase());
    sponsorStrip(ctx, v, o.sponsor);
    return B.c;
  }
  // STARTING FIVE: ESPN-style cards. Uses a headshot when there is one, otherwise crops head and shoulders from the full-body cut-out.
  function drawFive(size, g, five, phs, o) {
    o = o || {};
    var v = GV[size], B = base(v, false, teamLabel([g.team])), ctx = B.ctx, W = v.W, k = sk(size, 1.18, .7);
    var fs = fit(ctx, "italic 900 #px BC", "STARTING FIVE", 150 * k, 940, 60), y = v.hdr + (size === "wide" ? 60 : 96) + fs * .82; chrome(ctx, "STARTING FIVE", W / 2 - 8, y, fs, "center", false);
    var wide = size === "wide"; ctx.font = "700 " + Math.round(wide ? 40 : 32 * k) + "px BC"; ctx.fillStyle = "#fff"; shadow(ctx, "rgba(0,0,0,.9)", 10, 2);
    spaced(ctx, (g.home_away === "Away" ? "AT " : "VS. ") + g.opponent.toUpperCase() + "  \u00B7  " + gDate(g.date) + (g.time ? "  \u00B7  " + fmtTime(g.time) : ""), W / 2, y + (wide ? 58 : 62 * k), wide ? 4 : 5, "center"); noShadow(ctx);
    var gap = 22, cw = Math.round((W - 80 - gap * 2) / 3), y1 = y + (wide ? 92 : 104 * k), ch = Math.min(size === "story" ? 640 : 440, Math.floor((v.sp - 16 - y1 - gap) / 2));
    var spots = [[40, y1], [40 + cw + gap, y1], [40 + 2 * (cw + gap), y1], [40 + (cw + gap) / 2, y1 + ch + gap], [40 + (cw + gap) * 1.5, y1 + ch + gap]];
    if (size === "wide") { cw = Math.round((W - 80 - gap * 4) / 5); ch = Math.min(Math.round(cw * 1.45), v.sp - 18 - y1); spots = [0, 1, 2, 3, 4].map(function (i) { return [40 + i * (cw + gap), y1]; }); } // one row of five
    var st = o.style || "card";
    if (st === "list" && !wide) { // one kid per row: circle on the left, big name on the right
      var avail = v.sp - 20 - y1, rg = 14, rh = Math.min(260, (avail - 4 * rg) / 5), y2 = y1 + (avail - (5 * rh + 4 * rg)) / 2;
      five.slice(0, 5).forEach(function (p, i) { listRow(ctx, 70, y2 + i * (rh + rg), W - 140, rh, p, phs[i], i); });
      sponsorStrip(ctx, v, o.sponsor); return B.c;
    }
    if (st === "text") { // names only: one slanted green bar per kid, number in a white block
      var tw = wide ? 1000 : W - 120, tx0 = (W - tw) / 2, tav = v.sp - 24 - y1, tg = wide ? 12 : 18, th = Math.min(wide ? 104 : 190, (tav - 4 * tg) / 5), ty = y1 + (tav - (5 * th + 4 * tg)) / 2;
      five.slice(0, 5).forEach(function (p, i) { textRow(ctx, tx0, ty + i * (th + tg), tw, th, p); });
      sponsorStrip(ctx, v, o.sponsor); return B.c;
    }
    if (st === "list") st = "ring";
    five.slice(0, 5).forEach(function (p, i) { if (st === "card") card(ctx, spots[i][0], spots[i][1], cw, ch, p, phs[i], wide); else disc(ctx, spots[i][0], spots[i][1], cw, ch, p, phs[i], st); });
    sponsorStrip(ctx, v, o.sponsor);
    return B.c;
  }
  // Circle versions of the Starting Five card. "ring": photo in a ringed circle, name below. "pop": the head breaks out the top of the circle, name on a slanted plate. "badge": ringed circle with a number badge, name on a white plate.
  // Headshots: the biggest centred square, nudged toward the top of a tall photo where the face is.
  function headSq(im) { var sw = Math.min(im.width, im.height); return [(im.width - sw) / 2, Math.max(0, (im.height - sw) * .2), sw]; }
  function headCrop(ph) { var im = ph.img, m = ph.m; if (ph.head) return headSq(im); var bh = (m.box[3] - m.box[1]) * im.height, sw = bh * .36; return [m.head * im.width - sw / 2, m.box[1] * im.height - sw * .06, sw]; }
  function disc(ctx, x, y, w, h, p, ph, st) {
    var pop = st === "pop", brk = pop && ph && !(ph.m && ph.m.opaque), nameH = h * (pop ? .27 : .3), D = Math.min(w * .94, (h - nameH) * (pop ? .8 : .94)), cx = x + w / 2, cy = y + (h - nameH) - D / 2 - (pop ? 4 : 10), r = D / 2;
    var last = String(p.name || "").split(" ").slice(-1)[0].toUpperCase(), first = String(p.name || "").split(" ").slice(0, -1).join(" ").toUpperCase();
    ctx.save(); shadow(ctx, "rgba(0,0,0,.6)", 26, 10);
    var g = ctx.createRadialGradient(cx, cy - r * .3, r * .1, cx, cy, r); g.addColorStop(0, "#16703f"); g.addColorStop(1, "#04200f");
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = g; ctx.fill(); noShadow(ctx);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
    ctx.font = "italic 900 " + Math.round(D * .62) + "px BC"; ctx.textAlign = "center"; ctx.strokeStyle = "rgba(255,255,255,.16)"; ctx.lineWidth = 3; ctx.strokeText(p.n || "", cx + r * .1, cy + D * .22);
    ctx.restore();
    if (ph) {
      var c = headCrop(ph), dw = brk ? D * 1.3 : D * 1.02, dx = cx - dw / 2, dy = brk ? cy - r - D * .13 - dw * .06 : cy - dw / 2 + D * .05;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, 7);
      if (brk) { ctx.moveTo(cx - r, cy); ctx.rect(cx - r * .62, dy - 40, r * 1.24, cy - dy + 40); } // above the middle, the head may leave the circle
      ctx.clip(); ctx.drawImage(ph.img, c[0], c[1], c[2], c[2], dx, dy, dw, dw); ctx.restore();
    } else { var sh = GFX.img.logoG, s2 = D * .5; ctx.globalAlpha = .6; ctx.drawImage(sh, cx - s2 / 2, cy - s2 * sh.height / sh.width / 2, s2, s2 * sh.height / sh.width); ctx.globalAlpha = 1; }
    // ring: silver outer, green inner hairline. On "pop" the ring is cut where the head crosses it, so it reads as breaking out.
    ctx.lineWidth = Math.max(6, D * .035); ctx.strokeStyle = "#e9eeeb";
    if (brk) { ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI * .02, Math.PI * 1.02); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.02, Math.PI * 1.27); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.73, Math.PI * 1.98); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(9,74,40,.9)"; ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth * 0 - Math.max(6, D * .035) / 2 - 2, 0, 7); if (!brk) ctx.stroke();
    var ny = cy + r + 14, nameT = last;
    if (st === "ring") {
      var bfs = Math.round(D * .14), bw = bfs * 2.2; ctx.fillStyle = "#fff"; shadow(ctx, "rgba(0,0,0,.5)", 10, 3); para(ctx, cx - bw / 2, cy + r - bfs * .75, bw, bfs * 1.35); ctx.fill(); noShadow(ctx);
      ctx.font = "900 " + bfs + "px BC"; ctx.fillStyle = GREEN; ctx.textAlign = "center"; ctx.fillText("#" + (p.n || ""), cx, cy + r - bfs * .75 + bfs * 1.35 / 2 + bfs * .36);
      ny = cy + r + bfs * .75 + 10; var lf = fit(ctx, "900 #px BC", nameT, Math.round(nameH * .36), w - 10, 16, .03); shadow(ctx, "rgba(0,0,0,.9)", 10, 2); ctx.fillStyle = "#fff"; spaced(ctx, nameT, cx, ny + lf, .03 * lf, "center");
      if (first) { var ff = fit(ctx, "700 #px BC", first, Math.round(nameH * .2), w - 10, 12, .14); ctx.fillStyle = SOFT; spaced(ctx, first, cx, ny + lf + 8 + ff, .14 * ff, "center"); } noShadow(ctx);
    } else {
      var t = (p.n ? "#" + p.n + " " : "") + last, ph2 = nameH * (pop ? .5 : .46), pw = w - 12, py = pop ? cy + r + 12 : cy + r - ph2 * .35;
      shadow(ctx, "rgba(0,0,0,.5)", 14, 4); ctx.fillStyle = "#fff"; para(ctx, cx - pw / 2, py, pw, ph2); ctx.fill(); noShadow(ctx); ctx.fillStyle = "#cfd6d2"; ctx.fillRect(cx - pw / 2 + 4, py + ph2 - 5, pw - 8, 5);
      var lf2 = fit(ctx, "900 #px BC", t, Math.round(ph2 * .62), pw - 34, 14, .02); ctx.fillStyle = GREEN; spaced(ctx, t, cx, py + ph2 / 2 + lf2 * .36, .02 * lf2, "center");
      if (first) { var ff2 = fit(ctx, "700 #px BC", first, Math.round(nameH * .2), w - 10, 12, .14); shadow(ctx, "rgba(0,0,0,.9)", 10, 2); ctx.fillStyle = "#fff"; spaced(ctx, first, cx, py + ph2 + 10 + ff2, .14 * ff2, "center"); noShadow(ctx); }
    }
    ctx.restore();
  }
  function textRow(ctx, x, y, w, h, p) {
    var last = String(p.name || "").split(" ").slice(-1)[0].toUpperCase(), first = String(p.name || "").split(" ").slice(0, -1).join(" ").toUpperCase();
    var sub = [first, p.gr, p.pos].filter(Boolean).join(" \u00B7 ").toUpperCase();
    shadow(ctx, "rgba(0,0,0,.55)", 18, 6); ctx.fillStyle = "rgba(9,74,40,.94)"; para(ctx, x, y, w, h); ctx.fill(); noShadow(ctx);
    ctx.fillStyle = "#cfd6d2"; ctx.fillRect(x + w - 22, y, 8, h);
    var nw = h * 1.25; ctx.fillStyle = "#fff"; para(ctx, x, y, nw, h); ctx.fill();
    var nf = fit(ctx, "italic 900 #px BC", "#" + (p.n || ""), Math.round(h * .62), nw - h * .4, 16, 0); ctx.fillStyle = GREEN; ctx.textAlign = "center"; ctx.fillText("#" + (p.n || ""), x + nw / 2, y + h / 2 + nf * .36);
    var tx = x + nw + h * .35, room = w - nw - h * .35 - 50;
    var lf = fit(ctx, "900 #px BC", last, Math.round(h * (sub ? .5 : .58)), room, 16, .03); shadow(ctx, "rgba(0,0,0,.5)", 8, 2); ctx.fillStyle = "#fff";
    spaced(ctx, last, tx, y + (sub ? h * .52 : h / 2 + lf * .36), .03 * lf, "left");
    if (sub) { var sf = fit(ctx, "700 #px BC", sub, Math.round(h * .2), room, 12, .14); ctx.fillStyle = SOFT; spaced(ctx, sub, tx + 2, y + h * .52 + sf + h * .1, .14 * sf, "left"); }
    noShadow(ctx);
  }
  function listRow(ctx, x, y, w, h, p, ph, i) {
    var D = h, cx = x + D / 2, cy = y + h / 2, r = D / 2, last = String(p.name || "").split(" ").slice(-1)[0].toUpperCase(), first = String(p.name || "").split(" ").slice(0, -1).join(" ").toUpperCase();
    // slanted green bar behind the name, tucked under the circle
    var bx = cx, bw = w - D / 2, bh = h * .62, by = cy - bh / 2; ctx.fillStyle = "rgba(9,74,40,.92)"; para(ctx, bx, by, bw, bh); ctx.fill(); ctx.fillStyle = "#cfd6d2"; ctx.fillRect(bx + bw - 14, by, 8, bh);
    var nb = Math.round(bh * .5), tx = x + D + 30, nt = (p.n ? "#" + p.n + "  " : "") + last;
    var lf = fit(ctx, "900 #px BC", nt, nb, bw - D / 2 - 70, 16, .02); ctx.fillStyle = "#fff"; shadow(ctx, "rgba(0,0,0,.6)", 8, 2); spaced(ctx, nt, tx, cy + (first ? lf * .12 : lf * .36), .02 * lf, "left");
    if (first) { var ff = fit(ctx, "700 #px BC", first, Math.round(bh * .2), bw - D / 2 - 70, 12, .14); ctx.fillStyle = SOFT; spaced(ctx, first, tx + 4, cy + lf * .12 + ff + 10, .14 * ff, "left"); } noShadow(ctx);
    ctx.save(); shadow(ctx, "rgba(0,0,0,.6)", 22, 8); var g = ctx.createRadialGradient(cx, cy - r * .3, r * .1, cx, cy, r); g.addColorStop(0, "#16703f"); g.addColorStop(1, "#04200f");
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = g; ctx.fill(); noShadow(ctx); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, 7); ctx.clip();
    if (ph) { var c = headCrop(ph), dw = D * 1.02; ctx.drawImage(ph.img, c[0], c[1], c[2], c[2], cx - dw / 2, cy - dw / 2 + D * .05, dw, dw); }
    else { var sh = GFX.img.logoG, s2 = D * .5; ctx.globalAlpha = .6; ctx.drawImage(sh, cx - s2 / 2, cy - s2 * sh.height / sh.width / 2, s2, s2 * sh.height / sh.width); ctx.globalAlpha = 1; }
    ctx.restore(); ctx.lineWidth = Math.max(6, D * .035); ctx.strokeStyle = "#e9eeeb"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
  }
  function card(ctx, x, y, w, h, p, ph, wide) {
    var nb = Math.round(h * (wide ? .3 : .25)); /* 16:9 cards are short: a taller name band keeps the names readable */
    ctx.save(); shadow(ctx, "rgba(0,0,0,.6)", 24, 12);
    var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#0f5a32"); g.addColorStop(1, "#04200f"); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); noShadow(ctx);
    ctx.beginPath(); ctx.rect(x, y, w, h - nb); ctx.clip();
    // big outlined number behind the player
    ctx.font = "italic 900 " + Math.round(h * .55) + "px BC"; ctx.textAlign = "right"; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 3; ctx.strokeText(p.n || "", x + w - 10, y + h * .5);
    if (ph) {
      var im = ph.img, m = ph.m, sx, sy, sw;
      if (ph.head) { var hq = headSq(im); sx = hq[0]; sy = hq[1]; sw = hq[2]; }
      else { var bh = (m.box[3] - m.box[1]) * im.height; sw = bh * .36; sx = m.head * im.width - sw / 2; sy = m.box[1] * im.height - sw * .06; }
      var area = h - nb, dw = Math.max(w, area * (m && m.opaque ? 1 : .92)), /* a photo with a background has to fill the card edge to edge */ dx = x + (w - dw) / 2, dy = y + area - dw;
      ctx.drawImage(im, sx, sy, sw, sw, dx, dy + (m && m.opaque ? 0 : dw * .02), dw, dw);
    } else {
      var sh = GFX.img.logoG, s2 = w * .5; ctx.globalAlpha = .6; ctx.drawImage(sh, x + (w - s2) / 2, y + (h - nb - s2 * sh.height / sh.width) / 2, s2, s2 * sh.height / sh.width); ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.fillRect(x, y + h - nb, w, nb); ctx.fillStyle = "#cfd6d2"; ctx.fillRect(x, y + h - nb, w, 6);
    ctx.strokeStyle = "rgba(207,214,210,.9)"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    var last = String(p.name || "").split(" ").slice(-1)[0].toUpperCase(), first = String(p.name || "").split(" ").slice(0, -1).join(" ").toUpperCase();
    var nfs = fit(ctx, "900 #px BC", (p.n ? "#" + p.n + " " : "") + last, Math.round(nb * .42), w - 28, 16, .02); ctx.fillStyle = GREEN;
    spaced(ctx, (p.n ? "#" + p.n + " " : "") + last, x + w / 2, y + h - nb + 10 + nfs, .02 * nfs, "center");
    var sub = [first, p.gr, p.pos].filter(Boolean).join(" \u00B7 ").toUpperCase(); if (sub) { var sfs = Math.round(nb * (wide ? .27 : .22)); fit(ctx, "700 #px BC", sub, sfs, w - 24, 12, .06); ctx.fillStyle = "#4a5a50"; spaced(ctx, sub, x + w / 2, y + h - 16, .06 * sfs, "center"); }
  }

  function chip(cls, text) { return '<span class="chip ' + cls + '">' + esc(text) + "</span>"; }

  function rowHTML(g, kind) {
    var res, lp = latestPeriod(g);
    if (hasFinal(g)) res = '<span class="res ' + (g.gb > g.opp ? "w" : "l") + '">' + (g.gb > g.opp ? "W " : "L ") + g.gb + "-" + g.opp + "</span>";
    else if (lp) { var s = period(g, lp.k); res = '<span class="res live"><small>' + esc(lp.label) + "</small>" + s.gb + "-" + s.opp + "</span>"; }
    else if (kind === "need") res = '<span class="res need">Enter final</span>';
    else res = '<span class="res later">' + esc(fmtTime(g.time) || "Time TBD") + "</span>";
    var meta = chip("team", nick(g.team)) + (g.district ? chip("", "District 9") : "") + (g.event ? "<span>" + esc(g.event) + "</span>" : "");
    var isOpen = state.open === g.id;
    return '<div class="game' + (kind === "need" ? " alert" : "") + '" data-id="' + esc(g.id) + '">' +
      '<button type="button" class="row" aria-expanded="' + isOpen + '" data-toggle="' + esc(g.id) + '">' +
      '<span class="when"><span class="d">' + esc(fmtDate(g.date, { month: "short", day: "numeric" })) + '</span><br><span class="w">' + esc(fmtDate(g.date, { weekday: "short" })) + "</span></span>" +
      '<span class="who"><span class="opp">' + esc(siteWord(g) + " " + g.opponent) + '</span><span class="meta">' + meta + "</span></span>" + res + "</button>" +
      (isOpen ? sheetHTML(g) : "") + "</div>";
  }

  function draftVal(g, key, fallback) { var d = state.drafts[g.id] || {}; return d[key] != null ? d[key] : fallback; }

  function takeHTML(boxId, label, txt, countX, short) {
    var over = countX && txt.length > 280;
    return '<div class="take"><div class="cap-meta"><strong class="tier">' + esc(label) + "</strong>" +
      (countX ? '<span class="' + (over ? "over" : "") + '">' + txt.length + " / 280</span>" : "<span></span>") +
      '<button type="button" class="btn small" data-copy="' + boxId + '">Copy</button></div>' +
      '<textarea class="cap-box' + (short ? " short" : "") + '" rows="' + rowsFor(txt) + '" id="' + boxId + '" readonly aria-label="' + esc(label) + ' caption">' + esc(txt) + "</textarea></div>";
  }
  function rowsFor(txt) { // tall enough to show the whole caption on a phone without scrolling the box
    return txt.split("\n").reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / 42)); }, 0);
  }

  function sheetHTML(g) {
    var id = esc(g.id), ro = state.readOnly ? " disabled" : "", bro = ro || (g._book ? " disabled" : "");
    var showOT = state.showOT[g.id] || period(g, "q4") || period(g, "ot1");
    var html = '<div class="sheet">' + brierHTML(g, id, ro) + '<div class="part"><h3>In-game updates</h3>' +
      '<div class="phead"><span>Score at end of</span><span>GHS</span><span>' + esc(g.opponent) + '</span><span>Save</span></div><div class="periods">';
    PERIODS.forEach(function (p) {
      if (p.ot && !showOT) return;
      var s = period(g, p.k) || {};
      var vg = draftVal(g, "p:" + p.k + ":gb", isNum(s.gb) ? s.gb : ""), vo = draftVal(g, "p:" + p.k + ":opp", isNum(s.opp) ? s.opp : "");
      html += '<div class="prow"><span class="pl">' + esc(p.label) + "</span>" +
        '<input aria-label="Greenbrier score, ' + esc(p.label) + '" id="p-' + p.k + "-gb-" + id + '" data-f="p:' + p.k + ':gb" inputmode="numeric" pattern="[0-9]*" value="' + esc(vg) + '"' + bro + ">" +
        '<input aria-label="' + esc(g.opponent) + " score, " + esc(p.label) + '" id="p-' + p.k + "-opp-" + id + '" data-f="p:' + p.k + ':opp" inputmode="numeric" pattern="[0-9]*" value="' + esc(vo) + '"' + bro + ">" +
        '<button type="button" class="btn small" data-psave="' + p.k + '" data-game="' + id + '"' + bro + ">Save</button></div>";
    });
    html += "</div>";
    if (!showOT && !g._book) html += '<div><button type="button" class="btn link" data-ot="' + id + '">Going to overtime? Add OT periods</button></div>';
    html += '<div class="field"><label for="ln-' + id + '">Shout-out for in-game posts <span class="hint">(optional)</span></label><input id="ln-' + id + '" data-f="live_note" type="text" placeholder="Smith has 12 at the half" value="' + esc(draftVal(g, "live_note", g.live_note || "")) + '"' + ro + "></div>";
    html += '<div class="status" id="pst-' + id + '"></div>';
    var lp = latestPeriod(g);
    if (lp) {
      var lc = liveCaptions(g, lp);
      html += '<div class="captions"><div class="cap-head"><span>' + esc(lp.label) + ' post for X or Facebook</span><button type="button" class="btn small" data-remix="' + id + '">New takes</button></div>' +
        TIERS.map(function (t) { return takeHTML("lcap-" + id + "-" + t.k, t.label, lc[t.k], true, true); }).join("") + "</div>" + gfxPanelHTML("q", [g], lp.k);
    } else {
      html += '<div class="status">Save a quarter score to get an in-game post.</div>';
    }
    html += "</div>";

    var gb = draftVal(g, "gb", isNum(g.gb) ? g.gb : ""), opp = draftVal(g, "opp", isNum(g.opp) ? g.opp : "");
    html += '<div class="part"><h3>Final</h3><div class="scores">' +
      '<div class="scorebox"><label for="gb-' + id + '">Greenbrier</label><input id="gb-' + id + '" data-f="gb" inputmode="numeric" pattern="[0-9]*" value="' + esc(gb) + '"' + bro + "></div>" +
      '<div class="scorebox"><label for="opp-' + id + '">' + esc(g.opponent) + '</label><input id="opp-' + id + '" data-f="opp" inputmode="numeric" pattern="[0-9]*" value="' + esc(opp) + '"' + bro + "></div></div>" +
      '<div class="field"><label for="top-' + id + '">Top scorers <span class="hint">(name and points)</span></label><input id="top-' + id + '" data-f="top" type="text" placeholder="Smith 18, Jones 12" value="' + esc(draftVal(g, "top", g.top || "")) + '"' + bro + "></div>" +
      '<div class="field"><label for="note-' + id + '">Anything notable <span class="hint">(optional, goes in Instagram and Facebook)</span></label><textarea id="note-' + id + '" data-f="note" placeholder="Overtime, buzzer beater, a milestone"' + ro + ">" + esc(draftVal(g, "note", g.note || "")) + "</textarea></div>" +
      '<div class="actions"><button type="button" class="btn primary" data-save="' + id + '"' + ro + ">" + (g._book ? "Save note" : "Save final") + "</button>" +
      '<span class="status" id="st-' + id + '"></span></div>';
    if (hasFinal(g)) {
      var caps = finalCaptions(g), set = caps[state.tab] || caps.x;
      var labels = { x: "X", ig: "Instagram", fb: "Facebook", tt: "TikTok" };
      html += '<div class="captions"><div class="cap-head"><div class="cap-tabs" role="group" aria-label="Caption platform">' +
        ["x", "ig", "fb", "tt"].map(function (k) { return '<button type="button" data-tab="' + k + '" aria-pressed="' + (state.tab === k) + '">' + labels[k] + "</button>"; }).join("") + "</div>" +
        '<button type="button" class="btn small" data-remix="' + id + '">New takes</button></div>' +
        '<p class="mood">' + esc(caps.mood) + "</p>" +
        TIERS.map(function (t) { return takeHTML("cap-" + id + "-" + t.k, t.label, set[t.k], state.tab === "x", false); }).join("") + "</div>" + gfxPanelHTML("fin", [g]);
      var p = g.posted || {};
      html += '<div class="posted"><strong>Posted:</strong>' +
        [["fb", "Facebook"], ["ig", "Instagram"], ["x", "X"], ["tt", "TikTok"]].map(function (pair) {
          return '<label><input type="checkbox" data-posted="' + pair[0] + '" data-game="' + id + '"' + (p[pair[0]] ? " checked" : "") + ro + "> " + pair[1] + "</label>";
        }).join("") + "</div>";
    } else {
      html += '<div class="status">Save the final to get captions for X, Instagram and Facebook.</div>';
    }
    html += "</div></div>";
    return html;
  }

  // Brier Stats (the live basketball scorebook) copies a game's quarter scores, final and top scorers as one line of JSON.
  // Pasting it here fills this game in one save, so nobody retypes numbers from the scorer's table.
  function brierHTML(g, id, ro) {
    return '<section class="bs"><div class="status">' + (g._book ? "Scores, quarter by quarter, and the top scorers come straight from the book in Brier Stats. Fix them there (Scorer screen) and they change here."
      : "Nobody has scored this game in Brier Stats" + (g.date <= todayISO() ? "" : " yet") + ". If it gets scored there, the scores fill in on their own; if not, type them here.") + "</div></section>";
    var msg = state.bsMsg[g.id] ? '<span class="status">' + esc(state.bsMsg[g.id]) + "</span>" : "";
    if (!state.bsOpen[g.id]) return '<section class="bs"><div class="actions"><button type="button" class="btn small" data-bsopen="' + id + '"' + ro + ">Paste from Brier Stats</button>" + msg + "</div></section>";
    return '<section class="bs"><div class="field"><label for="bs-' + id + '">From Brier Stats <span class="hint">(tap Send to Scorebook there, then Copy)</span></label>' +
      '<textarea id="bs-' + id + '" data-f="bs" rows="3" placeholder="Paste here"' + ro + ">" + esc(draftVal(g, "bs", "")) + "</textarea></div>" +
      '<div class="actions"><button type="button" class="btn primary" data-bsfill="' + id + '"' + ro + '>Fill it in</button><button type="button" class="btn small" data-bsopen="' + id + '">Cancel</button>' + msg + "</div></section>";
  }
  function fillFromBrier(id, btn) {
    if (!db) return;
    var say = function (m) { state.bsMsg[id] = m; render(); };
    var raw = ((state.drafts[id] || {}).bs || "").trim(), p = null;
    try { p = JSON.parse(raw); } catch (e) {}
    if (!p || p.source !== "brier-stats" || typeof p.periods !== "object" || !p.periods) { say("That isn't what Brier Stats copies. In Brier Stats tap Send to Scorebook, then Copy, then paste here."); return; }
    if (p.id !== id && !(PRACTICE && p.id === "practice")) { say("That's " + (p.team || "") + " vs " + (p.opponent || "another team") + (p.date ? " on " + shortDate(p.date) : "") + ", not this game. Open that game here and paste it there."); return; }
    var patch = {}, per = {}, got = [];
    PERIODS.forEach(function (k) { var x = p.periods[k.k]; if (x && isNum(x.gb) && isNum(x.opp)) { per[k.k] = { gb: x.gb, opp: x.opp }; got.push(k.k.toUpperCase()); } });
    if (got.length) patch.periods = per;
    if (p.final) {
      if (!isNum(p.gb) || !isNum(p.opp) || p.gb === p.opp) { say("The final in that copy doesn't look right. Check it in Brier Stats."); return; }
      patch.gb = p.gb; patch.opp = p.opp; patch.top = String(p.top || ""); patch.updated_at = new Date().toISOString();
    } else if (typeof p.live_note === "string" && p.live_note) patch.live_note = p.live_note;
    if (!Object.keys(patch).length) { say("Nothing to fill in yet: no quarter is over in Brier Stats."); return; }
    btn.disabled = true; say("Saving…");
    db.doc("games/" + id).update(patch).then(function () {
      var d = state.drafts[id] || {};
      Object.keys(d).forEach(function (k) { if (k === "bs" || k === "gb" || k === "opp" || k === "top" || k === "live_note" || /^p:/.test(k)) delete d[k]; });
      if (per.ot1) state.showOT[id] = true;
      state.bsOpen[id] = false;
      say("Filled in from Brier Stats: " + (got.length ? got.join(", ") : "") + (p.final ? (got.length ? " and " : "") + "the final" : "") + ". Captions are below.");
    }).catch(function (e) { btn.disabled = false; state.bsMsg[id] = ""; handleWriteError(e, "pst-" + id); });
  }

  var PLAT = [["x", "X"], ["ig", "Instagram"], ["fb", "Facebook"], ["tt", "TikTok"]];
  function tabsHTML(attr, cur) {
    return '<div class="cap-tabs" role="group" aria-label="Caption platform">' + PLAT.map(function (p) { return '<button type="button" ' + attr + '="' + p[0] + '" aria-pressed="' + (cur === p[0]) + '">' + p[1] + "</button>"; }).join("") + "</div>";
  }
  function postedHTML(kind, ids, flags, ro) {
    return '<div class="posted"><strong>Posted:</strong>' + [["fb", "Facebook"], ["ig", "Instagram"], ["x", "X"], ["tt", "TikTok"]].map(function (pair) {
      return '<label><input type="checkbox" data-posted="' + pair[0] + '" data-pkind="' + kind + '" data-game="' + esc(ids) + '"' + (flags[pair[0]] ? " checked" : "") + ro + "> " + pair[1] + "</label>";
    }).join("") + "</div>";
  }
  // Gameday and Starters share one night picker, so flipping to Starters lands on the same night.
  function pickNight(list) { if (!state.gdNight || list.indexOf(state.gdNight) < 0) state.gdNight = defaultNight(list); return state.gdNight; }
  function nightNavHTML(list) {
    var d = state.gdNight, i = list.indexOf(d), days = Math.round((dateObj(d) - dateObj(todayISO())) / 864e5);
    var rel = days === 0 ? "Tonight" : days === 1 ? "Tomorrow" : days > 1 ? "In " + days + " days" : days === -1 ? "Yesterday" : -days + " days ago";
    return '<div class="gd-nav"><button type="button" class="btn" data-gdnav="-1" aria-label="Previous game night"' + (i <= 0 ? " disabled" : "") + ">‹</button>" +
      '<div class="gd-date"><strong>' + esc(fmtDate(d, { weekday: "short", month: "short", day: "numeric" })) + "</strong><span>" + rel + " · " + (i + 1) + " of " + list.length + " game nights</span></div>" +
      '<button type="button" class="btn" data-gdnav="1" aria-label="Next game night"' + (i >= list.length - 1 ? " disabled" : "") + ">›</button></div>";
  }
  function luViewHTML() {
    var list = nights();
    if (!list.length) return '<div class="empty">' + (state.loaded ? "No games on the schedule for this team." : "Starting fives appear here once the schedule loads.") + "</div>";
    var d = pickNight(list), ro = state.readOnly ? " disabled" : "";
    return '<div class="gd">' + nightNavHTML(list) + "</div>" + allGames().filter(function (g) { return g.date === d && vis(g); }).map(function (g) {
      var meta = chip("team", nick(g.team)) + (g.district ? chip("", "District 9") : "") + (isRival(g.opponent) ? chip("", "Rival") : "");
      return '<div class="lu-game" data-lugame="' + esc(g.id) + '"><div class="gd-match">' + esc(nick(g.team) + " " + siteWord(g) + " " + g.opponent) + (g.time ? " · " + esc(fmtTime(g.time)) : "") +
        '<div class="meta">' + meta + "</div></div>" + lineupHTML(g, esc(g.id), ro) + "</div>";
    }).join("");
  }
  function gdHTML() {
    var list = nights();
    if (!list.length) return '<div class="empty">' + (state.loaded ? "No games on the schedule for this team." : "Gameday posts appear here once the schedule loads.") + "</div>";
    var d = pickNight(list), ro = state.readOnly ? " disabled" : "";
    var groups = groupsOn(d);
    var html = '<div class="gd">' + nightNavHTML(list);
    var themeNow = state.gdTheme[d] != null ? state.gdTheme[d] : (allGames().filter(function (g) { return g.date === d && g.theme; }).map(function (g) { return g.theme; })[0] || "");
    html += '<div class="field"><label for="gd-theme">Theme or promo for the night <span class="hint">(optional, like "Pink Out, wear pink" or "Senior Night")</span></label>' +
      '<input id="gd-theme" type="text" data-gdtheme="' + d + '" value="' + esc(themeNow) + '"' + ro + "></div>";
    groups.forEach(function (grp, gi) {
      var key = gdKey(grp), caps = gamedayCaptions(grp), set = caps[state.gdTab];
      var g0 = grp[0], flags = {};
      ["fb", "ig", "x", "tt"].forEach(function (k) { flags[k] = grp.every(function (g) { return (g.posted_gd || {})[k]; }); });
      var meta = grp.map(function (g) { return chip("team", nick(g.team) + " " + (fmtTime(g.time) || "TBD")); }).join("") +
        (grp.some(function (g) { return g.district; }) ? chip("", "District 9") : "") + (isRival(g0.opponent) ? chip("", "Rival") : "") + (g0.event ? "<span>" + esc(g0.event) + "</span>" : "");
      html += '<div class="gd-group"><div class="gd-match">' + esc((grp.length > 1 ? "Doubleheader " : nick(g0.team) + " ") + siteWord(g0) + " " + g0.opponent) + '<div class="meta">' + meta + "</div></div>" +
        '<div class="cap-head">' + tabsHTML("data-gdtab", state.gdTab) + '<button type="button" class="btn small" data-remix="' + esc(key) + '">New takes</button></div>' +
        TIERS.map(function (t) { return takeHTML("gd-" + gi + "-" + t.k, t.label, set[t.k], state.gdTab === "x", false); }).join("") +
        gfxPanelHTML("gd", grp) +
        postedHTML("posted_gd", grp.map(function (g) { return g.id; }).join(","), flags, ro) +
        '<div class="actions"><a class="btn small" href="#starters">Starting fives for this night →</a></div></div>';
    });
    html += '<div class="week"><h3>Copy the whole week</h3><div class="actions">' +
      '<select class="sel" id="week-plat" aria-label="Platform for the week">' + PLAT.map(function (p) { return '<option value="' + p[0] + '"' + (state.gdTab === p[0] ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select>" +
      '<select class="sel" id="week-tier" aria-label="Take for the week">' + TIERS.map(function (t) { return '<option value="' + t.k + '"' + (state.weekTier === t.k ? " selected" : "") + ">" + t.label + "</option>"; }).join("") + "</select>" +
      '<button type="button" class="btn" data-week="1">Build 7 days from ' + esc(fmtDate(d, { month: "short", day: "numeric" })) + "</button></div>";
    if (state.week) html += '<div class="take"><div class="cap-meta"><strong class="tier">' + esc(state.week.label) + '</strong><span></span><button type="button" class="btn small" data-copy="week-box">Copy</button></div>' +
      '<textarea class="cap-box" id="week-box" rows="' + Math.min(30, rowsFor(state.week.text)) + '" readonly aria-label="The week of gameday posts">' + esc(state.week.text) + "</textarea></div>";
    html += "</div></div>";
    return html;
  }

  // Quick swap (Kevin, 2026-11-19): change any saved starter on the fly. Picking a player saves at once and redraws the graphic.
  // Choices come from the roster, plus anyone in the photo Library; "Other number" types in a number not on either.
  function swapPool(team) {
    var seen = {}, out = [];
    (state.rosters[team] || []).concat(photoList(team).map(function (p) { return { n: p.n, name: p.name }; })).forEach(function (r) {
      var k = (r.n || "") + "|" + String(r.name || "").toLowerCase(); if (!r.n && !r.name) return;
      if (r.n && out.some(function (x) { return x.n === r.n; })) return; // one entry per number, roster first
      if (!seen[k]) { seen[k] = 1; out.push(r); }
    });
    return out.sort(function (a, b) { return (parseInt(a.n, 10) || 999) - (parseInt(b.n, 10) || 999); });
  }
  function swapHTML(g, id, ro) {
    var pool = swapPool(g.team), dis = ro ? " disabled" : "";
    var rows = g.starters.slice(0, 5).map(function (p, i) {
      var cur = (p.n || "") + "|" + (p.name || ""), opts = pool.map(function (r) { return [(r.n || "") + "|" + (r.name || ""), (r.n ? "#" + r.n + " " : "") + (r.name || "")]; });
      if (!opts.some(function (o) { return o[0] === cur; })) opts.unshift([cur, (p.n ? "#" + p.n + " " : "") + (p.name || "")]);
      opts.push(["__other", "Other number…"]);
      return '<label class="gsel"><span>Starter ' + (i + 1) + '</span><select class="sel" data-swap="' + i + '" data-game="' + id + '"' + dis + ">" + opts.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
    }).join("");
    return '<div class="swap"><h4>Quick swap</h4><div class="swap-grid">' + rows + '</div><div class="status" id="swst-' + id + '" aria-live="polite">' + esc(swapMsgs[id] || "") + '</div></div>';
  }
  function doSwap(id, i, val) {
    var g = state.games[id]; if (!g || !db) return;
    var list = (g.starters || []).map(function (p) { return Object.assign({}, p); }), np;
    if (val === "__other") {
      var cur = list[i] || {};
      var box = $("swst-" + id); if (!box) return;
      box.innerHTML = 'New number for ' + esc(cur.name || "starter " + (i + 1)) + ': <input class="num" id="swnum-' + id + '" inputmode="numeric" maxlength="2" aria-label="New jersey number"> <button type="button" class="btn small" data-swapnum="' + i + '" data-game="' + id + '">Save number</button>';
      var inp = $("swnum-" + id); if (inp) inp.focus();
      return;
    }
    var parts = val.split("|"); np = enrich(g.team, { n: parts[0], name: parts.slice(1).join("|") });
    if (list.some(function (p, j) { return j !== i && np.n && p.n === np.n; })) { swapMsg(id, "#" + np.n + " is already in this five."); render(); return; }
    list[i] = np; saveSwap(id, list, (np.n ? "#" + np.n + " " : "") + (np.name || "") + " is in.");
  }
  var swapMsgs = {};
  function swapMsg(id, m) { swapMsgs[id] = m; setStatus("swst-" + id, m); }
  function saveSwap(id, list, msg) {
    swapMsgs[id] = "Saving…";
    var next = Object.assign({}, state.games); next[id] = Object.assign({}, state.games[id], { starters: list }); state.games = next; render(); // snapshots are frozen: copy, don't edit
    db.doc("games/" + id).update({ starters: list }).then(function () { swapMsg(id, msg + " Graphic and posts updated."); }, function (e) { handleWriteError(e, "swst-" + id); });
  }
  function lineupHTML(g, id, ro) {
    var ros = state.rosters[g.team] || [];
    var txt = draftVal(g, "lu", playersText(g.starters));
    var picked = parseList(txt);
    var has = function (r) { return picked.some(function (p) { return (p.n && p.n === r.n) || (p.name && p.name.toLowerCase() === r.name.toLowerCase()); }); };
    var html = '<div class="part">';
    if (ros.length) html += '<div class="status">Tap five. ' + picked.length + " of 5 picked.</div>" + '<div class="roster">' + ros.map(function (r, ri) {
      return '<button type="button" data-lupick="' + ri + '" data-game="' + id + '" aria-pressed="' + has(r) + '"' + ro + ">" + esc((r.n ? "#" + r.n + " " : "") + r.name) + "</button>";
    }).join("") + "</div>";
    else html += '<div class="status">No ' + esc(nick(g.team)) + ' roster in Brier Stats yet, so type them below. Add the players under Rosters in Brier Stats and this turns into tap-to-pick.</div>';
    var prev = lastStarters(g);
    html += '<div class="field"><label for="lu-' + id + '">Starters <span class="hint">(one per line: number, name, grade, position)</span></label><textarea id="lu-' + id + '" data-f="lu" data-game="' + id + '" rows="5" placeholder="3 Jane Smith Sr G"' + ro + ">" + esc(txt) + "</textarea></div>" +
      '<div class="actions"><button type="button" class="btn primary" data-lusave="' + id + '"' + ro + ">Save starting five</button>" +
      (prev ? '<button type="button" class="btn small" data-luprev="' + id + '"' + ro + ">Same five as " + esc(shortDate(prev.date)) + "</button>" : "") +
      '<span class="status" id="lust-' + id + '"></span></div>';
    if (g.starters && g.starters.length) html += swapHTML(g, id, ro);
    if (g.starters && g.starters.length) {
      var caps = lineupCaptions(g), set = caps[state.luTab];
      html += '<div class="captions"><div class="cap-head">' + tabsHTML("data-lutab", state.luTab) + '<button type="button" class="btn small" data-remix="' + id + '">New takes</button></div>' +
        TIERS.map(function (t) { return takeHTML("lucap-" + id + "-" + t.k, t.label, set[t.k], state.luTab === "x", true); }).join("") + "</div>" +
        gfxPanelHTML("lu", [g]) +
        postedHTML("posted_lu", g.id, g.posted_lu || {}, ro);
    }
    return html + "</div>";
  }

  function render() {
    var today = todayISO();
    var games = allGames().filter(function (g) { return state.filter === "all" || g.team === state.filter; });
    var need = [], tonight = [], up = [], done = [];
    games.forEach(function (g) {
      if (hasFinal(g)) done.push(g);
      else if (g.date < today) need.push(g);
      else if (g.date === today) tonight.push(g);
      else up.push(g);
    });
    done.reverse();
    function fill(sec, list, cnt, arr, kind) {
      $(sec).hidden = arr.length === 0 && sec !== "sec-up";
      if (cnt) $(cnt).textContent = arr.length ? "(" + arr.length + ")" : "";
      $(list).innerHTML = arr.length ? arr.map(function (g) { return rowHTML(g, kind); }).join("") :
        (sec === "sec-up" ? '<div class="empty">' + (state.loaded ? "No more games on the schedule. Add tournament games in Brier Stats (Games)." : "The schedule appears here once it loads.") + "</div>" : "");
    }
    document.querySelectorAll("[data-view]").forEach(function (v) { v.hidden = v.dataset.view !== state.view; });
    document.querySelectorAll("[data-viewlink]").forEach(function (a) { if (a.dataset.viewlink === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    var ae = document.activeElement;
    if (state.view === "gameday" && !(ae && ae.id === "gd-theme")) $("gd").innerHTML = gdHTML();
    if (state.view === "starters" && !(ae && ae.dataset && ae.dataset.f === "lu")) $("lu").innerHTML = luViewHTML();
    var pickedFiles = ["lib-file", "lib-spfile", "lib-import"].some(function (id) { var el = $(id); return el && el.files && el.files.length; });
    if (state.view === "library" && !pickedFiles && !(ae && ae.closest && ae.closest("#lib") && ae.tagName !== "BUTTON")) $("lib").innerHTML = libHTML();
    fill("sec-need", "list-need", "cnt-need", need, "need");
    fill("sec-today", "list-today", null, tonight, "today");
    fill("sec-up", "list-up", "cnt-up", up, "up");
    fill("sec-done", "list-done", "cnt-done", done, "done");
    ["Girls", "Boys"].forEach(function (team, i) {
      var r = record(team), el = $("records").children[i];
      el.querySelector(".lbl").textContent = nick(team);
      el.querySelector(".big").textContent = r.w + "-" + r.l;
      el.querySelector(".sub").textContent = "District 9: " + r.dw + "-" + r.dl;
    });
    document.querySelectorAll(".seg:not(.gseg) button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
      if (b.dataset.filter !== "all") b.textContent = nick(b.dataset.filter);
    });
    paintGfx();
    if (state.view === "library") paintThumbs();
  }

  function notice(msg) { var n = $("notice"); n.textContent = msg || ""; n.hidden = !msg; }
  function setStatus(id, msg) { var el = $(id); if (el) el.textContent = msg; }
  function handleWriteError(e, statusId) {
    var code = e && e.code;
    if (code === "invalid_argument" || code === "not_granted") {
      state.readOnly = true;
      notice("Couldn't save: Social posts need an Admin signed in to Brier Stats, with signal.");
      render();
    } else if (code === "quota_exceeded") {
      setStatus(statusId, "The scorebook is full. Remove old games to make room.");
    } else {
      setStatus(statusId, "Couldn't save. Check your connection and try again.");
    }
  }
  function numOk(v) { return /^\d{1,3}$/.test(v); }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.filter) { state.filter = t.dataset.filter; try { localStorage.setItem("scorebook." + MODE + ".filter", state.filter); } catch (e) {} render(); return; }
    if (t.dataset.toggle) { state.open = state.open === t.dataset.toggle ? null : t.dataset.toggle; render(); return; }
    if (t.dataset.tab) { state.tab = t.dataset.tab; render(); return; }
    if (t.dataset.remix) { state.spin[t.dataset.remix] = (state.spin[t.dataset.remix] || 0) + 1; render(); return; }
    if (t.dataset.ot) { state.showOT[t.dataset.ot] = true; render(); return; }
    if (t.dataset.copy) {
      var box = $(t.dataset.copy), txt = box.value;
      var orig = t.dataset.label || (t.dataset.label = t.textContent);
      var done = function () { t.textContent = "Copied"; setTimeout(function () { t.textContent = orig; }, 1500); };
      var fallback = function () { box.focus(); box.select(); t.textContent = "Selected, copy it"; };
      try { navigator.clipboard.writeText(txt).then(done, fallback); } catch (e) { fallback(); }
      return;
    }
    if (t.dataset.bsopen) { var bid = t.dataset.bsopen; state.bsOpen[bid] = !state.bsOpen[bid]; state.bsMsg[bid] = ""; render(); var ta = $("bs-" + bid); if (ta) ta.focus(); return; }
    if (t.dataset.bsfill) { fillFromBrier(t.dataset.bsfill, t); return; }
    if (t.dataset.gsize) { state.gfxSize = t.dataset.gsize; try { localStorage.setItem("scorebook.gfxSize2", state.gfxSize); } catch (e) {} render(); return; }
    if (t.dataset.gside) { saveGfxOpt(t.dataset.gkind, t.dataset.gids.split(","), "side", t.dataset.gside); return; }
    if (t.dataset.gdl) { downloadGfx(t); return; }
    if (t.dataset.tt) { makeTikTok(t); return; }
    if (t.dataset.libup && assets && db) {
      if (t.dataset.libup === "ph") uploadPhotos(t); else uploadSponsor(t);
      return;
    }
    if (t.dataset.libsave && db) { libSave(t); return; }
    if (t.dataset.libimport && db) { importOld(t); return; }
    if (t.dataset.swapnum != null && t.dataset.game && db) {
      var sid = t.dataset.game, si = Number(t.dataset.swapnum), nv = String(($("swnum-" + sid) || {}).value || "").replace(/\D/g, "");
      if (!nv) { setStatus("swst-" + sid, "Type a number first."); return; }
      var sl = (state.games[sid].starters || []).map(function (p) { return Object.assign({}, p); });
      if (sl.some(function (p, j) { return j !== si && p.n === nv; })) { setStatus("swst-" + sid, "#" + nv + " is already in this five."); return; }
      var byNum = (state.rosters[state.games[sid].team] || []).filter(function (r) { return r.n === nv; })[0];
      sl[si] = byNum ? Object.assign({}, byNum) : Object.assign({}, sl[si], { n: nv }); // a roster player with that number, or just the new number
      saveSwap(sid, sl, "#" + nv + " is in."); return;
    }
    if (t.dataset.striptag && db) {
      var tv = ($("lib-striptag").value || "").trim(), tv2 = ($("lib-striptag2").value || "").trim();
      db.doc("settings/main").update({ strip_tag: tv, strip_tag2: tv2 }).then(function () { setStatus("lib-st-tag", "Saved. Graphics now say " + ([tv, tv2].filter(Boolean).join(" / ").toUpperCase() || "#GOBOBCATS") + "."); }, function (e) { handleWriteError(e, "lib-st-tag"); });
      return;
    }
    if (t.dataset.libdel && db) { libDelete(t); return; }
    if (t.dataset.gdnav) { var nl = nights(), ni = nl.indexOf(state.gdNight) + Number(t.dataset.gdnav); if (nl[ni]) { state.gdNight = nl[ni]; state.week = null; } render(); return; }
    if (t.dataset.gdtab) { state.gdTab = t.dataset.gdtab; render(); return; }
    if (t.dataset.lutab) { state.luTab = t.dataset.lutab; render(); return; }
    if (t.dataset.week) {
      var wp = $("week-plat").value, wt = $("week-tier").value, wtxt = weekText(state.gdNight, wp, wt);
      state.weekTier = wt;
      var lbl = PLAT.filter(function (p) { return p[0] === wp; })[0][1];
      state.week = { text: wtxt || "No games in those seven days.", label: lbl + ", " + wt + " take, " + (wtxt ? wtxt.split("━━ ").length - 1 : 0) + " posts" };
      render(); return;
    }
    if (t.dataset.lupick) { togglePick(t.dataset.game, Number(t.dataset.lupick)); return; }
    if (t.dataset.luprev) { var pg = state.games[t.dataset.luprev], pv = lastStarters(Object.assign({ id: t.dataset.luprev }, pg)); if (pv) { (state.drafts[t.dataset.luprev] || (state.drafts[t.dataset.luprev] = {})).lu = playersText(pv.starters); render(); } return; }
    if (t.dataset.lusave) { saveLineup(t.dataset.lusave, t); return; }
    if (t.dataset.rsave) { saveRoster(t.dataset.rsave, t); return; }
    if (t.dataset.psave) { savePeriod(t.dataset.game, t.dataset.psave, t); return; }
    if (t.dataset.save) { saveFinal(t.dataset.save, t); return; }
    if (t.dataset.remove) {
      if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Tap again to remove"; return; }
      removeGame(t.dataset.remove); return;
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target.dataset && ev.target.dataset.gdtheme) { state.gdTheme[ev.target.dataset.gdtheme] = ev.target.value; return; }
    var el = ev.target, f = el.dataset && el.dataset.f;
    var gid = (el.dataset && el.dataset.game) || state.open;
    if (!f || !gid) return;
    var d = state.drafts[gid] || (state.drafts[gid] = {});
    d[f] = el.value;
  });
  document.addEventListener("change", function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.ttlen) { TT.len = el.value === "short" ? "short" : "long"; try { localStorage.setItem("sb-tt-len", TT.len); } catch (e) {} document.querySelectorAll("select[data-ttlen]").forEach(function (x) { x.value = TT.len; }); return; }
    if (el.dataset && el.dataset.ttbpm) { TT.bpm = Number(el.value) || 140; try { localStorage.setItem("sb-tt-bpm", String(TT.bpm)); } catch (e) {} document.querySelectorAll("select[data-ttbpm]").forEach(function (x) { x.value = String(TT.bpm); }); return; }
    if (el.dataset && el.dataset.swap != null && el.dataset.game) { doSwap(el.dataset.game, Number(el.dataset.swap), el.value); return; }
    if (el.dataset && el.dataset.gopt === "style") { try { localStorage.setItem("sb-five-style", el.value); } catch (e) {} }
    if (el.dataset && el.dataset.gopt) { saveGfxOpt(el.dataset.gkind, el.dataset.gids.split(","), el.dataset.gopt, el.value); return; }
    if (el.dataset && el.dataset.spdef && db) {
      var sd = {}; sd[el.dataset.spdef] = el.value;
      db.doc("settings/main").update({ sponsor_def: sd }).catch(function (e) { handleWriteError(e, "lib-st-sp"); });
      return;
    }
    if (el.dataset && el.dataset.gdtheme && db) {
      var night = el.dataset.gdtheme, val = el.value.trim(), ids = allGames().filter(function (g) { return g.date === night; }).map(function (g) { return g.id; });
      Promise.all(ids.map(function (gid) { return db.doc("games/" + gid).update({ theme: val }); }))
        .then(function () { delete state.gdTheme[night]; render(); }).catch(function (e) { handleWriteError(e, "sync"); });
      return;
    }
    if (el.dataset && el.dataset.posted && el.dataset.pkind && db) {
      var kind = el.dataset.pkind;
      Promise.all(el.dataset.game.split(",").map(function (gid) { var pt = {}; pt[kind] = {}; pt[kind][el.dataset.posted] = el.checked; return db.doc("games/" + gid).update(pt); }))
        .catch(function (e) { el.checked = !el.checked; handleWriteError(e, "sync"); });
      return;
    }
    if (el.dataset && el.dataset.f === "live_note" && db && state.open) {
      var gid = state.open;
      db.doc("games/" + gid).update({ live_note: el.value.trim() }).then(function () { if (state.drafts[gid]) delete state.drafts[gid].live_note; render(); })
        .catch(function (e) { handleWriteError(e, "pst-" + gid); });
      return;
    }
    if (!el.dataset || !el.dataset.posted || !db) return;
    var patch = { posted: {} }; patch.posted[el.dataset.posted] = el.checked;
    db.doc("games/" + el.dataset.game).update(patch).catch(function (e) { el.checked = !el.checked; handleWriteError(e, "st-" + el.dataset.game); });
  });

  function togglePick(id, ri) {
    var g = Object.assign({ id: id }, state.games[id]), r = (state.rosters[g.team] || [])[ri];
    if (!r) return;
    var d = state.drafts[id] || (state.drafts[id] = {});
    var list = parseList(d.lu != null ? d.lu : playersText(g.starters));
    var at = -1; list.forEach(function (p, i) { if ((p.n && p.n === r.n) || (p.name && p.name.toLowerCase() === r.name.toLowerCase())) at = i; });
    if (at >= 0) list.splice(at, 1);
    else if (list.length >= 5) { setStatus("lust-" + id, "That's five already. Tap one to drop it first."); return; }
    else list.push(r);
    d.lu = playersText(list); render();
  }
  function saveLineup(id, btn) {
    if (!db) return;
    var g = state.games[id], ta = $("lu-" + id), list = parseList(ta ? ta.value : "").map(function (p) { return enrich(g.team, p); });
    if (!list.length) { setStatus("lust-" + id, "Type at least one starter."); return; }
    if (list.length > 5) { setStatus("lust-" + id, "That's " + list.length + " players. A starting five is five."); return; }
    btn.disabled = true; setStatus("lust-" + id, "Saving…");
    db.doc("games/" + id).update({ starters: list }).then(function () {
      if (state.drafts[id]) delete state.drafts[id].lu;
      btn.disabled = false; setStatus("lust-" + id, list.length < 5 ? "Saved " + list.length + " of 5. Posts are below." : "Saved. Posts are below.");
    }).catch(function (e) { btn.disabled = false; handleWriteError(e, "lust-" + id); });
  }
  function saveRoster(team, btn) {
    if (!db) return;
    var list = parseList($("ros-" + team).value).filter(function (p) { return p.name; });
    btn.disabled = true; setStatus("ros-st-" + team, "Saving…");
    db.doc("rosters/" + team).set({ players: list, updated_at: new Date().toISOString() }).then(function () {
      btn.disabled = false; setStatus("ros-st-" + team, "Saved " + list.length + " players. They show up as tap-to-pick in every " + nick(team) + " game.");
    }).catch(function (e) { btn.disabled = false; handleWriteError(e, "ros-st-" + team); });
  }

  function savePeriod(id, k, btn) {
    if (!db) return;
    var row = btn.closest(".prow");
    var gb = row.querySelector('[data-f="p:' + k + ':gb"]').value.trim(), opp = row.querySelector('[data-f="p:' + k + ':opp"]').value.trim();
    if (!numOk(gb) || !numOk(opp)) { setStatus("pst-" + id, "Enter both scores as numbers."); return; }
    var patch = { periods: {} }; patch.periods[k] = { gb: Number(gb), opp: Number(opp) };
    var sheet = btn.closest(".sheet"), ln = sheet.querySelector('[data-f="live_note"]');
    if (ln) patch.live_note = ln.value.trim();
    btn.disabled = true; setStatus("pst-" + id, "Saving…");
    db.doc("games/" + id).update(patch).then(function () {
      var d = state.drafts[id]; if (d) { delete d["p:" + k + ":gb"]; delete d["p:" + k + ":opp"]; delete d.live_note; }
      btn.disabled = false; setStatus("pst-" + id, "Saved. Copy the post below.");
    }).catch(function (e) { btn.disabled = false; handleWriteError(e, "pst-" + id); });
  }

  function saveFinal(id, btn) {
    if (!db) return;
    var part = btn.closest(".part");
    var val = function (f) { return part.querySelector('[data-f="' + f + '"]').value.trim(); };
    if (state.games[id] && state.games[id]._book) { // the book has the scores: only the note is Social's
      btn.disabled = true; setStatus("st-" + id, "Saving…");
      db.doc("games/" + id).update({ note: val("note") }).then(function () { var d = state.drafts[id]; if (d) delete d.note; btn.disabled = false; setStatus("st-" + id, "Saved."); })
        .catch(function (e) { btn.disabled = false; handleWriteError(e, "st-" + id); });
      return;
    }
    var gb = val("gb"), opp = val("opp");
    if (!numOk(gb) || !numOk(opp)) { setStatus("st-" + id, "Enter both scores as numbers."); return; }
    if (Number(gb) === Number(opp)) { setStatus("st-" + id, "Basketball can't end tied. Check the scores."); return; }
    btn.disabled = true; setStatus("st-" + id, "Saving…");
    db.doc("games/" + id).update({ gb: Number(gb), opp: Number(opp), top: val("top"), note: val("note"), updated_at: new Date().toISOString() })
      .then(function () { var d = state.drafts[id]; if (d) { delete d.gb; delete d.opp; delete d.top; delete d.note; } btn.disabled = false; setStatus("st-" + id, "Saved. Copy the captions below."); })
      .catch(function (e) { btn.disabled = false; handleWriteError(e, "st-" + id); });
  }
  function removeGame(id) {
    if (!db) return;
    db.doc("games/" + id).delete().then(function () { if (state.open === id) state.open = null; }).catch(function (e) { handleWriteError(e, "st-" + id); });
  }

  if ($("add-form")) $("add-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!db) return;
    var date = $("add-date").value, team = $("add-team").value, opp = $("add-opp").value.trim();
    if (!date || !opp) { setStatus("add-status", "Date and opponent are required."); return; }
    var base = date + "-" + team.toLowerCase(), id = base, n = 2;
    while (state.games[id]) { id = base + "-" + n++; }
    var body = { date: date, time: $("add-time").value || "", team: team, level: "Varsity", opponent: opp, home_away: $("add-ha").value,
      district: $("add-dist").checked, event: $("add-event").value.trim(), gb: null, opp: null, top: "", note: "", live_note: "", periods: {},
      posted: { fb: false, ig: false, x: false, tt: false }, updated_at: new Date().toISOString() };
    setStatus("add-status", "Adding…");
    db.doc("games/" + id).set(body).then(function () {
      setStatus("add-status", "Added " + nick(team) + " " + siteWord(body) + " " + opp + ".");
      $("add-form").reset();
    }).catch(function (e) { handleWriteError(e, "add-status"); });
  });

  $("settings-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!db) return;
    var body = { girls_name: $("set-girls").value.trim(), boys_name: $("set-boys").value.trim(), hashtags: $("set-tags").value.trim(), rivals: $("set-rivals").value.trim() || DEFAULT_RIVALS,
      gym: $("set-gym").value.trim(), admission: $("set-adm").value.trim(), tickets: $("set-tix").value.trim(), stream: $("set-stream").value.trim() };
    setStatus("set-status", "Saving…");
    db.doc("settings/main").set(body).then(function () { setStatus("set-status", "Saved. Captions use these now."); })
      .catch(function (e) { handleWriteError(e, "set-status"); });
  });

  if (PRACTICE) {
    $("practice-band").hidden = false;
    $("reset-wrap").hidden = false;
    $("reset-btn").addEventListener("click", function () {
      var b = $("reset-btn");
      if (!db) return;
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to clear every practice score"; return; }
      b.disabled = true; setStatus("reset-status", "Clearing…");
      var ids = Object.keys(state.games), i = 0;
      (function step() {
        if (i >= ids.length) { b.disabled = false; b.dataset.confirm = ""; b.textContent = "Clear all practice scores"; setStatus("reset-status", "Cleared. Every game is back to no score."); return; }
        var gid = ids[i++];
        db.doc("games/" + gid).update({ gb: null, opp: null, top: "", note: "", live_note: "", periods: {}, posted: { fb: false, ig: false, x: false, tt: false },
          starters: [], theme: "", posted_gd: { fb: false, ig: false, x: false, tt: false }, posted_lu: { fb: false, ig: false, x: false, tt: false } })
          .then(step).catch(function (e) { b.disabled = false; handleWriteError(e, "reset-status"); });
      })();
    });
  }

  // ---------- Graphics panels + library ----------
  // Player cut-outs and sponsor logos live in this page's asset store, uploaded once; db rows point at them (photos/{assetId}, sponsors/{assetId}).
  // Per-game picks (hero, side, sponsor) live on the game as gfx.{gd|lu|q|fin}. Sponsor defaults per graphic type live in settings/main.sponsor_def.
  var assets = null, downloads = null;
  state.photos = {}; state.sponsors = {}; state.gfxSize = "story"; state.libStatus = { ph: "", sp: "" };
  try { var gsz = localStorage.getItem("scorebook.gfxSize2"); if (gsz === "feed" || gsz === "story" || gsz === "wide") state.gfxSize = gsz; } catch (e) {}
  var GKIND = { gd: "Gameday", lu: "Starting five", q: "In-game score", fin: "Final" };
  var GFXQ = { cache: {}, order: [], specs: {}, queue: [], running: false };

  function photoList(team, kind) {
    return Object.keys(state.photos).map(function (id) { return Object.assign({ id: id }, state.photos[id]); })
      .filter(function (p) { return (!team || p.team === team) && (!kind || p.kind === kind); })
      .sort(function (a, b) { return (parseInt(a.n, 10) || 999) - (parseInt(b.n, 10) || 999) || String(a.name).localeCompare(String(b.name)); });
  }
  function photoLabel(p) { return (p.n ? "#" + p.n + " " : "") + (p.name || "Player") + (p.kind === "head" ? " (headshot)" : ""); }
  function lastWord(s) { return String(s || "").trim().split(/\s+/).slice(-1)[0].toLowerCase(); }
  // 24-Smith.png -> #24 Smith, full body. 24-Smith-head.png -> headshot. Anything else keeps its filename as the name.
  // Kevin's own names work too (Brier Stats, 0.35.0): B_ is the Bobcats, LC_ the Lady Cats, a jersey color on the end
  // (White, Black, Green) is dropped, and _StepRepeat marks a headshot.
  function parseFile(name) {
    var b = String(name).replace(/\.[a-z0-9]+$/i, ""), team = "", pre = b.match(/^(B|LC|boys|girls)[-_ ]+(?=#?\d)/i);
    if (pre) { team = /^(lc|girls)$/i.test(pre[1]) ? "Girls" : "Boys"; b = b.slice(pre[0].length); }
    var tail = /[-_ ](head(shot)?|step[-_ ]?repeat)$/i, head = tail.test(b); b = b.replace(tail, "").replace(/[-_ ](white|black|green|gr[ae]y)$/i, "");
    var m = b.match(/^#?(\d{1,2})[-_ ]+(.+)$/);
    return { n: m ? m[1] : "", name: (m ? m[2] : b).replace(/[-_]+/g, " ").trim(), kind: head ? "head" : "body", team: team };
  }
  function gfxOpt(g, kind) { return ((g && g.gfx) || {})[kind] || {}; }
  // "" = #GOBOBCATS, "none" = leave the strip empty, otherwise a sponsor's asset id.
  function sponsorFor(kind, opt) {
    var pick = opt.sponsor || "";
    if (pick === "" || (pick !== "tag" && pick !== "none" && !state.sponsors[pick])) pick = (state.settings.sponsor_def || {})[kind] || "tag";
    if (pick === "none") return "none";
    return state.sponsors[pick] ? pick : "";
  }
  function sponsorName(id) { return id === "none" ? "nothing" : id === "tag" || !id ? stripTag() : state.sponsors[id] ? state.sponsors[id].name || "Sponsor" : stripTag(); }
  // No hero picked: a final uses the top scorer's photo when there is one; otherwise the team's photos take turns by date.
  function autoHero(kind, grp) {
    var g0 = grp[0];
    if (kind === "fin") {
      var lead = parseTop(g0.top)[0];
      if (lead) { var ln = lastWord(lead.who), hit = photoList(g0.team, "body").filter(function (p) { return lastWord(p.name) === ln; })[0]; if (hit) return hit.id; }
    }
    var pool = []; grp.forEach(function (g) { pool = pool.concat(photoList(g.team, "body")); });
    if (!pool.length) return "";
    return pool[Math.round(dateObj(g0.date) / 864e5) % pool.length].id;
  }
  function fivePhoto(team, p) {
    var mine = photoList(team).filter(function (x) { return (p.n && x.n === String(p.n)) || (!p.n && p.name && lastWord(x.name) === lastWord(p.name)); });
    var hit = mine.filter(function (x) { return x.kind === "head"; })[0] || mine[0];
    return hit ? hit.id : "";
  }
  function hashKey(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return "g" + (h >>> 0).toString(36) + s.length.toString(36); }
  function gameSig(g) { var o = {}; Object.keys(g).forEach(function (k) { if (!/^posted|updated_at/.test(k)) o[k] = g[k]; }); return o; }
  // Starting Five looks. A game keeps the one picked for it; a new game starts on the last one picked.
  var FIVE_STYLES = [["card", "Cards (square)"], ["ring", "Circles: ring"], ["pop", "Circles: pop-out"], ["badge", "Circles: plate"], ["list", "Lineup list (X uses ring)"], ["text", "List, no photos"]];
  function lastFiveStyle() { try { var v = localStorage.getItem("sb-five-style"); if (FIVE_STYLES.some(function (x) { return x[0] === v; })) return v; } catch (e) {} return "card"; }
  function gfxSpec(kind, grp, pk) {
    var g0 = grp[0], opt = gfxOpt(g0, kind);
    var spec = { kind: kind, size: state.gfxSize, ids: grp.map(function (g) { return g.id; }), pk: pk || "", side: opt.side === "left" ? "left" : "right", sponsor: sponsorFor(kind, opt), hero: "", five: [] };
    var lossNoPlayer = kind === "fin" && isNum(g0.gb) && isNum(g0.opp) && g0.gb < g0.opp; // a loss defaults to the no-player layout
    if (kind === "gd" || kind === "fin") spec.hero = opt.hero === "none" ? "" : (opt.hero && state.photos[opt.hero] ? opt.hero : lossNoPlayer ? "" : autoHero(kind, grp));
    if (kind === "lu") { spec.five = (g0.starters || []).slice(0, 5).map(function (p) { return fivePhoto(g0.team, p); }); spec.style = FIVE_STYLES.some(function (x) { return x[0] === opt.style; }) ? opt.style : lastFiveStyle(); }
    var s = state.settings, extra = kind === "fin" ? allGames().filter(function (g) { return g.team === g0.team && hasFinal(g); }).map(function (g) { return g.id + g.gb + "-" + g.opp; }).join() : "";
    spec.key = hashKey(JSON.stringify([spec, grp.map(gameSig), s.girls_name, s.boys_name, s.gym, s.strip_tag || "", s.strip_tag2 || "", extra]));
    GFXQ.specs[spec.key] = spec;
    return spec;
  }
  function drawSpec(spec) {
    return gfxReady().then(function () {
      var need = [];
      [spec.hero, spec.sponsor === "none" ? "" : spec.sponsor].concat(spec.five).forEach(function (id) { if (id && need.indexOf(id) < 0) need.push(id); });
      return Promise.all(need.map(function (id) { return photoImg(id).catch(function () { return null; }); })).then(function (imgs) {
        var map = {}; need.forEach(function (id, i) { map[id] = imgs[i]; });
        var games = spec.ids.map(function (id) { return Object.assign({ id: id }, state.games[id]); });
        var o = { ph: spec.hero && map[spec.hero] || null, side: spec.side, sponsor: spec.sponsor === "none" ? false : spec.sponsor && map[spec.sponsor] ? map[spec.sponsor].img : null };
        if (spec.kind === "gd") return drawGameday(spec.size, games, o);
        if (spec.kind === "fin") return drawFinal(spec.size, games[0], o);
        if (spec.kind === "q") return drawQuarter(spec.size, games[0], spec.pk, o);
        var g = games[0];
        return drawFive(spec.size, g, (g.starters || []).slice(0, 5), spec.five.map(function (id) {
          var x = id && map[id]; return x ? { img: x.img, m: x.m, head: (state.photos[id] || {}).kind === "head" } : null;
        }), Object.assign(o, { style: spec.style }));
      });
    });
  }
  function gfxFile(spec) {
    var g0 = state.games[spec.ids[0]] || {}, team = spec.ids.length > 1 ? "doubleheader" : String(g0.team || "").toLowerCase() === "boys" ? "bobcats" : "ladycats";
    var what = { gd: "gameday", lu: "starting-five", q: spec.pk + "-score", fin: "final" }[spec.kind];
    return what + "-" + team + "-" + (g0.date || "") + "-" + spec.size + ".png";
  }
  function selHTML(attrs, opts, cur, label) {
    return '<label class="gsel"><span>' + esc(label) + '</span><select class="sel" ' + attrs + ">" + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select></label>";
  }
  function gfxPanelHTML(kind, grp, pk) {
    var spec = gfxSpec(kind, grp, pk), g0 = grp[0], opt = gfxOpt(g0, kind), ro = state.readOnly ? " disabled" : "", ids = esc(spec.ids.join(","));
    var base = ' data-gkind="' + kind + '" data-gids="' + ids + '"' + ro;
    var ctl = '<div class="seg gseg" role="group" aria-label="Graphic size">' + [["story", "Story 9:16"], ["wide", "X 16:9"], ["feed", "Post 4:5"]].map(function (s) {
      return '<button type="button" data-gsize="' + s[0] + '" aria-pressed="' + (state.gfxSize === s[0]) + '">' + s[1] + "</button>";
    }).join("") + "</div>";
    if (kind === "gd" || kind === "fin") {
      var teams = grp.map(function (g) { return g.team; }), pool = [];
      teams.forEach(function (t) { pool = pool.concat(photoList(t, "body")); });
      var loss = kind === "fin" && isNum(g0.gb) && isNum(g0.opp) && g0.gb < g0.opp, auto = loss ? "" : autoHero(kind, grp), autoP = auto && state.photos[auto];
      var hopts = [["", "Auto" + (loss ? " (no player after a loss)" : autoP ? " (" + photoLabel(autoP) + ")" : pool.length ? "" : " (no photos yet)")], ["none", "No player"]].concat(pool.map(function (p) { return [p.id, photoLabel(p)]; }));
      ctl += selHTML('data-gopt="hero"' + base, hopts, opt.hero || "", "Player");
      ctl += '<div class="seg gseg" role="group" aria-label="Player side">' + [["left", "Left"], ["right", "Right"]].map(function (s) {
        return '<button type="button" data-gside="' + s[0] + '"' + base + ' aria-pressed="' + (spec.side === s[0]) + '">' + s[1] + "</button>";
      }).join("") + "</div>";
    }
    if (kind === "lu") ctl += selHTML('data-gopt="style"' + base, FIVE_STYLES, spec.style, "Style");
    var sopts = [["", "Default (" + sponsorName((state.settings.sponsor_def || {})[kind]) + ")"], ["tag", stripTag()], ["none", "Nothing"]].concat(Object.keys(state.sponsors).map(function (id) { return [id, state.sponsors[id].name || "Sponsor"]; }));
    ctl += selHTML('data-gopt="sponsor"' + base, sopts, opt.sponsor || "", "Sponsor");
    var missing = kind === "lu" && spec.style !== "text" ? spec.five.filter(function (x) { return !x; }).length : 0;
    return '<div class="gfx"><div class="gfx-head"><strong>' + esc(GKIND[kind]) + ' graphic</strong><a href="#library" class="hint">Photos and sponsors</a></div>' +
      '<div class="gfx-ctl">' + ctl + "</div>" +
      '<div class="gfx-prev ' + state.gfxSize + '"><img alt="' + esc(GKIND[kind]) + ' graphic preview" data-gfx="' + spec.key + '"><span class="gfx-wait">Drawing the graphic…</span></div>' +
      (missing ? '<div class="status">' + missing + " of the five ha" + (missing === 1 ? "s" : "ve") + " no photo yet, so " + (missing === 1 ? "that spot shows" : "those spots show") + " the G logo. Photos match on jersey number.</div>" : "") +
      '<div class="actions"><button type="button" class="btn primary" data-gdl="' + spec.key + '" data-gname="' + esc(gfxFile(spec)) + '">Download PNG</button><span class="status" id="gst-' + spec.key + '"></span></div>' + ttHTML(spec) + "</div>";
  }
  function paintGfx() {
    document.querySelectorAll("img[data-gfx]").forEach(function (im) {
      var h = im.dataset.gfx, c = GFXQ.cache[h], box = im.parentNode;
      if (c && c.url) { if (im.getAttribute("src") !== c.url) im.src = c.url; box.classList.add("ready"); }
      else if (c && c.err) { box.classList.remove("ready"); box.querySelector(".gfx-wait").textContent = "Couldn't draw this one. Reload the page and try again."; }
      else if (GFXQ.queue.indexOf(h) < 0) { GFXQ.queue.push(h); if (!GFXQ.running) nextGfx(); }
    });
  }
  function nextGfx() {
    var h = GFXQ.queue.shift();
    if (!h) { GFXQ.running = false; return; }
    if (GFXQ.cache[h] || !document.querySelector('img[data-gfx="' + h + '"]')) { nextGfx(); return; }
    GFXQ.running = true;
    drawSpec(GFXQ.specs[h]).then(function (c) { return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error("blob")); }, "image/png"); }); })
      .then(function (b) {
        GFXQ.cache[h] = { url: URL.createObjectURL(b), blob: b }; GFXQ.order.push(h);
        while (GFXQ.order.length > 30) { var old = GFXQ.order.shift(); if (GFXQ.cache[old] && GFXQ.cache[old].url) URL.revokeObjectURL(GFXQ.cache[old].url); delete GFXQ.cache[old]; }
      }, function (e) { GFXQ.cache[h] = { err: String((e && e.message) || e) }; })
      .then(function () { GFXQ.running = false; paintGfx(); if (!GFXQ.running) nextGfx(); });
  }
  function saveGfxOpt(kind, ids, key, val) {
    // Snapshot objects are read-only, so build a fresh copy instead of editing them in place.
    var next = Object.assign({}, state.games);
    ids.forEach(function (id) { var g = state.games[id]; if (!g) return; var gx = Object.assign({}, g.gfx || {}), one = Object.assign({}, gx[kind] || {}); one[key] = val; gx[kind] = one; next[id] = Object.assign({}, g, { gfx: gx }); });
    state.games = next;
    render();
    if (!db) return;
    Promise.all(ids.map(function (id) { var p = { gfx: {} }; p.gfx[kind] = {}; p.gfx[kind][key] = val; return db.doc("games/" + id).update(p); }))
      .catch(function (e) { handleWriteError(e, "sync"); });
  }
  function downloadGfx(btn) {
    var c = GFXQ.cache[btn.dataset.gdl], st = "gst-" + btn.dataset.gdl;
    if (!c || !c.blob) { setStatus(st, "Still drawing. Try again in a second."); return; }
    if (!downloads) { setStatus(st, "Saving files needs Brier Stats: open the Social tab there."); return; }
    downloads.save({ filename: btn.dataset.gname, data: c.blob }).then(function () { setStatus(st, "Saved."); }, function (e) {
      setStatus(st, e && e.code === "declined" ? "" : "Couldn't save the file. Try again.");
    });
  }

  // ----- Library view -----
  function libHTML() {
    var ro = state.readOnly || !assets, h = "";
    if (!assets) h += '<div class="status">Uploading and deleting need an Admin signed in to Brier Stats.</div>';
    var imp = state.settings._imported;
    if (!ro) h += '<section class="lib"><h2>Bring over from the old generator</h2><p class="status">' + (imp ? "Brought over " + esc(new Date(imp).toLocaleDateString("en-US", { month: "short", day: "numeric" })) + ". Running it again only adds what's missing."
      : "One time: pick the file Claude made from the old social post generator (old-generator.json). Its photos, caption settings, starting fives, Posted checkmarks, graphic picks, themes and notes all come over. Anything already set here stays as it is.") +
      '</p><div class="actions lib-up"><input type="file" id="lib-import" accept=".json,application/json" aria-label="The old generator file"><button type="button" class="btn' + (imp ? "" : " primary") + '" data-libimport="1">Bring it over</button></div>' +
      '<div class="status" id="lib-st-imp" aria-live="polite">' + esc(state.libStatus.imp || "") + "</div></section>";
    h += '<section class="lib"><h2>Player photos <span class="count">(' + Object.keys(state.photos).length + ")</span></h2>" +
      '<p class="status">Full-body photos must be transparent PNG cut-outs. Headshots can be PNG or JPG (any JPG uploads as a headshot). Name them like <code>24-Smith.png</code> for the full-body cut-out and <code>24-Smith-head.png</code> for a headshot, and the number and name fill in on their own. Starting fives match photos on jersey number. Uploading a photo with the same number and type replaces the old one.</p>';
    if (!ro) h += '<div class="actions lib-up"><select class="sel" id="lib-team" aria-label="Team for these photos"><option value="Girls">' + esc(nick("Girls")) + '</option><option value="Boys">' + esc(nick("Boys")) + "</option></select>" +
      '<input type="file" id="lib-file" accept="image/png,image/webp,image/jpeg" multiple aria-label="Player photo files"><button type="button" class="btn primary" data-libup="ph">Upload photos</button></div>';
    h += '<div class="status" id="lib-st-ph" aria-live="polite">' + esc(state.libStatus.ph) + "</div>";
    ["Girls", "Boys"].forEach(function (team) {
      var list = photoList(team);
      h += "<h3>" + esc(nick(team)) + " <span class=\"count\">(" + list.length + ")</span></h3>";
      if (!list.length) { h += '<div class="empty">No ' + esc(nick(team)) + " photos yet.</div>"; return; }
      h += '<div class="lib-grid">' + list.map(function (p) {
        var id = esc(p.id), dis = ro ? " disabled" : "";
        return '<div class="lib-card" data-libcard="' + id + '"><div class="lib-thumb"><img alt="' + esc(photoLabel(p)) + '" data-limg="' + id + '"></div>' +
          '<div class="lib-f"><input aria-label="Jersey number" class="num" data-libf="n" value="' + esc(p.n || "") + '" inputmode="numeric"' + dis + '><input aria-label="Name" data-libf="name" value="' + esc(p.name || "") + '"' + dis + "></div>" +
          '<div class="lib-f stack"><select class="sel" aria-label="Photo type" data-libf="kind"' + dis + '><option value="body"' + (p.kind !== "head" ? " selected" : "") + '>Full body</option><option value="head"' + (p.kind === "head" ? " selected" : "") + ">Headshot</option></select>" +
          '<select class="sel" aria-label="Team" data-libf="team"' + dis + '><option value="Girls"' + (p.team === "Girls" ? " selected" : "") + ">" + esc(nick("Girls")) + '</option><option value="Boys"' + (p.team === "Boys" ? " selected" : "") + ">" + esc(nick("Boys")) + "</option></select></div>" +
          (ro ? "" : '<div class="actions"><button type="button" class="btn small" data-libsave="photos" data-id="' + id + '">Save</button><button type="button" class="btn small danger" data-libdel="photos" data-id="' + id + '">Delete</button></div>') + "</div>";
      }).join("") + "</div>";
    });
    h += "</section>";
    var sp = Object.keys(state.sponsors).map(function (id) { return Object.assign({ id: id }, state.sponsors[id]); }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    h += '<section class="lib"><h2>Sponsor logos <span class="count">(' + sp.length + ")</span></h2>" +
      '<p class="status">PNG or JPG, ideally with a transparent or white background. The logo sits on a white plate in the "Presented by" strip at the bottom of every graphic. With no sponsor, that strip shows your bottom text (set below).</p>';
    if (!ro) h += '<div class="actions lib-up"><input type="text" class="sel" id="lib-spname" placeholder="Sponsor name" aria-label="Sponsor name"><input type="file" id="lib-spfile" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="Sponsor logo file"><button type="button" class="btn primary" data-libup="sp">Upload logo</button></div>';
    h += '<div class="status" id="lib-st-sp" aria-live="polite">' + esc(state.libStatus.sp) + "</div>";
    if (sp.length) h += '<div class="lib-grid">' + sp.map(function (p) {
      var id = esc(p.id), dis = ro ? " disabled" : "";
      return '<div class="lib-card" data-libcard="' + id + '"><div class="lib-thumb logo"><img alt="' + esc(p.name || "Sponsor") + ' logo" data-limg="' + id + '"></div>' +
        '<div class="lib-f"><input aria-label="Sponsor name" data-libf="name" value="' + esc(p.name || "") + '"' + dis + "></div>" +
        (ro ? "" : '<div class="actions"><button type="button" class="btn small" data-libsave="sponsors" data-id="' + id + '">Save</button><button type="button" class="btn small danger" data-libdel="sponsors" data-id="' + id + '">Delete</button></div>') + "</div>";
    }).join("") + "</div>";
    else h += '<div class="empty">No sponsor logos yet.</div>';
    var defs = state.settings.sponsor_def || {}, opts = [["", stripTag()], ["none", "Nothing"]].concat(sp.map(function (p) { return [p.id, p.name || "Sponsor"]; }));
    var dis2 = state.readOnly ? " disabled" : "";
    h += "<h3>Bottom text on graphics</h3><p class=\"status\">Two lines in the bottom strip when a graphic has no sponsor (also the TikTok tag card). Anything goes: a tagline, hashtags, a website. Fill in one line for a single line; leave both blank for #GOBOBCATS.</p>" +
      '<div class="actions lib-up"><input type="text" class="sel" id="lib-striptag" placeholder="Line 1, e.g. PACK THE DEN" aria-label="Bottom text, line 1" value="' + esc(state.settings.strip_tag || "") + '"' + dis2 + ">" +
      '<input type="text" class="sel" id="lib-striptag2" placeholder="Line 2, e.g. #GOBOBCATS" aria-label="Bottom text, line 2" value="' + esc(state.settings.strip_tag2 || "") + '"' + dis2 + ">" +
      (state.readOnly ? "" : '<button type="button" class="btn primary" data-striptag="1">Save</button>') + '<span class="status" id="lib-st-tag" aria-live="polite"></span></div>';
    h += "<h3>Default sponsor for each graphic</h3><p class=\"status\">Used unless you pick a different sponsor on a game's graphic.</p><div class=\"lib-defs\">" +
      ["gd", "lu", "q", "fin"].map(function (k) { return selHTML('data-spdef="' + k + '"' + (state.readOnly ? " disabled" : ""), opts, defs[k] || "", GKIND[k]); }).join("") + "</div></section>";
    return h;
  }
  // Photographer files run 15-25 MB, past the 20 MB upload cap and slow to draw. Graphics never need more than ~2400px tall.
  function isJpeg(f) { return /jpe?g/i.test(f.type || "") || /\.jpe?g$/i.test(f.name || ""); }
  function shrinkPhoto(f) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () {
        var MAX = 2400, k = Math.min(1, MAX / Math.max(im.naturalWidth, im.naturalHeight));
        if (k >= 1 && f.size < 8e6) { URL.revokeObjectURL(url); res(f); return; }
        var c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        var jt = isJpeg(f) ? "image/jpeg" : "image/png"; c.toBlob(function (b) { if (!b) { res(f); return; } try { res(new File([b], f.name, { type: jt })); } catch (e) { res(b); } }, jt, .92);
      };
      im.onerror = function () { URL.revokeObjectURL(url); res(f); };
      im.src = url;
    });
  }
  function uploadPhotos(btn) {
    var files = Array.prototype.slice.call(($("lib-file") || {}).files || []), team = $("lib-team").value;
    if (!files.length) { state.libStatus.ph = "Pick one or more photo files first."; render(); return; }
    btn.disabled = true; var i = 0, ok = 0, fails = [];
    (function step() {
      if (i >= files.length) {
        btn.disabled = false; if ($("lib-file")) $("lib-file").value = "";
        state.libStatus.ph = ok + " of " + files.length + " uploaded." + (fails.length ? " Didn't take: " + fails.join(", ") + "." : "");
        render(); return;
      }
      var f = files[i++], meta = parseFile(f.name), tm = meta.team || team;
      if (isJpeg(f)) meta.kind = "head"; // a JPG has no see-through background, so it can only be a headshot
      state.libStatus.ph = "Uploading " + i + " of " + files.length + ": " + f.name + "…"; setStatus("lib-st-ph", state.libStatus.ph);
      var olds = meta.n ? photoList(tm, meta.kind).filter(function (p) { return p.n === meta.n; }) : [];
      shrinkPhoto(f).then(function (blob) { return assets.upload(blob); }).then(function (a) {
        return db.doc("photos/" + a.id).set({ team: tm, n: meta.n, name: meta.name, kind: meta.kind, file: f.name, added: new Date().toISOString() });
      }).then(function () {
        ok++;
        return Promise.all(olds.map(function (p) { return removeAsset("photos", p.id); }));
      }).catch(function (e) { fails.push(f.name + (e && e.code === "too_large" ? " (too big even after shrinking)" : e && e.code === "not_granted" ? " (needs an Admin, with signal)" : "")); })
        .then(step);
    })();
  }
  function uploadSponsor(btn) {
    var f = (($("lib-spfile") || {}).files || [])[0], name = ($("lib-spname").value || "").trim();
    if (!f) { state.libStatus.sp = "Pick a logo file first."; render(); return; }
    btn.disabled = true; state.libStatus.sp = "Uploading " + f.name + "…"; setStatus("lib-st-sp", state.libStatus.sp);
    assets.upload(f).then(function (a) { return db.doc("sponsors/" + a.id).set({ name: name || f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "), file: f.name, added: new Date().toISOString() }); })
      .then(function () { state.libStatus.sp = "Logo added."; }, function (e) { state.libStatus.sp = "Couldn't upload that logo" + (e && e.code === "unsupported_type" ? ": use PNG, JPG, WebP or SVG." : e && e.code === "not_granted" ? ": it needs an Admin, with signal." : ". Try again."); })
      .then(function () { btn.disabled = false; if ($("lib-spfile")) $("lib-spfile").value = ""; if ($("lib-spname")) $("lib-spname").value = ""; render(); });
  }
  function importOld(btn) {
    var f = (($("lib-import") || {}).files || [])[0];
    if (!f) { state.libStatus.imp = "Pick the old-generator.json file first."; render(); return; }
    btn.disabled = true; state.libStatus.imp = "Reading " + f.name + "…"; setStatus("lib-st-imp", state.libStatus.imp);
    f.text().then(function (txt) { return JSON.parse(txt); }, function () { throw { code: "read" }; })
      .then(function (o) { return window.__SOC.importOld(o, function (m) { state.libStatus.imp = m; setStatus("lib-st-imp", m); }); })
      .then(function (r) {
        state.libStatus.imp = "Done: " + r.games + " game" + (r.games === 1 ? "" : "s") + " and " + r.photos + " photo" + (r.photos === 1 ? "" : "s") + " brought over." +
          (r.missed ? " " + r.missed + " old game" + (r.missed === 1 ? " isn't" : "s aren't") + " on the Brier Stats schedule." : "") + (r.skipped ? " " + r.skipped + " photo" + (r.skipped === 1 ? " was" : "s were") + " too big to keep." : "");
      }, function (e) {
        state.libStatus.imp = e && e.code === "invalid_argument" || e instanceof SyntaxError ? "That isn't the old generator's file." : e && e.code === "not_granted" ? "It needs an Admin signed in, with signal." : "Stopped partway. Run it again: it picks up where it left off.";
      })
      .then(function () { btn.disabled = false; if ($("lib-import")) $("lib-import").value = ""; render(); });
  }
  // Delete the db row first so nothing points at a missing file, then the file itself.
  function removeAsset(coll, id) {
    return db.doc(coll + "/" + id).delete().then(function () { return assets ? assets.delete(id).catch(function () {}) : null; });
  }
  function libSave(btn) {
    var card = btn.closest("[data-libcard]"), coll = btn.dataset.libsave, id = btn.dataset.id, patch = {};
    card.querySelectorAll("[data-libf]").forEach(function (el) { patch[el.dataset.libf] = el.value.trim(); });
    btn.disabled = true;
    db.doc(coll + "/" + id).update(patch).then(function () { btn.textContent = "Saved"; setTimeout(function () { btn.disabled = false; btn.textContent = "Save"; }, 1200); },
      function (e) { btn.disabled = false; handleWriteError(e, coll === "photos" ? "lib-st-ph" : "lib-st-sp"); });
  }
  function libDelete(btn) {
    if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Tap again to delete"; setTimeout(function () { if (btn.isConnected) { btn.dataset.confirm = ""; btn.textContent = "Delete"; } }, 4000); return; }
    btn.disabled = true;
    removeAsset(btn.dataset.libdel, btn.dataset.id).catch(function (e) { btn.disabled = false; handleWriteError(e, btn.dataset.libdel === "photos" ? "lib-st-ph" : "lib-st-sp"); });
  }

  // ----- Make TikTok: the same graphic, cut to a song's tempo and recorded in the browser. Kevin adds the sound in the TikTok app. -----
  // Loud on purpose (Kevin: big type, hard cuts): one hit per beat, then the finished graphic slams in and pulses on the beat.
  var TT = { bpm: 140, len: "long", busy: false, presets: [[100, "100 BPM (slow hip-hop)"], [128, "128 BPM (house / pop)"], [140, "140 BPM (Zombie Nation)"], [150, "150 BPM (hype trap)"]] };
  try { var _b = Number(localStorage.getItem("sb-tt-bpm")); if (_b) TT.bpm = _b; var _l = localStorage.getItem("sb-tt-len"); if (_l === "short" || _l === "long") TT.len = _l; } catch (e) {}
  function ttCards(spec) {
    var gs = spec.ids.map(function (id) { return Object.assign({ id: id }, state.games[id]); }), g0 = gs[0], C = [];
    var L = function (t, max, kind) { return { t: String(t), max: max, kind: kind || "chrome" }; };
    var two = function (t, max, kind) { // long names break into two big lines instead of one tiny one
      t = String(t || "").toUpperCase(); var w = t.split(" "); if (t.length <= 12 || w.length < 2) return [L(t, max, kind)];
      var best = 1, diff = 1e9; for (var i = 1; i < w.length; i++) { var d = Math.abs(w.slice(0, i).join(" ").length - w.slice(i).join(" ").length); if (d < diff) { diff = d; best = i; } }
      return [L(w.slice(0, best).join(" "), max, kind), L(w.slice(best).join(" "), max, kind)];
    };
    var dateLines = function (g) { var p = gDate(g.date).split(", "); return [L(p[0], 190, "white"), L(p[1] || "", 260)]; };
    if (spec.kind === "gd") {
      C.push({ lines: [L("GAME", 420)], beats: 1 }, { lines: [L("DAY", 460)], beats: 1, inv: true });
      C.push({ lines: [L(g0.home_away === "Away" ? "AT" : "VS.", 150, "soft"), ].concat(two(g0.opponent, 250)), beats: 2 });
      if (gs.length > 1) C.push({ lines: gs.map(function (g) { return L(nick(g.team).toUpperCase() + " " + (fmtTime(g.time) || "TBA").replace(" PM", ""), 170); }), beats: 2 });
      else C.push({ lines: [L("TIP-OFF", 170, "white"), L(fmtTime(g0.time) || "TBA", 260)], beats: 2 });
      C.push({ lines: dateLines(g0), beats: 2, inv: true });
      var theme = gs.map(function (g) { return g.theme || ""; }).filter(Boolean)[0];
      if (theme) C.push({ lines: [L(theme.toUpperCase(), 230)], beats: 2 });
    } else if (spec.kind === "lu") {
      C.push({ lines: [L("STARTING", 300)], beats: 1 }, { lines: [L("FIVE", 460)], beats: 1, inv: true });
      (g0.starters || []).slice(0, 5).forEach(function (p, i) { C.push({ lines: [L("#" + p.n, 330), L(lastWord(p.name || "").toUpperCase(), 190, "white")], beats: 1, inv: i % 2 === 1 }); });
    } else if (spec.kind === "fin") {
      var win = g0.gb > g0.opp, lead = parseTop(g0.top)[0];
      if (!win) return { cards: [{ lines: [L("FINAL", 360, "muted")], beats: 2 }, { lines: [L("GREENBRIER " + g0.gb, 170, "muted"), L(String(g0.opponent).toUpperCase() + " " + g0.opp, 150, "muted")], beats: 2 }], calm: true };
      C.push({ lines: [L("FINAL", 440)], beats: 2 });
      C.push({ lines: [L("GREENBRIER", 200, "white"), L(String(g0.gb), 420)], beats: 2, inv: true });
      C.push({ lines: two(g0.opponent, 190, "soft").concat([L(String(g0.opp), 300, "white")]), beats: 2 });
      if (lead) C.push({ lines: [L(lead.who.toUpperCase(), 230), L(lead.pts + " PTS", 200, "white")], beats: 2, inv: true });
    }
    return { cards: C, calm: false };
  }
  // Segments play in order: beat cards, then the finished graphic. "long" loops the set past 62 s (TikTok Creator Rewards counts videos over a minute),
  // with the colours flipped and a #GOBOBCATS / FOLLOW pair between loops so it doesn't read as one clip on repeat. It always ends on the graphic.
  function ttPlan(spec, bpm, len) {
    var c = ttCards(spec), b = 60 / bpm, segs = [], t = 0, loop = 0;
    var add = function (seg) { seg.s = t; t += seg.beats; segs.push(seg); };
    var L = function (tx, max, kind) { return { t: tx, max: max, kind: kind || "chrome" }; };
    do {
      c.cards.forEach(function (k) { add(Object.assign({}, k, { inv: loop % 2 ? !k.inv : k.inv, lay: null })); });
      add({ gfx: true, beats: loop ? 8 : 8, zoom: loop % 3 });
      if (len === "long" && (t + 4) * b < 62.5) {
        add(c.calm ? { lines: stripLines().map(function (t, i) { return L(t, i ? 120 : 200, "muted"); }), beats: 2 } : { lines: stripLines().map(function (t, i) { return L(t, i ? 140 : 230, i ? "white" : undefined); }), beats: 2, inv: loop % 2 === 0 });
        add(c.calm ? { lines: [L("FOLLOW", 200, "muted"), L("FOR EVERY GAME", 120, "muted")], beats: 2 } : { lines: [L("FOLLOW", 300), L("FOR EVERY GAME", 140, "white")], beats: 2, inv: loop % 2 === 1 });
      }
      loop++;
    } while (len === "long" && t * b < 62.5 && loop < 40);
    if (len === "long" && t * b < 62.5) segs[segs.length - 1].beats += Math.ceil(62.5 / b - t);
    var total = 0; segs.forEach(function (sg) { total = Math.max(total, sg.s + sg.beats); });
    return { segs: segs, cards: c.cards, calm: c.calm, total: total, b: b, gStart: segs.filter(function (x) { return x.gfx; })[0].s };
  }
  function ttLayout(ctx, card) {
    var out = [], h = 0;
    card.lines.forEach(function (ln) {
      var font = ln.kind === "chrome" || ln.kind === "muted" ? "italic 900 #px BC" : "900 #px BC";
      var fs = fit(ctx, font, ln.t, ln.max, 960, 40, ln.kind === "chrome" ? 0 : .03); out.push({ ln: ln, fs: fs, font: font }); h += fs * .9;
    });
    h += (out.length - 1) * 30; card.lay = out; card.h = h;
  }
  function ttFrame(ctx, P, t) {
    var W = 1080, H = 1920, b = P.b, beat = t / b, calm = P.calm;
    var ease = function (x) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3); };
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    var seg = P.segs[0]; P.segs.forEach(function (k) { if (beat >= k.s) seg = k; });
    if (seg.gfx) { // the finished graphic slams in, then breathes on every beat (later loops drift slowly so the hold isn't static)
      var lt = t - seg.s * b, inB = (beat - seg.s) % 1, e0 = 1 - ease(lt / (calm ? .6 : .22)), pulse = calm ? 0 : Math.pow(1 - inB, 4) * .018;
      var drift = seg.zoom ? .05 * Math.min(1, (beat - seg.s) / seg.beats) : 0;
      var sc = 1 + drift + (calm ? .04 : .16) * e0 + pulse, sx = calm ? 0 : (Math.random() - .5) * 26 * e0, sy = calm ? 0 : (Math.random() - .5) * 26 * e0;
      ctx.save(); ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(sc, sc); ctx.drawImage(P.gfx, -W / 2, -H / 2, W, H); ctx.restore();
      if (calm) { ctx.fillStyle = "rgba(0,0,0," + (.8 * e0) + ")"; ctx.fillRect(0, 0, W, H); }
      else { var fl = Math.max(0, 1 - lt / .14); if (fl) { ctx.fillStyle = "rgba(255,255,255," + (.75 * fl * fl) + ")"; ctx.fillRect(0, 0, W, H); } }
      return;
    }
    var card = seg;
    var local = t - card.s * b, sub = beat % 1, hit = 1 - ease(local / (calm ? .5 : .16)), pul = calm ? 0 : Math.pow(1 - sub, 5);
    var bs = 1.08 + .05 * pul + (calm ? 0 : .06 * hit), jx = calm ? 0 : (Math.random() - .5) * 40 * hit, jy = calm ? 0 : (Math.random() - .5) * 40 * hit;
    ctx.save(); ctx.translate(W / 2 + jx, H / 2 + jy); ctx.scale(bs, bs); ctx.drawImage(P.bg, -W / 2, -H / 2, W, H); ctx.restore();
    ctx.fillStyle = card.inv && !calm ? "rgba(9,74,40,.86)" : "rgba(1,10,5," + (calm ? .62 : .48) + ")"; ctx.fillRect(0, 0, W, H);
    if (card.inv && !calm) { ctx.fillStyle = "rgba(255,255,255,.08)"; for (var i = -4; i < 14; i++) { ctx.beginPath(); ctx.moveTo(i * 160, 0); ctx.lineTo(i * 160 + 70, 0); ctx.lineTo(i * 160 + 70 - 420, H); ctx.lineTo(i * 160 - 420, H); ctx.fill(); } }
    if (!card.lay) ttLayout(ctx, card);
    var ts = calm ? 1 + .05 * hit : 1 + .45 * hit + .03 * pul, y = H / 2 - card.h / 2;
    ctx.save(); ctx.translate(W / 2 + jx * .5, H / 2); ctx.scale(ts, ts); ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha = calm ? Math.min(1, local / .4) : 1;
    card.lay.forEach(function (it) {
      y += it.fs * .82; var k = it.ln.kind;
      if (k === "chrome" || k === "muted") chrome(ctx, it.ln.t, W / 2, y, it.fs, "center", k === "muted");
      else { ctx.font = it.font.replace("#", it.fs); ctx.fillStyle = k === "soft" ? "#bfe7cf" : "#fff"; shadow(ctx, "rgba(0,0,0,.85)", 22, 6); spaced(ctx, it.ln.t, W / 2, y, .03 * it.fs, "center"); noShadow(ctx); }
      y += it.fs * .08 + 30;
    });
    ctx.restore(); ctx.globalAlpha = 1;
    if (!calm) { var f2 = Math.max(0, 1 - local / .09); if (f2) { ctx.fillStyle = "rgba(255,255,255," + (.6 * f2) + ")"; ctx.fillRect(0, 0, W, H); } }
  }
  function ttMime() {
    var list = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (var i = 0; i < list.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i])) return list[i];
    return "";
  }
  // Builds everything needed to play the TikTok: the story graphic, the plain background and the beat plan.
  function ttPrepare(spec, bpm, len) {
    var sspec = Object.assign({}, spec, { size: "story" });
    return drawSpec(sspec).then(function (gfx) {
      var v = GV.story, games = spec.ids.map(function (id) { return state.games[id] || {}; }), P = ttPlan(spec, bpm, len);
      var calmMuted = P.calm, B = base(v, calmMuted, teamLabel(games.map(function (g) { return g.team; })));
      P.gfx = gfx; P.bg = B.c; return P;
    });
  }
  function makeTikTok(btn) {
    var key = btn.dataset.tt, spec = GFXQ.specs[key], st = "tst-" + key;
    if (!spec || TT.busy) return;
    var mime = ttMime();
    if (!mime) { setStatus(st, "This browser can't record video. Use Chrome or Safari on a computer."); return; }
    if (!downloads) { setStatus(st, "Saving files needs Brier Stats: open the Social tab there."); return; }
    TT.busy = true; btn.disabled = true; setStatus(st, "Setting up…");
    ttPrepare(spec, TT.bpm, TT.len).then(function (P) {
      var c = document.createElement("canvas"); c.width = 1080; c.height = 1920; c.className = "tt-canvas";
      var box = document.getElementById("ttl-" + key); if (box) { box.innerHTML = ""; box.appendChild(c); box.hidden = false; }
      var ctx = c.getContext("2d"); ttFrame(ctx, P, 0);
      var stream = c.captureStream(30), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10000000 }), chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var dur = P.total * P.b + .4, t0 = 0, last = -1;
      rec.onstop = function () {
        var blob = new Blob(chunks, { type: mime.split(";")[0] }), ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
        var name = gfxFile(Object.assign({}, spec, { size: "story" })).replace(/-story\.png$/, "-tiktok-" + (TT.len === "long" ? "62s-" : "") + TT.bpm + "bpm." + ext);
        setStatus(st, "Done (" + dur.toFixed(1) + " s). Saving…");
        downloads.save({ filename: name, data: blob }).then(function () { setStatus(st, "Saved " + name + ". Add the " + TT.bpm + " BPM song in TikTok."); }, function (e) {
          setStatus(st, e && e.code === "declined" ? "" : "Couldn't save the video. Try again.");
        }).then(function () { TT.busy = false; btn.disabled = false; });
      };
      rec.start(250);
      (function tick(now) {
        if (!t0) t0 = now; var t = (now - t0) / 1000;
        if (t >= dur) { ttFrame(ctx, P, dur); setTimeout(function () { rec.stop(); }, 120); return; }
        ttFrame(ctx, P, t);
        var s = Math.floor(t); if (s !== last) { last = s; setStatus(st, "Recording " + s + " of " + Math.ceil(dur) + " seconds… keep this tab open and in front."); }
        requestAnimationFrame(tick);
      })(performance.now());
      requestAnimationFrame(function () {});
    }).catch(function () { TT.busy = false; btn.disabled = false; setStatus(st, "Couldn't build the video. Reload and try again."); });
  }
  function ttHTML(spec) {
    if (["gd", "lu", "fin"].indexOf(spec.kind) < 0) return "";
    var ro = state.readOnly ? " disabled" : "";
    return '<div class="tt"><div class="actions">' + selHTML('data-ttbpm="1"', TT.presets.map(function (p) { return [String(p[0]), p[1]]; }), String(TT.bpm), "Song tempo") + selHTML('data-ttlen="1"', [["long", "62 sec (Creator Rewards)"], ["short", "Short (~8 sec)"]], TT.len, "Length") +
      '<button type="button" class="btn" data-tt="' + spec.key + '"' + ro + ">Make TikTok</button></div>" +
      '<div class="status" id="tst-' + spec.key + '" aria-live="polite"></div><div class="tt-live gfx-prev story" id="ttl-' + spec.key + '" hidden></div></div>';
  }
  if (typeof window.__SB_TEST === "function") window.__SB_TEST({ GFX: GFX, TT: TT, ttPrepare: ttPrepare, ttFrame: ttFrame, ttPlan: ttPlan, ttMime: ttMime, state: state, gfxReady: gfxReady, photoImg: photoImg, drawGameday: drawGameday, drawFinal: drawFinal, drawQuarter: drawQuarter, drawFive: drawFive, groupsOn: groupsOn, parseFile: parseFile, gfxSpec: gfxSpec, render: function () { render(); } });
  function readHash() { var h = (location.hash || "").replace("#", ""); state.view = h === "starters" || h === "scores" || h === "library" ? h : "gameday"; }
  readHash();
  window.addEventListener("hashchange", function () { readHash(); render(); window.scrollTo(0, 0); });
  render();

  if (!window.claude) { $("sync").textContent = "Offline"; notice("Open this from the Social tab in Brier Stats, signed in as an Admin."); return; }
  window.claude.use("assets").then(function (a) { assets = a || null; render(); }, function () {});
  window.claude.use("downloads").then(function (d) { downloads = d || null; }, function () {});
  window.claude.use("db").then(function (store) {
    if (!store) { $("sync").textContent = "Offline"; notice("Open this from the Social tab in Brier Stats, signed in as an Admin."); return; }
    db = store;
    db.collection("games").onSnapshot(function (snap) {
      var next = {};
      snap.docs.forEach(function (d) { if (d.exists) next[d.id] = d.data(); });
      state.games = next; state.loaded = true;
      $("sync").textContent = snap.size + " games · live";
      render();
    }, function () { $("sync").textContent = "Disconnected"; notice("Lost the connection to the scorebook. Reload the page."); });
    db.collection("rosters").onSnapshot(function (snap) {
      var next = { Girls: [], Boys: [] };
      snap.docs.forEach(function (d) { if (d.exists && next[d.id]) next[d.id] = (d.data().players || []); });
      state.rosters = next;
      render();
    }, function () {});
    db.collection("photos").onSnapshot(function (snap) {
      var next = {}; snap.docs.forEach(function (d) { if (d.exists) next[d.id] = d.data(); }); state.photos = next; render();
    }, function () {});
    db.collection("sponsors").onSnapshot(function (snap) {
      var next = {}; snap.docs.forEach(function (d) { if (d.exists) next[d.id] = d.data(); }); state.sponsors = next; render();
    }, function () {});
    db.doc("settings/main").onSnapshot(function (d) {
      state.settings = (d.exists && d.data()) || {};
      var s = state.settings, active = document.activeElement;
      if (!(active && active.closest && active.closest("#settings-form"))) {
        $("set-girls").value = s.girls_name || ""; $("set-boys").value = s.boys_name || ""; $("set-tags").value = s.hashtags || ""; $("set-rivals").value = s.rivals || DEFAULT_RIVALS;
        $("set-gym").value = s.gym || ""; $("set-adm").value = s.admission || ""; $("set-tix").value = s.tickets || ""; $("set-stream").value = s.stream || "";
      }
      render();
    }, function () {});
  });
})();
