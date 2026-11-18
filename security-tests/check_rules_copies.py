#!/usr/bin/env python3
"""Read-only check: the two copies of the Firestore rules inside the apps must match hoops/firestore.rules.

  hoops/index.html : the RULES string       must equal hoops/firestore.rules exactly
  index.html       : the SYNC_RULES string  must equal it too, except the owner's email appears as __OWNER_EMAIL__

Exit 0 if both match, 1 (with a message naming the copy that differs) if not. This script never writes anything.
Run from anywhere: python3 security-tests/check_rules_copies.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACEHOLDER = "__OWNER_EMAIL__"


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8", newline="") as f:
        return f.read()


def js_string(source, name, rel):
    """Find `const NAME = "...";` by name and decode the JSON-style string literal."""
    m = re.search(r"^const " + re.escape(name) + r" = (\"(?:[^\"\\\n]|\\.)*\");[ \t]*$", source, re.M)
    if not m:
        sys.exit("FAIL: could not find a single-line `const %s = \"...\";` in %s" % (name, rel))
    return json.loads(m.group(1))


def first_diff(a, b):
    la, lb = a.split("\n"), b.split("\n")
    for i in range(max(len(la), len(lb))):
        x = la[i] if i < len(la) else "<missing>"
        y = lb[i] if i < len(lb) else "<missing>"
        if x != y:
            return "first difference at rule line %d:\n    app copy : %s\n    rules file: %s" % (i + 1, x.strip()[:160], y.strip()[:160])
    return "texts differ only in line endings or trailing whitespace"


def main():
    rules = read("hoops/firestore.rules")
    emails = re.findall(r"email\.lower\(\) == '([^']+)'", rules)
    if len(emails) != 1:
        sys.exit("FAIL: expected exactly one owner email line in hoops/firestore.rules, found %d" % len(emails))
    email = emails[0]
    bad = []
    checks = [
        ("hoops/index.html", "RULES", rules),
        ("index.html", "SYNC_RULES", rules.replace(email, PLACEHOLDER)),
    ]
    for rel, name, expected in checks:
        got = js_string(read(rel), name, rel)
        if got == expected:
            print("OK   %s (%s) matches hoops/firestore.rules%s" % (rel, name, " (owner email as " + PLACEHOLDER + ")" if name == "SYNC_RULES" else ""))
        else:
            bad.append(rel)
            print("FAIL %s (%s) DIFFERS from hoops/firestore.rules\n  %s" % (rel, name, first_diff(got, expected)))
    if bad:
        print("\nThe rules copies are out of step: %s. Do not merge until they match." % ", ".join(bad))
        sys.exit(1)


if __name__ == "__main__":
    main()
