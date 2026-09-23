#!/usr/bin/env python3
"""Add <link rel="icon"> / apple-touch-icon to every deployed HTML page (idempotent).

Why: no page declared an icon and no /favicon.ico existed, so every browser and every
crawler that requests the default path got a 404 on all 32 pages. The default path is
now a real file (scripts/make-favicon.py); these tags additionally declare the vector
icon and the apple-touch icon explicitly, with absolute /-rooted hrefs.

Run:  python3 scripts/add-favicon-links.py          (dry run)
      python3 scripts/add-favicon-links.py --apply
"""
import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBROOT = os.path.join(ROOT, "public")

BLOCK = (
    '  <link rel="icon" href="/favicon.ico" sizes="any">\n'
    '  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n'
    '  <link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
)

MARKER = 'rel="icon"'


def insert(src):
    """Insert the icon block before canonical (deterministic anchor), else before </head>."""
    if MARKER in src:
        return None
    anchor = re.search(r'^([ \t]*)<link rel="canonical"', src, re.M)
    if anchor:
        return src[: anchor.start()] + BLOCK + src[anchor.start():]
    m = re.search(r'^([ \t]*)</head>', src, re.M)
    if not m:
        return None
    return src[: m.start()] + BLOCK + src[m.start():]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    changed, skipped, missing = [], [], []
    for dirpath, _, files in os.walk(WEBROOT):
        for f in sorted(files):
            if not f.endswith(".html"):
                continue
            path = os.path.join(dirpath, f)
            rel = os.path.relpath(path, WEBROOT)
            with open(path, encoding="utf-8") as fh:
                src = fh.read()
            out = insert(src)
            if out is None:
                (skipped if MARKER in src else missing).append(rel)
                continue
            changed.append(rel)
            if args.apply:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(out)

    verb = "updated" if args.apply else "would update"
    print(f"{verb}: {len(changed)} pages")
    for r in changed:
        print(f"  + {r}")
    if skipped:
        print(f"already had an icon link: {len(skipped)}")
    if missing:
        print(f"NO </head> FOUND (investigate): {missing}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
