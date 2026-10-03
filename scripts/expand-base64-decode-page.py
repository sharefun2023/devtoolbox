#!/usr/bin/env python3
"""给 /base64-decode 补长尾内容 + 让 FAQ schema 覆盖页面上全部可见问答（幂等）

背景（2026-10-03）：计划里的任务除了 base64 encode online，还点名 base64decode 这个长尾。
复核 /base64-decode 发现：正文只有 793 可见词（补完编码页后它是全站第二薄的真工具页），
FAQ 页面上有 8 问、schema 里只有 5 问（另外 3 问没进结构化数据），正文里没有交代
「这个解码器到底接受哪些输入」——而这些行为都已经有测试证明（scripts/base64-decode-tool-test.js，20 条断言）。

本脚本：
  ① 把 8 条可见问答解析出来，加 1 条 base64decode 长尾问答，**可见文本与 FAQPage schema 同源重写**
  ② 新增「解码器接受什么输入」正文块（每条都对应一条已有断言，不是臆测）
  ③ 新增图片解码说明 + Related tools 内链（含 3 个分类页）

用法:
    python3 scripts/expand-base64-decode-page.py            # dry-run
    python3 scripts/expand-base64-decode-page.py --apply
"""
import html as H
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'public' / 'base64-decode.html'
MARK = '<!-- dtb:b64d-expanded -->'
TODAY = '2026-10-03'

NEW_QA = (
    'Is this the same thing as the base64decode command?',
    "There is no base64decode command — people write it that way when they mean the decode step of "
    "base64. What exists is <code>base64 -d</code> on Linux and macOS, <code>base64_decode()</code> in PHP, "
    "<code>base64.b64decode()</code> in Python, and <code>atob()</code> in JavaScript. This page does the "
    "same job in your browser: paste the string, press Decode. Everything below — padding, base64url, "
    "whitespace, data URIs — is handled the same way those tools handle it.",
)

BODY = '''{mark}
  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🧩 What this Base64 decoder accepts</h2>
    <p>Decoders differ mainly in how forgiving they are. These are the exact behaviours of this one — not marketing copy:</p>
    <ul style="padding-left:20px">
      <li style="margin-bottom:6px"><strong>Standard Base64</strong> with or without the trailing <code>=</code> padding — <code>aGVsbG8=</code> and <code>aGVsbG8</code> both decode to <code>hello</code>.</li>
      <li style="margin-bottom:6px"><strong>base64url</strong> (RFC 4648 §5): <code>-</code> and <code>_</code> are mapped back to <code>+</code> and <code>/</code> before decoding, so JWT segments and URL parameters work without editing.</li>
      <li style="margin-bottom:6px"><strong>Whitespace and newlines anywhere</strong> — Base64 pasted out of an email client or a PEM-style file is stripped of spaces and line breaks first.</li>
      <li style="margin-bottom:6px"><strong>Data URI prefixes</strong> — <code>data:image/png;base64,iVBORw0KGgo=</code> has the <code>data:…,</code> part removed automatically, so you can paste a whole CSS value.</li>
      <li style="margin-bottom:6px"><strong>UTF-8 output</strong> — the bytes are decoded as UTF-8, so emoji, Chinese, Japanese and accented Latin text come back readable instead of as mojibake.</li>
      <li style="margin-bottom:6px"><strong>A length that cannot be Base64 is rejected</strong> — a string whose length leaves a remainder of 1 when divided by four is impossible in Base64, and is reported as invalid instead of silently returning garbage.</li>
      <li style="margin-bottom:6px"><strong>Invalid characters produce an error message</strong>, not a crash and not a half-decoded string.</li>
    </ul>
  </section>

  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🖼️ Turning Base64 back into an image</h2>
    <p>The <strong>Extract Image</strong> button looks at the first bytes of the decoded data to work out the type — PNG, JPEG, GIF, WebP or SVG — builds a <code>data:</code> URL from them and shows a preview on the page. Nothing is uploaded: the image is reconstructed in your browser from the string you pasted.</p>
    <p>Two practical notes: if the string is a plain text payload rather than an image, the preview reports that it could not be rendered as an image instead of showing a broken box; and very large images (several megabytes of Base64) will make the tab slow, because the whole string is held in memory.</p>
  </section>

  <section style="margin-top:24px;line-height:1.7;color:var(--muted);font-size:.88rem">
    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">🔗 Related tools</h2>
    <ul style="padding-left:20px">
      <li style="margin-bottom:6px"><a href="/base64-encode" style="color:var(--accent)">Base64 Encoder</a> — the reverse direction, with standard or URL-safe (base64url) output.</li>
      <li style="margin-bottom:6px"><a href="/tools/jwt-debugger" style="color:var(--accent)">JWT Debugger</a> — decode both base64url segments of a token and verify its signature.</li>
      <li style="margin-bottom:6px"><a href="/tools/url-encoder-decoder" style="color:var(--accent)">URL Encoder / Decoder</a> — percent-decode the query string around your Base64 value.</li>
      <li style="margin-bottom:6px"><a href="/tools/hash-generator" style="color:var(--accent)">Hash Generator</a> — check whether a payload really is what you think it is.</li>
      <li style="margin-bottom:6px"><a href="/categories/api-network" style="color:var(--accent)">API &amp; Network tools</a> — for request and response bodies that arrive Base64-encoded.</li>
      <li style="margin-bottom:6px"><a href="/categories/security-testing" style="color:var(--accent)">Security &amp; Testing tools</a> — tokens, hashes and payload decoding.</li>
      <li style="margin-bottom:6px"><a href="/categories/dev-tools" style="color:var(--accent)">Developer Tools</a> — the rest of the DevToolBox toolbox.</li>
    </ul>
  </section>

'''


def parse_visible_faq(s):
    """把可见 FAQ 区块里的 <p><strong>Q</strong> A</p> 解析成 [(q, a_html), ...]"""
    out = []
    for m in re.finditer(
            r'<p style="margin-bottom:8px"><strong>(.*?)</strong>\s*(.*?)</p>', s, re.S):
        out.append((m.group(1).strip(), m.group(2).strip()))
    return out


def plain(t):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', H.unescape(t))).strip()


def faq_visible(qa):
    lines = ['  <!-- dtb:faq-visible -->',
             '  <section class="faq-visible" style="margin-top:24px;line-height:1.7;color:var(--muted)">',
             '    <h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">❓ Frequently Asked Questions</h2>']
    for q, a in qa:
        lines.append(f'    <p style="margin-bottom:8px"><strong>{q}</strong> {a}</p>')
    lines.append('  </section>')
    return '\n'.join(lines)


def faq_schema(qa):
    d = {'@context': 'https://schema.org', '@type': 'FAQPage',
         'mainEntity': [{'@type': 'Question', 'name': plain(q),
                         'acceptedAnswer': {'@type': 'Answer', 'text': plain(a)}} for q, a in qa]}
    return json.dumps(d, ensure_ascii=False, indent=2)


def main(apply):
    s = PAGE.read_text(encoding='utf-8')
    if MARK in s:
        print('already expanded — 0 changes')
        return 0

    # ① 可见问答 → (q, a) 并加新的一问
    qa = parse_visible_faq(s)
    if len(qa) < 5:
        print(f'✗ 只解析到 {len(qa)} 条可见问答，未改动')
        return 1
    print(f'① 可见问答解析到 {len(qa)} 条 → 加 1 条长尾后 {len(qa) + 1} 条')
    qa.append(NEW_QA)

    # ② 可见 FAQ 区块整体重写（该页 marker 在 section 内部、h2 之后）
    pat = re.compile(
        r'  <section style="margin-top:24px;line-height:1\.7;color:var\(--muted\);font-size:\.88rem">\n'
        r'    <h2 style="color:var\(--text\);font-size:1\.1rem;margin-bottom:12px">❓ Frequently Asked Questions</h2>\n'
        r'.*?\n  </section>', re.S)
    m = pat.search(s)
    if not m:
        print('✗ 找不到 FAQ 区块')
        return 1
    # ③ 正文块 + 重写后的 FAQ 一起替换原区块
    s = s[:m.start()] + BODY.format(mark=MARK) + faq_visible(qa) + s[m.end():]

    # ④ FAQPage schema 同源重写（同一份 qa 数据 → 不可能漂移）
    blocks = list(re.finditer(r'<script type="application/ld\+json">\n\{\n  "@context"[\s\S]*?</script>', s))
    target = [b for b in blocks if '"FAQPage"' in b.group(0)]
    if len(target) != 1:
        print(f'✗ FAQPage 区块数量异常：{len(target)}')
        return 1
    b = target[0]
    new = f'<script type="application/ld+json">\n{faq_schema(qa)}\n</script>'
    print(f'② schema：FAQPage {len(b.group(0))} 字符 → {len(new)} 字符（{len(qa)} 问，与可见文本同源）')
    s = s[:b.start()] + new + s[b.end():]

    # ⑤ WebApplication 的 dateModified 跟着内容走
    s = s.replace('"dateModified": "2026-10-03"', f'"dateModified": "{TODAY}"')

    if apply:
        PAGE.write_text(s, encoding='utf-8')
        print('已写入 public/base64-decode.html')
    else:
        print('(dry-run，未写入)')
    return 0


if __name__ == '__main__':
    sys.exit(main('--apply' in sys.argv))
