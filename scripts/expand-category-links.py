#!/usr/bin/env python3
"""扩充分类页正文里的站内内链（计划第 4 项）。

1) 给每个分类页的 "🧰 Free DevToolBox Tools" 列表补上同分类真正相关的工具
   （只补页面里还没有的，幂等，可重复跑）
2) 每页底部加一个 "🔗 Related Categories" 区块，互链 3 个兄弟分类

所有描述都按工具的真实能力写（已逐个核对页面 Key Features / 实现），不编造功能。
用法: python3 scripts/expand-category-links.py [--dry-run]
"""
import os, re, sys

WEB = "public"
CAT = os.path.join(WEB, "categories")
DRY = "--dry-run" in sys.argv

# --- 每个分类页要补的工具内链：(href, 锚文本, 描述) ---
ADD_TOOLS = {
    "api-network": [
        ("/tools/timestamp-converter", "Timestamp Converter",
         "Read the epoch seconds in a response body, an <code>X-RateLimit-Reset</code> header or a <code>Retry-After</code> value as a real date and timezone."),
        ("/tools/uuid-generator", "UUID Generator",
         "Mint request IDs, correlation IDs and idempotency keys you can trace through your logs."),
        ("/tools/html-entity-encoder-decoder", "HTML Entity Encoder/Decoder",
         "Un-escape entities when an XML or HTML error page comes back with <code>&amp;lt;div&amp;gt;</code> instead of markup."),
        ("/online-regex-tester", "Regex Tester Online",
         "Write and test the patterns you pick fields out of a response body or a log line with."),
    ],
    "code-ide": [
        ("/tools/timestamp-converter", "Timestamp Converter",
         "Turn the epoch values in build output and application logs into readable dates."),
        ("/tools/hash-generator", "Hash Generator",
         "Check a downloaded artifact against its published MD5, SHA-1, SHA-256, SHA-384 or SHA-512 checksum."),
        ("/tools/url-encoder-decoder", "URL Encoder/Decoder",
         "Encode the URLs and query strings your editor's search-and-replace can't handle."),
    ],
    "database-sql": [
        ("/tools/uuid-generator", "UUID Generator",
         "Generate UUID v4 and v7 primary keys — one at a time, or 500 at once as CSV/JSON seed data."),
        ("/online-regex-tester", "Regex Tester Online",
         "Test a pattern in the browser before you translate it into a SQL <code>LIKE</code>, <code>REGEXP</code> or <code>~</code> operator."),
        ("/tools/url-encoder-decoder", "URL Encoder/Decoder",
         "Decode percent-encoded passwords and parameters buried inside a connection string."),
    ],
    "devops-cicd": [
        ("/online-regex-tester", "Regex Tester Online",
         "Build and test the pattern you pipe into <code>grep</code> or <code>jq</code> when you're filtering a build log."),
        ("/tools/url-encoder-decoder", "URL Encoder/Decoder",
         "Decode percent-encoded URLs and secrets stored in pipeline environment variables."),
        ("/tools/markdown-preview", "Markdown Preview",
         "Render the README or runbook you're about to commit before the pull request goes up."),
    ],
    "dev-tools": [
        ("/tools/minifier", "HTML Minifier",
         "Minify HTML, CSS and JavaScript — comments and extra whitespace out, <code>&lt;pre&gt;</code> and <code>&lt;script&gt;</code> content untouched."),
        ("/tools/markdown-preview", "Markdown Preview",
         "Render Markdown with tables, task lists and fenced code blocks."),
        ("/tools/image-compressor", "Image Compressor",
         "Resize and compress PNG, JPEG and WebP images in the browser — nothing is uploaded."),
        ("/tools/qrcode-tools", "QR Code Tools",
         "Generate a QR code from any text or URL, or decode one from an uploaded PNG, JPEG or WebP image."),
    ],
    "frontend-design": [
        ("/base64-encode", "Base64 Encoder",
         "Inline a small icon or font as a data URI instead of paying for another request."),
        ("/base64-decode", "Base64 Decoder",
         "Decode a data URI back to text, or check what a base64 <code>src</code> actually contains."),
        ("/tools/html-entity-encoder-decoder", "HTML Entity Encoder/Decoder",
         "Escape and un-escape the entities you meet while debugging rendered markup."),
        ("/tools/url-encoder-decoder", "URL Encoder/Decoder",
         "Encode the URLs you drop into <code>href</code>, <code>src</code> and CSS <code>url()</code> — spaces and non-ASCII characters included."),
        ("/tools/json-formatter-online", "JSON Formatter",
         "Format and validate the JSON behind design tokens, config files and API responses."),
        ("/online-regex-tester", "Regex Tester Online",
         "Test the regex behind your form validation before it ships."),
    ],
    "security-testing": [
        ("/online-regex-tester", "Regex Tester Online",
         "Test the patterns you hunt for secrets, tokens and card numbers in a log with."),
        ("/tools/uuid-generator", "UUID Generator",
         "Generate session IDs and unpredictable test tokens."),
        ("/tools/json-formatter-online", "JSON Formatter",
         "Read a JWT payload or an API error body as properly indented JSON."),
        ("/tools/timestamp-converter", "Timestamp Converter",
         "Check certificate expiry and log timestamps in a timezone you actually think in."),
    ],
}

NAME = {
    "api-network": "API & Network Tools",
    "code-ide": "Code & IDE Tools",
    "database-sql": "Database & SQL Tools",
    "devops-cicd": "DevOps & CI/CD Tools",
    "dev-tools": "Dev Tools",
    "frontend-design": "Frontend & Design Tools",
    "security-testing": "Security & Testing Tools",
}

RELATED = {
    "api-network": [("database-sql", "where most of the JSON you're decoding is ultimately stored"),
                    ("security-testing", "worth a look if you're debugging Authorization headers and tokens"),
                    ("devops-cicd", "the other side of the wire — deploying and monitoring the service you're calling")],
    "code-ide": [("dev-tools", "the general-purpose utilities an editing session keeps reaching for"),
                 ("frontend-design", "handy when the code you're editing ships to a browser"),
                 ("devops-cicd", "for the pipeline your commit is about to trigger")],
    "database-sql": [("devops-cicd", "backups, migrations and schema drift usually run in a pipeline"),
                     ("api-network", "the API layer that sits in front of the database"),
                     ("code-ide", "editor-side tooling for the SQL you're about to run")],
    "devops-cicd": [("api-network", "health checks and webhooks are HTTP calls too"),
                    ("security-testing", "verify tokens and hashes before a deploy, not after"),
                    ("database-sql", "migrations are the step that most often breaks a deploy")],
    "dev-tools": [("code-ide", "editor and IDE tooling that goes with these utilities"),
                  ("frontend-design", "browser-side tools for markup, styles and images"),
                  ("security-testing", "auditing and testing tools for the code you just wrote")],
    "frontend-design": [("code-ide", "editor-side tooling for markup, CSS and JavaScript"),
                        ("dev-tools", "general utilities that don't belong to a single stack"),
                        ("api-network", "the response side when your UI is talking to an API")],
    "security-testing": [("api-network", "where the tokens and headers you're testing come from"),
                         ("devops-cicd", "secret scanning and dependency checks belong in the pipeline"),
                         ("dev-tools", "general utilities for taking a payload apart")],
}


def tool_section_of(src):
    """返回 (ul_start, ul_end) 或 None —— 定位 'Free DevToolBox Tools' 那一节的 <ul>"""
    m = re.search(r'<h2>[^<]*Free DevToolBox Tools[^<]*</h2>', src)
    if not m:
        return None
    start = src.find("<ul>", m.end())
    if start == -1:
        return None
    end = src.find("</ul>", start)
    if end == -1:
        return None
    return start, end


def main():
    changed = 0
    for f in sorted(os.listdir(CAT)):
        if not f.endswith(".html") or f == "index.html":
            continue
        key = f[:-5]
        if key not in ADD_TOOLS:
            continue
        path = os.path.join(CAT, f)
        src = open(path, encoding="utf-8").read()
        orig = src
        added = []

        # ---- 1) 补工具内链 ----
        span = tool_section_of(src)
        if not span:
            print(f"!! {f}: 找不到 Free DevToolBox Tools 的 <ul>，跳过")
            continue
        ul_start, ul_end = span
        for href, label, desc in ADD_TOOLS[key]:
            if f'href="{href}"' in src:
                continue
            line = f'<li><a href="{href}">{label}</a> — {desc}</li>'
            src = src[:ul_end] + line + "\n" + src[ul_end:]
            ul_end += len(line) + 1
            added.append(href)

        # ---- 2) Related Categories ----
        items = RELATED.get(key, [])
        block = ('<section class="about-section"><h2>🔗 Related Categories</h2>\n<p>Sibling categories worth a look:</p><ul>\n'
                 + "".join(f'<li><a href="/categories/{c}">{NAME[c]}</a> — {why}.</li>\n' for c, why in items)
                 + "</ul></section>\n")
        if 'Related Categories' not in src:
            idx = src.rfind("</main>")
            if idx == -1:
                print(f"!! {f}: 找不到 </main>，跳过 Related Categories")
            else:
                src = src[:idx] + block + src[idx:]

        if src != orig:
            changed += 1
            if DRY:
                print(f"[dry-run] {f}: +{len(added)} 工具内链 {added} , +1 Related Categories 区块")
            else:
                open(path, "w", encoding="utf-8").write(src)
                print(f"{f}: +{len(added)} 工具内链 {added} , +1 Related Categories 区块")
        else:
            print(f"{f}: 无变化")

    print(f"\n共修改 {changed} 个文件" + ("（dry-run，未落盘）" if DRY else ""))


main()
