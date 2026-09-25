#!/usr/bin/env python3
"""让 FAQPage 结构化数据的问句在页面上**真的可见**（Google 政策：结构化数据必须对应可见内容）。

背景（2026-09-25 审计）：13 个页面的 FAQPage schema 共 39 条问句在页面上一条都找不到，
其中 7 个页面连 FAQ 区块都没有。这不只是「白写」——不可见的 FAQ 标记属违规，
富媒体结果会被忽略，严重时按结构化数据垃圾处理。

做法（三条，全部幂等）：
  1. RENAMES        —— 页面上已有一条**同义不同措辞**的问句时，把可见问句改成 schema 的措辞
                      （保留 schema 里带品牌/长尾词的问法，不丢关键词）。
  2. SCHEMA_FIXES   —— schema 文本本身写错时修 schema（双重转义、表述与事实不符/含糊）。
  3. ADD            —— 页面上完全没有对应问答的，按 schema 的问+答补成可见 Q&A。

用法:
    python3 scripts/align-faq-visible.py            # 试跑
    python3 scripts/align-faq-visible.py --apply
"""
import json
import re
import sys

# ── 1. 可见问句 → schema 措辞（保留 schema 的带词问法） ───────────────────────
RENAMES = {
    'public/online-regex-tester.html': [
        ('Is this regex tester really free?', 'Is this regex tester free to use?'),
        ('Does my test data get sent anywhere?', 'Is my test data safe and private?'),
        ('What regex engine does this use?', 'What regex flavor does this tester use?'),
    ],
    'public/tools/minifier.html': [
        ('Can I minify HTML and CSS/JS with the same tool?',
         'Can I minify CSS and JavaScript with this tool too?'),
    ],
    'public/tools/sql-formatter-online.html': [
        ('Does it require an internet connection?',
         'Does SQL Formatter Online require an internet connection?'),
        ('Is it safe to paste a production SQL query?',
         'Is it safe to paste a production SQL query into an online formatter?'),
    ],
    'public/tools/url-encoder-decoder.html': [
        ('What about double encoding?', 'What is double encoding?'),
    ],
    'public/tools/markdown-preview.html': [
        ('Is Markdown Preview really free?', 'Is Markdown Preview free to use?'),
    ],
}

# ── 2. schema 自身写错的地方 ──────────────────────────────────────────────────
# (a) `&amp;notin;` 是双重转义：JSON-LD 里的字面文本会原样显示成 "&amp;notin;"，应为 "&notin;"。
# (b) 页面可见问句写的是 "HTML or PDF"（且答案解释了 Print → Save as PDF，属实），
#     schema 的 "or other formats" 更含糊 —— 以可见的、准确的那版为准。
SCHEMA_FIXES = {
    'public/tools/html-entity-encoder-decoder.html': [
        ('Why did &amp;notin; turn into ¬in?', 'Why did &notin; turn into ¬in?'),
    ],
    'public/tools/markdown-preview.html': [
        ('Can I export my Markdown to HTML or other formats?',
         'Can I export my Markdown to HTML or PDF?'),
    ],
}

# ── 3. 答案本身写错的（模板残留「Most tools run 100% client-side」）────────────
# 已逐个 grep 确认这 4 个页面**没有任何** fetch/XHR/sendBeacon/WebSocket/import()，
# 即「客户端运行、不联网」是真的，但 "Most tools run" 是模板残句，说不清是哪个工具。
ANSWER_FIXES = {
    'Does Text Diff require an internet connection?': (
        'No. Text Diff runs entirely client-side in your browser — there is no server '
        'component and the text you paste is never sent anywhere. Once the page has '
        'loaded you can keep comparing with your network disconnected.'),
    'Does CIDR/IPv6 Subnet Calculator require an internet connection?': (
        'No. All subnet maths runs client-side in your browser — no data is sent to any '
        'server. Once the page has loaded it keeps working offline.'),
    'Does Color Tools require an internet connection?': (
        'No. Colour conversion, palette generation and random colours all run '
        'client-side in your browser — nothing is sent to a server, and the page keeps '
        'working offline once loaded.'),
}

# ── 4. 补可见 Q&A 的落点 ─────────────────────────────────────────────────────
# 'anchor' 必须是页面里唯一的字符串；position=after/before 决定插在它的哪一侧。
# section=True → 连带生成 <h2>❓ Frequently Asked Questions</h2> 包裹（页面原本没有 FAQ）。
# qa='h3' / 'h4' / 'p' → 可见问答的标记风格，跟随该页既有风格。
ADD = {
    'public/base64-decode.html': dict(
        anchor='<h2 style="color:var(--text);font-size:1.1rem;margin-bottom:12px">'
               '❓ Frequently Asked Questions</h2>',
        position='after', section=False, qa='p'),
    'public/base64-encode.html': dict(
        anchor='<li style="margin-bottom:6px"><strong>Kubernetes secrets</strong> '
               '— encode configuration values for k8s manifests</li>',
        position='after', section=True, qa='p'),
    'public/online-regex-tester.html': dict(
        anchor='<h2>❓ Frequently Asked Questions</h2>',
        position='after', section=False, qa='h3'),
    'public/tools/minifier.html': dict(
        anchor='<h3>Frequently Asked Questions</h3>',
        position='after', section=False, qa='h4'),
    'public/tools/text-diff.html': dict(
        anchor='<h2>Related Free Tools</h2>', position='before', section=True, qa='h3'),
    'public/tools/uuid-generator.html': dict(
        anchor='<h2>🔗 Related Tools</h2>', position='before', section=True, qa='h3'),
    'public/tools/qrcode-tools.html': dict(
        anchor='<section class="related-tools">', position='before', section=True, qa='h3'),
    'public/tools/cidr-calculator.html': dict(
        anchor='</main>', position='before', section=True, qa='h3'),
    'public/tools/color-tools.html': dict(
        anchor='  <!-- Back link -->', position='before', section=True, qa='h3'),
}

MARKER = '<!-- dtb:faq-visible -->'
FAQ_HEADING = '❓ Frequently Asked Questions'


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def norm(t):
    t = t.lower()
    t = re.sub(r'[^a-z0-9]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def visible_text(s):
    b = re.sub(r'<script\b.*?</script>', ' ', s, flags=re.S | re.I)
    b = re.sub(r'<style\b.*?</style>', ' ', b, flags=re.S | re.I)
    b = re.sub(r'<head\b.*?</head>', ' ', b, flags=re.S | re.I)
    b = re.sub(r'<[^>]+>', ' ', b)
    import html as H
    return H.unescape(b)


def faq_pairs(s):
    """返回 [(question, answer)]，来自页面所有 FAQPage 块（已应用 fixes 之后读取）。"""
    out = []
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try:
            d = json.loads(b)
        except Exception:
            continue
        if isinstance(d, dict) and d.get('@type') == 'FAQPage':
            for it in d.get('mainEntity', []):
                out.append((it.get('name', ''),
                            it.get('acceptedAnswer', {}).get('text', '')))
    return out


def render_qa(qa, pairs):
    if qa == 'p':
        return '\n'.join(
            '    <p style="margin-bottom:8px"><strong>%s</strong> %s</p>'
            % (esc(q), esc(a)) for q, a in pairs)
    tag = qa
    return '\n'.join('    <%s>%s</%s>\n    <p>%s</p>' % (tag, esc(q), tag, esc(a))
                     for q, a in pairs)


def write(path, s, apply):
    if apply:
        open(path, 'w', encoding='utf-8').write(s)


def rename_in_heading(s, old, new):
    """只把**标题标签里**的旧问句改成新问句。

    ⚠️ 不能用 `if new in s` 判断是否已改过 —— schema 的 JSON 里本来就有这句问句，
    那样会把每一页都判成「已改」，rename 静默不执行（2026-09-25 首版就踩了这个坑，
    结果 ADD 步骤在旧问句旁边又插了一份同义问答）。
    """
    pat = re.compile(r'<h([1-6])([^>]*)>\s*' + re.escape(esc(old)) + r'\s*</h\1>')
    if not pat.search(s):
        return s, False
    s2 = pat.sub(lambda m: '<h%s%s>%s</h%s>' % (m.group(1), m.group(2), esc(new),
                                                m.group(1)), s, count=1)
    return s2, s2 != s


def main(apply):
    changes = 0
    for path, renames in RENAMES.items():
        s = open(path, encoding='utf-8').read()
        for old, new in renames:
            s, done = rename_in_heading(s, old, new)
            if done:
                print('RENAME  %-45s %s → %s' % (path, old[:38], new[:38]))
                changes += 1
            else:
                print('!! RENAME 标题里找不到: %s / %s' % (path, old))
        write(path, s, apply)

    for path, fixes in SCHEMA_FIXES.items():
        s = open(path, encoding='utf-8').read()
        for old, new in fixes:
            if json.dumps(new, ensure_ascii=False) in s:
                continue
            po = '"name": ' + json.dumps(old, ensure_ascii=False)
            pn = '"name": ' + json.dumps(new, ensure_ascii=False)
            if po in s:
                s = s.replace(po, pn, 1)
                print('SCHEMA  %-45s %s → %s' % (path, old[:34], new[:34]))
                changes += 1
            else:
                print('!! SCHEMA 目标未找到: %s / %s' % (path, old))
        write(path, s, apply)

    for q, ans in ANSWER_FIXES.items():
        pj = json.dumps(q, ensure_ascii=False)
        for path in list(ADD) + list(RENAMES):
            s = open(path, encoding='utf-8').read()
            if pj not in s:
                continue
            s2 = re.sub(r'("name": ' + re.escape(pj) + r',\s*\n\s*"acceptedAnswer": \{\s*\n'
                        r'\s*"@type": "Answer",\s*\n\s*"text": )"[^"]*"',
                        lambda m: m.group(1) + json.dumps(ans, ensure_ascii=False), s)
            if s2 != s:
                print('ANSWER  %-45s %s' % (path, q[:44]))
                changes += 1
            write(path, s2, apply)

    for path, cfg in ADD.items():
        s = open(path, encoding='utf-8').read()
        vis = norm(visible_text(s))
        missing = [(q, a) for q, a in faq_pairs(s) if norm(q) not in vis]
        if not missing:
            print('OK      %-45s 无需补（全部已可见）' % path)
            continue
        if MARKER in s:
            # 已注入过：只补本轮新增的缺失项（按 marker 区块内容判断）
            print('SKIP    %-45s 已有 marker，缺 %d 条，请人工确认'
                  % (path, len(missing)))
            continue
        body = render_qa(cfg['qa'], missing)
        if cfg['section']:
            block = ('\n  %s\n  <section class="faq-visible" '
                     'style="margin-top:24px;line-height:1.7;color:var(--muted)">\n'
                     '    <h2>%s</h2>\n%s\n  </section>\n' % (MARKER, FAQ_HEADING, body))
        else:
            block = '\n  %s\n%s\n' % (MARKER, body)
        anchor = str(cfg['anchor'])
        if s.count(anchor) != 1:
            print('!! ADD anchor 出现 %d 次（需唯一）: %s' % (s.count(anchor), path))
            continue
        s = s.replace(anchor, anchor + block if cfg['position'] == 'after'
                      else block + anchor, 1)
        print('ADD     %-45s +%d 条可见问答' % (path, len(missing)))
        changes += 1
        write(path, s, apply)

    print('\n%d change(s)%s' % (changes, '' if apply else '  [dry-run]'))
    return changes


if __name__ == '__main__':
    main('--apply' in sys.argv)
