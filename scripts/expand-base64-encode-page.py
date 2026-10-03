#!/usr/bin/env python3
"""给 /base64-encode 补长尾内容 + 修结构 + 补 schema（幂等）

背景（2026-10-03）：
计划里的任务「base64 encoder KD 99→67，继续走 base64decode / base64 encode online 长尾，不碰主词」。
复核发现真正的问题不在标题（title/H1/keywords 早就精确匹配），而在三处：

1. 🚨 站上 9 处文案（首页卡片、首页 Why 区块、dev-tools / api-network / security-testing 分类页、
   hash-generator 与 url-encoder-decoder 的相关工具列表、本页 subtitle 与 meta description）
   都写着这个编码器「supports URL-safe Base64」，而实现是裸 btoa()，**没有 URL-safe 开关**。
   本次给工具补上 base64url 输出（见 base64-encode.html 的内联脚本），
   这份脚本则把长尾内容、结构、schema 一次补齐。

2. 🚨 结构错误：9/25 那次 `align-faq-visible.py` 把 FAQ 区块插进了
   「Supported Use Cases」的 <ul> **内部**（`</li>` 之后、`</ul>` 之前）——
   `ul` 的内容模型只允许 `li`，这是非法嵌套（全站仅此一处）。

3. 正文只有 688 可见词、FAQ 5 问、body 内链 7 条（其中 /categories/ 只在 nav 里出现）。

用法:
    python3 scripts/expand-base64-encode-page.py            # dry-run
    python3 scripts/expand-base64-encode-page.py --apply    # 写入
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'public' / 'base64-encode.html'
URL = 'https://23232322.xyz/base64-encode'
MARK = '<!-- dtb:b64e-expanded -->'

NEW_DESC = ('Free online Base64 encoder — encode text or files to Base64 or base64url instantly. '
            'UTF-8 safe, URL-safe output, file to Base64 data URI. Nothing uploaded.')

NEW_KEYWORDS = ('base64 encoder, base64 encode online, base64encode, online base64 encoder, encode to base64, '
                'base64url encoder, url-safe base64 encoder, base64 converter, text to base64, file to base64, '
                'base64 encode, free base64 encoder, base64 encoder tool')

NEW_SUBTITLE = ('Encode text and files to Base64 instantly — UTF-8 safe, optional URL-safe (base64url) output, '
                '100% browser-based')

# ── FAQ：可见文本与 FAQPage schema 由同一份数据生成，所以不可能漂移 ──────────────
FAQ = [
    ('What is a Base64 encoder?',
     "A Base64 encoder converts binary data or text into a 64-character ASCII string (A-Z, a-z, 0-9, +, /). "
     "It's used to safely transmit binary data over text-based protocols like email (MIME), embed images in "
     "HTML/CSS as data URIs, and store binary data in JSON or XML formats."),
    ('How do I use this online Base64 encoder?',
     "Simply type or paste your text into the input field above and click the Encode button. The tool converts "
     "your text to Base64 instantly. You can also use the File → Base64 tab to encode images, PDFs, and other "
     "binary files. All processing happens locally in your browser — no data is sent to any server."),
    ('Can I encode files to Base64 online?',
     "Yes! Switch to the File → Base64 tab, select any file from your device, and the tool will instantly "
     "convert it to a Base64 string. The output can be used for data URIs, API requests, or anywhere "
     "Base64-encoded data is required. There's no file size limit since processing happens locally."),
    ('Does this encoder support URL-safe Base64 (base64url)?',
     "Yes. Tick the URL-safe (base64url) box on the Text → Base64 tab and the output switches to the RFC 4648 "
     "§5 alphabet: - instead of +, _ instead of /, and the trailing = padding removed. That is the form JWT "
     "segments, URL query parameters and filenames require. The File → Base64 tab always emits standard "
     "Base64, because data URIs need the + and / alphabet."),
    ('Is this Base64 encoder free?',
     "Absolutely. This online Base64 encoder is completely free with no usage limits, no registration required, "
     "and no ads. All encoding happens in your browser for maximum privacy and security."),
    ('Does this encoder support UTF-8 and special characters?',
     "Yes! Our Base64 encoder handles Unicode text including emoji, Chinese characters, and special symbols "
     "correctly by encoding through UTF-8 before Base64 conversion. Most basic btoa() implementations fail on "
     "non-Latin characters — ours handles them properly."),
    ('Is Base64 encoding the same as encryption?',
     "No, and the difference matters. Base64 is a reversible transport encoding with no key: anyone who has the "
     "string can decode it in one step, which is exactly why it is used for JWTs and data URIs. Never treat "
     "Base64 as protection — a Base64-encoded password, API key or token is still plain text to anyone who "
     "receives it. Use TLS in transit and real encryption at rest."),
    ('How do I turn a file into a data URI with this encoder?',
     "Switch to the File → Base64 tab, choose the file, and copy the output. Then paste it after a MIME prefix: "
     "data:image/png;base64,iVBORw0KGgo= for a PNG, or data:image/svg+xml;base64,... for an SVG. Note that "
     "Base64 inflates the payload by about 33%, so data URIs are best for small assets such as icons and "
     "fonts — not for photos."),
    ('Is there a size limit on this base64 encode online tool?',
     "There is no server-side limit, because nothing is uploaded — the whole string is built in your browser's "
     "memory. In practice the ceiling is your device: a multi-megabyte file produces a Base64 string about a "
     "third larger than the file, and pasting that into a data URI will make a page slow to load. For large "
     "files, keep the Base64 in its own .b64 file instead of inline in HTML."),
]

USECASES = [
    ('Data URIs', 'embed images directly in HTML/CSS: <code>data:image/png;base64,...</code>'),
    ('API payloads', 'encode binary data for JSON or XML API requests'),
    ('Email attachments', 'MIME Base64 encoding for file attachments'),
    ('CSS inline assets', 'inline fonts, SVGs, and background images'),
    ('JSON Web Tokens (JWT)', 'encode header and payload segments'),
    ('Kubernetes secrets', 'encode configuration values for k8s manifests'),
]


def faq_markup():
    out = ['  <!-- dtb:faq-visible -->',
           '  <section class="faq-visible" style="margin-top:24px;line-height:1.7;color:var(--muted)">',
           '    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">❓ Frequently Asked Questions</h2>']
    for q, a in FAQ:
        out.append(f'    <p style="margin-bottom:8px"><strong>{q}</strong> {a}</p>')
    out.append('  </section>')
    return '\n'.join(out)


def faq_schema():
    d = {'@context': 'https://schema.org', '@type': 'FAQPage',
         'mainEntity': [{'@type': 'Question', 'name': q,
                         'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in FAQ]}
    return json.dumps(d, ensure_ascii=False, indent=2)


def webapp_schema():
    d = {'@context': 'https://schema.org', '@type': 'WebApplication',
         'name': 'Base64 Encoder',
         'description': NEW_DESC,
         'applicationCategory': 'DeveloperApplication',
         'operatingSystem': 'Any',
         'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
         'url': URL,
         'dateModified': '2026-10-03'}
    return json.dumps(d, ensure_ascii=False, indent=2)


def breadcrumb_schema():
    d = {'@context': 'https://schema.org', '@type': 'BreadcrumbList',
         'itemListElement': [
             {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://23232322.xyz/'},
             {'@type': 'ListItem', 'position': 2, 'name': 'Base64 Encoder', 'item': URL}]}
    return json.dumps(d, ensure_ascii=False, indent=2)


def body_block():
    usecases = '\n'.join(
        f'      <li style="margin-bottom:6px"><strong>{n}</strong> — {d}</li>' for n, d in USECASES)
    return f'''{MARK}
  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">📋 Supported Use Cases</h2>
    <ul style="padding-left:20px">
{usecases}
    </ul>
  </section>

  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🔤 Standard Base64 vs base64url — which output do you need?</h2>
    <p>There are two alphabets in RFC 4648 and they are not interchangeable. Picking the wrong one is the most common reason a JWT or a URL parameter fails to decode on the other side.</p>
    <ul style="padding-left:20px">
      <li style="margin-bottom:6px"><strong>Standard Base64</strong> (RFC 4648 §4) uses all 64 characters including <code>+</code> and <code>/</code>, and pads the result with <code>=</code> so the length is always a multiple of four. Use it for data URIs, MIME email bodies, HTTP Basic auth headers, and Kubernetes secrets.</li>
      <li style="margin-bottom:6px"><strong>base64url</strong> (RFC 4648 §5) swaps those two characters for <code>-</code> and <code>_</code> and drops the trailing padding. Use it for JWT segments, URL query parameters, cookie values, and anywhere the string has to survive a URL or a filename untouched.</li>
    </ul>
    <p>The same input, encoded both ways with this tool:</p>
    <ul style="padding-left:20px">
      <li style="margin-bottom:6px"><code>??&gt;&gt;??~</code> → standard <code>Pz8+Pj8/fg==</code></li>
      <li style="margin-bottom:6px"><code>??&gt;&gt;??~</code> → base64url <code>Pz8-Pj8_fg</code></li>
    </ul>
    <p>Both of those decode back to the original text on our <a href="/base64-decode" style="color:var(--accent)">Base64 decoder</a>, which normalises either alphabet before decoding — so you never have to guess which form you were handed. Whether you arrived here searching for base64encode, base64 encode online or base64 converter, this page is the same one-step tool: text in, Base64 out, nothing uploaded.</p>
  </section>

  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🗂 Turn a file into a data URI</h2>
    <p>The File → Base64 tab reads the file locally with the browser's FileReader API and strips the data URI prefix for you, so you get the raw Base64 payload ready to paste anywhere:</p>
    <ol style="padding-left:20px">
      <li style="margin-bottom:6px">Choose the file — PNG, JPEG, SVG, WOFF2, PDF, anything.</li>
      <li style="margin-bottom:6px">Copy the output, then prefix it: <code>data:image/png;base64,iVBORw0KGgo=</code> for a PNG, <code>data:image/svg+xml;base64,...</code> for an SVG, <code>data:font/woff2;base64,...</code> for a web font.</li>
      <li style="margin-bottom:6px">Paste it into your HTML, CSS or JSON. Everything stays on your machine — the file is never uploaded.</li>
    </ol>
    <p>Two honest caveats: Base64 makes the payload about <strong>33% larger</strong> than the original file, and it cannot be compressed further or cached separately from the page. Data URIs are a good fit for small icons, logos and critical fonts, and a poor fit for photos and videos.</p>
  </section>

  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🚫 What this Base64 encoder does not do</h2>
    <p>Worth knowing before you use the output somewhere it will not work:</p>
    <ul style="padding-left:20px">
      <li style="margin-bottom:6px"><strong>It is not encryption.</strong> Base64 has no key and is trivially reversible — it hides nothing from anyone who receives the string.</li>
      <li style="margin-bottom:6px"><strong>URL-safe mode is text-only.</strong> The File tab always emits standard Base64, because data URIs require the <code>+</code> and <code>/</code> alphabet.</li>
      <li style="margin-bottom:6px"><strong>No batch or folder upload.</strong> One file per run — there is no multi-file queue.</li>
      <li style="margin-bottom:6px"><strong>No MIME line wrapping.</strong> RFC 2045 wraps base64 at 76 characters for email; the output here is a single unbroken line. If a mail library needs the wrapped form, wrap it yourself.</li>
      <li style="margin-bottom:6px"><strong>No streaming.</strong> Input and output both live in memory, so very large files depend on your device, not on us.</li>
      <li style="margin-bottom:6px"><strong>It only encodes.</strong> Decoding a string, including URL-safe input and image data URIs, happens on the <a href="/base64-decode" style="color:var(--accent)">Base64 decoder</a> page.</li>
    </ul>
  </section>

  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🔗 Related tools</h2>
    <ul style="padding-left:20px">
      <li style="margin-bottom:6px"><a href="/base64-decode" style="color:var(--accent)">Base64 Decoder</a> — decode either alphabet back to text or binary, including image data URIs.</li>
      <li style="margin-bottom:6px"><a href="/tools/jwt-debugger" style="color:var(--accent)">JWT Debugger</a> — split a token into its base64url segments and verify the signature.</li>
      <li style="margin-bottom:6px"><a href="/tools/url-encoder-decoder" style="color:var(--accent)">URL Encoder / Decoder</a> — percent-encode the values you are about to put in a query string.</li>
      <li style="margin-bottom:6px"><a href="/tools/hash-generator" style="color:var(--accent)">Hash Generator</a> — MD5 / SHA checksums, for when you need integrity rather than encoding.</li>
      <li style="margin-bottom:6px"><a href="/tools/image-compressor" style="color:var(--accent)">Image Compressor</a> — shrink an image before you turn it into a data URI.</li>
      <li style="margin-bottom:6px"><a href="/categories/api-network" style="color:var(--accent)">API &amp; Network tools</a> — everything for request and response bodies.</li>
      <li style="margin-bottom:6px"><a href="/categories/security-testing" style="color:var(--accent)">Security &amp; Testing tools</a> — tokens, hashes, certificates and payloads.</li>
      <li style="margin-bottom:6px"><a href="/categories/dev-tools" style="color:var(--accent)">Developer Tools</a> — the rest of the DevToolBox toolbox.</li>
    </ul>
  </section>

{faq_markup()}
'''


def main(apply):
    s = PAGE.read_text(encoding='utf-8')
    if MARK in s:
        print('already expanded — 0 changes')
        return 0

    # ── ① 正文区块：从「Supported Use Cases」到错误的 </ul></section> 整段替换 ──────
    pat = re.compile(
        r'  <section style="margin-top:24px;line-height:1\.7;color:var\(--muted\);font-size:\.88rem">\s*'
        r'<h2 style="color:var\(--text\);font-size:1\.1rem;margin-bottom:12px">📋 Supported Use Cases</h2>'
        r'.*?\n    </ul>\n  </section>\n', re.S)
    m = pat.search(s)
    if not m:
        print('✗ 找不到 Supported Use Cases 区块，未改动')
        return 1
    print(f'① 正文区块：替换 {len(m.group(0))} 字符（FAQ 原本在 <ul> 内部 → 移出）')
    s = s[:m.start()] + body_block() + s[m.end():]

    # ── ② head 三件套 schema（原来只有 FAQPage）───────────────────────────────
    blocks = list(re.finditer(r'<script type="application/ld\+json">.*?</script>', s, re.S))
    faq_old = [b for b in blocks if '"FAQPage"' in b.group(0)]
    if len(faq_old) != 1:
        print(f'✗ FAQPage schema 块数量异常: {len(faq_old)}')
        return 1
    b = faq_old[0]
    new = f'<script type="application/ld+json">\n{webapp_schema()}\n</script>\n' \
          f'<script type="application/ld+json">\n{breadcrumb_schema()}\n</script>\n' \
          f'<script type="application/ld+json">\n{faq_schema()}\n</script>'
    print(f'② schema：FAQPage {len(b.group(0))} 字符 → WebApplication + BreadcrumbList + FAQPage({len(FAQ)} 问)')
    s = s[:b.start()] + new + s[b.end():]

    # ── ③ head 文案 ─────────────────────────────────────────────────────────
    s = re.sub(r'(<meta name="description" content=").*?(">)',
               lambda mm: mm.group(1) + NEW_DESC + mm.group(2), s, count=1)
    s = re.sub(r'(<meta name="keywords" content=").*?(">)',
               lambda mm: mm.group(1) + NEW_KEYWORDS + mm.group(2), s, count=1)
    s = re.sub(r'(<p class="subtitle">).*?(</p>)',
               lambda mm: mm.group(1) + NEW_SUBTITLE + mm.group(2), s, count=1)
    print(f'③ head：description {len(NEW_DESC)} 字 / keywords / subtitle（URL-safe 现在是真功能）')

    assert len(NEW_DESC) <= 160, len(NEW_DESC)
    assert MARK in s and s.count(MARK) == 1

    if apply:
        PAGE.write_text(s, encoding='utf-8')
        print('已写入 public/base64-encode.html')
    else:
        print('(dry-run，未写入)')
    return 0


if __name__ == '__main__':
    sys.exit(main('--apply' in sys.argv))
