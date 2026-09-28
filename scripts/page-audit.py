#!/usr/bin/env python3
"""Per-page audit for DevToolBox: visible word count, heading structure, JSON-LD
presence, viewport/canonical, and render-blocking scripts.

Two independent measurements of "thin" are kept in one place because the
site-check suite has no opinion on content size, and a tool page with 140
visible words looks identical to a 2,600-word one to every other check.

⚠️ Boolean attributes: html.parser reports a valueless attribute as None
(`<script defer>` -> ('defer', None)), NOT as ''. A naive `if not tag.get('defer')`
therefore flags every correctly-deferred script as render-blocking. This script
tests `key in attrs` instead. (The first version of this file got that wrong and
reported 31 false positives across the site.)

Usage:
  python3 scripts/page-audit.py [public] [--thin N]
Exit code 1 if any page is thinner than --thin words (default 200).
"""
import argparse
import os
import re
import sys
from html.parser import HTMLParser

VOID = {"meta", "link", "br", "img", "input", "hr", "source", "area", "base",
        "col", "embed", "param", "track", "wbr"}


def url_of(path, web):
    rel = os.path.relpath(path, web)
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    if rel == "404.html":
        return "/404"
    return "/" + rel[:-5]


class Doc(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.levels = []
        self._h = None
        self._htxt = []
        self.n_jsonld = 0
        self.scripts = []          # (src, has_defer, has_async, type)
        self.viewport = False
        self.canonical = False
        self.text = []
        self._skip = 0
        self.stack = []
        self.stray = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._h = int(tag[1])
            self._htxt = []
        if tag == "script":
            self.scripts.append((a.get("src"), "defer" in a, "async" in a, a.get("type")))
            if a.get("type") == "application/ld+json":
                self.n_jsonld += 1
            self._skip += 1
        elif tag == "style":
            self._skip += 1
        if tag == "meta" and (a.get("name") or "").lower() == "viewport":
            self.viewport = True
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = True
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._h is not None:
            self.levels.append((self._h, " ".join("".join(self._htxt).split())))
            self._h = None
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        if tag in VOID:
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.stray.append(tag)

    def handle_data(self, data):
        if self._skip:
            return
        if self._h is not None:
            self._htxt.append(data)
        self.text.append(data)


def visible_words(src):
    """Independent second measurement: regex tag-strip (no HTMLParser involved)."""
    s = re.sub(r"(?is)<script.*?</script>", " ", src)
    s = re.sub(r"(?is)<style.*?</style>", " ", s)
    s = re.sub(r"(?is)<!--.*?-->", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = re.sub(r"&[a-zA-Z#0-9]+;", " ", s)
    return len(s.split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("web", nargs="?", default="public")
    ap.add_argument("--thin", type=int, default=200)
    a = ap.parse_args()

    problems = []
    print(f"{'page':44} {'words':>6} {'h1':>3} {'h2':>3} {'jsonld':>6} "
          f"{'vp':>5} {'canon':>5}  blocking")
    for dp, dn, fn in os.walk(a.web):
        for f in sorted(fn):
            if not f.endswith(".html"):
                continue
            path = os.path.join(dp, f)
            src = open(path, encoding="utf-8").read()
            d = Doc()
            d.feed(src)
            u = url_of(path, a.web)
            words = visible_words(src)
            h1 = sum(1 for lv, _ in d.levels if lv == 1)
            h2 = sum(1 for lv, _ in d.levels if lv == 2)
            blocking = [s for (s, defer, async_, ty) in d.scripts
                        if s and not defer and not async_
                        and (ty or "").lower() in ("", "text/javascript")]
            jumps = []
            prev = 0
            for lv, _ in d.levels:
                if prev and lv - prev > 1:
                    jumps.append(f"{prev}->{lv}")
                prev = lv
            print(f"{u:44} {words:>6} {h1:>3} {h2:>3} {d.n_jsonld:>6} "
                  f"{str(d.viewport):>5} {str(d.canonical):>5}  {', '.join(blocking) or '-'}")
            if u == "/404":
                continue
            if words < a.thin:
                problems.append((u, f"thin content: {words} visible words (< {a.thin})"))
            if h1 != 1:
                problems.append((u, f"h1 count = {h1}"))
            if jumps:
                problems.append((u, f"heading level jump(s): {jumps}"))
            if d.n_jsonld == 0:
                problems.append((u, "no JSON-LD"))
            if not d.viewport:
                problems.append((u, "no viewport meta"))
            if not d.canonical:
                problems.append((u, "no canonical"))
            if d.stray:
                problems.append((u, f"unbalanced tags: {d.stray[:6]}"))
            if blocking:
                problems.append((u, f"render-blocking JS: {blocking}"))

    print("\n## findings")
    for u, m in problems:
        print(f"  {u:44} {m}")
    print(f"  total: {len(problems)}")
    return 1 if any("thin content" in m for _, m in problems) else 0


if __name__ == "__main__":
    sys.exit(main())
