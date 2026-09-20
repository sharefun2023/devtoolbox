#!/usr/bin/env python3
"""统计每个分类页正文里的站内工具内链数量。"""
import os, re, sys, json, html
from collections import defaultdict

WEB = "public"
CAT_DIR = os.path.join(WEB, "categories")

# 收集全站真实存在的页面 URL
pages = set()
for root, dirs, files in os.walk(WEB):
    for f in files:
        if f.endswith(".html"):
            p = os.path.relpath(os.path.join(root, f), WEB)
            if p == "index.html":
                url = "/"
            elif p.endswith("/index.html"):
                url = "/" + p[:-len("index.html")]
            else:
                url = "/" + p[:-5]
            pages.add(url)

def links_in(path):
    src = open(path, encoding="utf-8").read()
    # 去掉 nav 和 footer
    body = src
    hrefs = re.findall(r'<a\s[^>]*href="([^"]+)"', body)
    out = []
    for h in hrefs:
        if h.startswith("http") or h.startswith("#") or h.startswith("mailto"):
            continue
        h = h.split("#")[0].split("?")[0]
        if not h:
            continue
        if not h.startswith("/"):
            continue
        if h.endswith("/index.html"):
            h = h[:-len("index.html")]
        if h.endswith(".html"):
            h = h[:-5]
        out.append(h)
    return out, src

print("=== 分类页内链统计（全部 <a>，含 nav/footer）===")
summary = {}
for f in sorted(os.listdir(CAT_DIR)):
    if not f.endswith(".html"):
        continue
    path = os.path.join(CAT_DIR, f)
    _, src = links_in(path)
    # 只取 <main> 或 body 里的正文区域（去掉 <nav ...>...</nav> 和 <footer>...</footer>）
    body = re.sub(r'<nav\b.*?</nav>', '', src, flags=re.S)
    body = re.sub(r'<footer\b.*?</footer>', '', body, flags=re.S)
    hrefs = re.findall(r'<a\s[^>]*href="([^"]+)"', body)
    tool_links = []
    for h in hrefs:
        if not h.startswith("/"):
            continue
        h = h.split("#")[0].split("?")[0]
        if h.endswith(".html"):
            h = h[:-5]
        if h in ("/", "/privacy", "/about") or h.startswith("/categories"):
            continue
        tool_links.append(h)
    uniq = sorted(set(tool_links))
    chars = len(re.sub(r'<[^>]+>', ' ', body))
    summary[f] = {"links": len(tool_links), "uniq": len(uniq), "targets": uniq, "chars": chars}
    print(f"{f:28s} 内链 {len(tool_links):3d} 条 / 去重 {len(uniq):3d} 个 / 正文 {chars} 字符")
    print("   ->", ", ".join(uniq))

json.dump(summary, open("/tmp/cat-links.json", "w"), indent=1, ensure_ascii=False)

print("\n=== 哪些工具页没有被任何分类页链接到 ===")
all_cat = set()
for v in summary.values():
    all_cat |= set(v["targets"])
tool_pages = set()
for root, dirs, files in os.walk(os.path.join(WEB, "tools")):
    for f in files:
        if f.endswith(".html") and f != "index.html":
            tool_pages.add("/tools/" + f[:-5])
extra = {"/online-regex-tester", "/base64-encode", "/base64-decode", "/tools/uuid-generator"}
need = (tool_pages | extra)
print("工具页总数:", len(need))
for t in sorted(need):
    if t not in all_cat:
        print("  未被链接:", t)
