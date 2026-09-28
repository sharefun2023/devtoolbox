#!/usr/bin/env python3
"""DevToolBox fresh audit (2026-09-28): things never checked before.

A) JSON-LD required/recommended properties per @type (Google Rich Results rules)
B) internal anchor links  href="#frag" / "page#frag" -> does the target id exist?
C) pages served 200 but absent from sitemap (orphans)
D) <html lang> sanity, duplicate meta keywords, images missing alt
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

WEB = sys.argv[1] if len(sys.argv) > 1 else "public"


def walk_pages(root):
    for dp, dn, fn in os.walk(root):
        for f in fn:
            if f.endswith(".html"):
                yield os.path.join(dp, f)


def url_of(path):
    rel = os.path.relpath(path, WEB)
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    if rel == "404.html":
        return "/404"
    return "/" + rel[:-5]  # x.html -> /x


class Grab(HTMLParser):
    """Collect: ids, anchors(href+text), imgs, jsonld blocks, lang."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = set()
        self.anchors = []          # (href, text)
        self.imgs = []             # (src, alt or None)
        self.jsonld = []
        self.lang = None
        self._in_script = False
        self._script_type = None
        self._buf = []
        self._a_href = None
        self._a_text = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "html" and self.lang is None:
            self.lang = a.get("lang")
        if tag == "a":
            self._a_href = a.get("href")
            self._a_text = []
        if tag == "script":
            self._script_type = a.get("type", "")
            if self._script_type == "application/ld+json":
                self._in_script = True
                self._buf = []
        if tag == "img":
            self.imgs.append((a.get("src"), a.get("alt")))

    def handle_endtag(self, tag):
        if tag == "a" and self._a_href is not None:
            self.anchors.append((self._a_href, "".join(self._a_text).strip()))
            self._a_href = None
        if tag == "script" and self._in_script:
            self.jsonld.append("".join(self._buf))
            self._in_script = False
            self._script_type = None

    def handle_data(self, data):
        if self._in_script:
            self._buf.append(data)
        if self._a_href is not None:
            self._a_text.append(data)


REQUIRED = {
    "WebApplication": ([], ["name", "url", "applicationCategory", "operatingSystem", "offers"]),
    "SoftwareApplication": ([], ["name", "applicationCategory", "operatingSystem", "offers"]),
    "FAQPage": ([], ["mainEntity"]),
    "BreadcrumbList": ([], ["itemListElement"]),
    "HowTo": ([], ["name", "step"]),
    "ItemList": ([], ["itemListElement"]),
    "WebSite": ([], ["name", "url"]),
    "Article": ([], ["headline", "author", "datePublished"]),
}

# flatten jsonld graph
def nodes(obj, out):
    if isinstance(obj, dict):
        if "@type" in obj:
            out.append(obj)
        for v in obj.values():
            nodes(v, out)
    elif isinstance(obj, list):
        for v in obj:
            nodes(v, out)


pages = sorted(walk_pages(WEB))
print(f"# pages scanned: {len(pages)}")

# sitemap urls
sm = os.path.join(WEB, "sitemap.xml")
sm_urls = set()
if os.path.exists(sm):
    txt = open(sm, encoding="utf-8").read()
    sm_urls = set(re.findall(r"<loc>([^<]+)</loc>", txt))
print(f"# sitemap urls: {len(sm_urls)}")

A_issues, B_issues, C_issues, D_issues = [], [], [], []
all_ids = {}
all_kw = {}
sm_paths = {u.replace("https://23232322.xyz", "") or "/" for u in sm_urls}
sm_paths |= {p.rstrip("/") or "/" for p in list(sm_paths)}

for p in pages:
    src = open(p, encoding="utf-8").read()
    g = Grab()
    g.feed(src)
    u = url_of(p)
    all_ids[p] = g.ids

    # ---- A: JSON-LD required props
    for block in g.jsonld:
        try:
            obj = json.loads(block)
        except Exception as e:
            A_issues.append((u, f"INVALID JSON-LD: {e}"))
            continue
        nd = []
        nodes(obj, nd)
        for n in nd:
            t = n.get("@type")
            types = t if isinstance(t, list) else [t]
            for tt in types:
                if tt in REQUIRED:
                    miss = [k for k in REQUIRED[tt][1] if k not in n]
                    if miss:
                        A_issues.append((u, f"{tt} missing: {', '.join(miss)}"))

    # ---- D: lang / kw / alt
    if g.lang not in ("en", "en-US", "en-us"):
        D_issues.append((u, f"html lang={g.lang!r}"))
    kws = re.findall(r'<meta name="keywords" content="([^"]*)"', src)
    if kws:
        if len(kws) > 1:
            D_issues.append((u, f"{len(kws)} meta keywords tags"))
        all_kw.setdefault(kws[0], []).append(u)
    for src_, alt in g.imgs:
        if alt is None:
            D_issues.append((u, f"img missing alt: {src_}"))

    # ---- C: orphan (200 page but not in sitemap, and indexable)
    if u.startswith("/404") or u == "/404":
        continue
    norm = u.rstrip("/") or "/"
    if norm not in sm_paths:
        C_issues.append((u, "page exists but NOT in sitemap"))

# ---- B: anchors (needs cross-page id map)
for p in pages:
    g = Grab()
    g.feed(open(p, encoding="utf-8").read())
    u = url_of(p)
    for href, txt in g.anchors:
        if not href or href.startswith(("http://", "https://", "mailto:", "tel:", "javascript:")):
            continue
        if href.startswith("#"):
            frag, target = href[1:], u
            if frag and frag not in all_ids.get(p, set()):
                B_issues.append((u, f"#{frag} (same page) missing id"))
        elif "#" in href:
            path, frag = href.split("#", 1)
            if not frag:
                continue
            # resolve target file
            cand = None
            for f in pages:
                if url_of(f).rstrip("/") == path.rstrip("/") or url_of(f) == path:
                    cand = f
                    break
            if cand and frag not in all_ids.get(cand, set()):
                B_issues.append((u, f"{href} target has no id={frag}"))

print("\n## A) JSON-LD required properties")
for u, m in A_issues[:80]:
    print(f"  {u:44} {m}")
print(f"  total: {len(A_issues)}")

print("\n## B) broken fragment anchors")
for u, m in B_issues[:80]:
    print(f"  {u:44} {m}")
print(f"  total: {len(B_issues)}")

print("\n## C) 200 pages missing from sitemap")
for u, m in C_issues:
    print(f"  {u:44} {m}")
print(f"  total: {len(C_issues)}")

print("\n## D) lang / keywords / alt")
for u, m in D_issues[:80]:
    print(f"  {u:44} {m}")
print(f"  total: {len(D_issues)}")
dups = {k: v for k, v in all_kw.items() if len(v) > 1}
if dups:
    print("  duplicate keywords values:")
    for k, v in dups.items():
        print(f"    {k[:60]!r} -> {len(v)} pages: {v}")
