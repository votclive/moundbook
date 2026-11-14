#!/usr/bin/env python3
"""Brier Stats: the one build step. Run it after ANY edit to hoops/index.html or another cached file, before testing.
(A copy also sits with the tests in the project files; this one in the repo is the one to use.)

    python3 stamp.py <hoops dir>            writes the two stamps
    python3 stamp.py <hoops dir> --check    changes nothing; exit code 1 if a stamp is stale

1. The page's lock. index.html's Content-Security-Policy names the one script allowed to run by the SHA-256 of its text.
   Change one character of the script without re-stamping and the browser refuses to run it: a blank page on every device.
2. The service worker's cache name in sw.js: "brierstats-<BS_VERSION>-" + the first 10 hex of the SHA-256 over the FILES
   in order, skipping "./" (so devices pick up the new files).
"""
import sys, re, hashlib, base64, os
d = sys.argv[1]; check = "--check" in sys.argv[2:]
p = os.path.join(d, "index.html"); s = open(p, encoding="utf-8", newline="").read()
if s.count("<script") != 1 or "\r" in s: sys.exit("index.html must hold exactly one <script> and no CR characters")
a = s.index("<script>") + len("<script>"); b = s.rindex("</script>")
h = base64.b64encode(hashlib.sha256(s[a:b].encode("utf-8")).digest()).decode()
m = re.search(r"script-src 'self' 'sha256-([A-Za-z0-9+/=]*)'", s)
if not m: sys.exit("index.html has no script-src 'self' 'sha256-…' in its Content-Security-Policy")
stale = []
if m.group(1) != h:
    stale.append("the page's lock (index.html)")
    if not check: s = s[:m.start(1)] + h + s[m.end(1):]; open(p, "w", encoding="utf-8", newline="").write(s)
ver = re.search(r'const BS_VERSION = "([^"]+)"', s).group(1)
q = os.path.join(d, "sw.js"); sw = open(q, encoding="utf-8", newline="").read()
files = re.findall(r'"([^"]+)"', re.search(r"const FILES = \[(.*?)\];", sw, re.S).group(1))
x = hashlib.sha256()
for f in files:
    if f != "./": x.update(open(os.path.join(d, f), "rb").read())
name = "brierstats-%s-%s" % (ver, x.hexdigest()[:10])
old = re.search(r'const CACHE = "([^"]+)"', sw)
if old.group(1) != name:
    stale.append("the cache name (sw.js)")
    if not check: open(q, "w", encoding="utf-8", newline="").write(sw[:old.start(1)] + name + sw[old.end(1):])
print(("STALE: " if check else "stamped: ") + ", ".join(stale) if stale else "stamps are current", "| sha256-" + h, "|", name)
sys.exit(1 if check and stale else 0)
