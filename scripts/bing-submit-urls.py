#!/usr/bin/env python3
"""Resubmit the priority URLs to Bing (POST + JSON body — GET returns 405).

Only run this when GetCrawlStats shows Bing is actually crawling again: the 2026-09-13
rule is that SubmitUrl is a zero-effect action while the crawler is stalled, and it
hides the real bottleneck. On 2026-09-21/22 CrawledPages went 0 -> 1 on two consecutive
days (first movement since 09-07), so the crawler is live again and submission is back
to being worth doing. Quota: 100/day, 800/month.

The key is NOT in this file: this repository is public, and the key used to be
hardcoded here (it is therefore still in the git history and should be rotated in
Bing Webmaster -> Settings -> API Access). It is now read from the BING_API_KEY
environment variable, falling back to the private ~/.hermes/.env.
"""
import json
import os
import urllib.request


def _key():
    k = os.environ.get("BING_API_KEY")
    if k:
        return k.strip()
    env = os.path.expanduser("~/.hermes/.env")
    if os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            if line.strip().startswith("BING_API_KEY="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("BING_API_KEY not set (env or ~/.hermes/.env) — "
                     "get it from Bing Webmaster -> Settings -> API Access")


KEY = _key()
ENDPOINT = "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch"
SITE = "https://23232322.xyz/"

PATHS = [
    "/tools/json-formatter-online",
    "/base64-encode",
    "/base64-decode",
    "/tools/minifier",
    "/online-regex-tester",
    "/tools/url-encoder-decoder",
    "/tools/jwt-debugger",
    "/tools/sql-formatter-online",
    "/tools/html-entity-encoder-decoder",
    "/tools/uuid-generator",
    "/tools/timestamp-converter",
    "/tools/text-diff",
    "/tools/cidr-calculator",
    "/tools/hash-generator",
    "/tools/qrcode-tools",
    "/tools/color-tools",
    "/tools/image-compressor",
    "/tools/markdown-preview",
    "/tools/ai-cover-generator",
    "/tools/workplace-test/",
    "/",
    "/categories/",
    "/categories/code-ide",
    "/categories/api-network",
    "/categories/database-sql",
    "/categories/frontend-design",
    "/categories/devops-cicd",
    "/categories/security-testing",
    "/categories/dev-tools",
]

urls = [SITE.rstrip("/") + p if p != "/" else SITE for p in PATHS]
body = json.dumps({"siteUrl": SITE, "urlList": urls}).encode()
req = urllib.request.Request(
    ENDPOINT + "?apikey=" + KEY,
    data=body,
    headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=90) as r:
        print(f"HTTP {r.status}  body={r.read().decode()[:200]}")
    print(f"submitted {len(urls)} urls")
    for u in urls:
        print("  " + u)
except Exception as e:
    print(f"ERROR: {e}")
