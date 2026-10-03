#!/usr/bin/env python3
"""清理重复的 JSON-LD 区块（工具站）

起因：审计结构化数据时发现 /tools/text-diff 的 <head> 里有 **5 个** JSON-LD 区块，
其中 WebApplication ×2、FAQPage ×2 —— 两份是不同时期分别加进去的，于是同一页对同一个
实体声明了两遍（`name` 还不一样：「Diff Checker & Text Diff」vs「Text Diff」）。
重复的结构化数据不会直接导致惩罚，但会让搜索引擎在合并信号时自己挑一个，
而「挑哪个」不由你决定 —— 清理掉是唯一可控的做法。

规则（--apply 时）：
  ① 同一页出现多个 @type 相同的区块 → 保留**第一个**，其余删除
  ② FAQPage 若被删：把它的 mainEntity **并入第一块**（按 name 去重、保序），
     而不是直接丢弃 —— 否则会丢掉页面上真实可见的问答
  ③ 只处理 WebApplication / SoftwareApplication / FAQPage / WebPage / BreadcrumbList

用法:
    python3 scripts/dedupe-jsonld.py public            # 只报告
    python3 scripts/dedupe-jsonld.py public --apply
"""
import json
import os
import re
import sys

BLOCK_RE = re.compile(r'[ \t]*<script type="application/ld\+json">([\s\S]*?)</script>\n?')
MERGEABLE = {'WebApplication', 'SoftwareApplication', 'FAQPage', 'WebPage', 'BreadcrumbList'}


def blocks_of(s):
    """→ [(match, parsed_or_None)]"""
    out = []
    for m in BLOCK_RE.finditer(s):
        try:
            out.append((m, json.loads(m.group(1))))
        except Exception:
            out.append((m, None))
    return out


def scan(s):
    """→ (first_by_type, duplicates)"""
    first, dups = {}, []
    for m, d in blocks_of(s):
        if not isinstance(d, dict):
            continue
        t = d.get('@type')
        if t not in MERGEABLE:
            continue
        if t in first:
            dups.append((m, d))
        else:
            first[t] = (m, d)
    return first, dups


def process(path, apply):
    s = open(path, encoding='utf-8').read()
    first, dups = scan(s)
    if not dups:
        return 0

    rel = os.path.relpath(path)
    types = ', '.join(sorted({d.get('@type') for _, d in dups}))
    print(f'{rel}: {len(dups)} 个重复区块（{types}）')

    extras = []
    for _, d in dups:
        if d.get('@type') == 'FAQPage':
            extras.extend(d.get('mainEntity', []))
    if extras:
        print(f'    FAQPage 重复：{len(extras)} 条问答将并入第一块（按 name 去重）')
    if not apply:
        return len(dups)

    # ① 先删（从后往前，偏移不失效）
    for m, _d in sorted(dups, key=lambda x: x[0].start(), reverse=True):
        s = s[:m.start()] + s[m.end():]

    # ② 再把被删 FAQPage 的问答并进第一块
    if extras:
        first2, _ = scan(s)
        m, d = first2['FAQPage']
        names = {q.get('name') for q in d.get('mainEntity', [])}
        added = 0
        for q in extras:
            if q.get('name') not in names:
                d['mainEntity'].append(q)
                names.add(q.get('name'))
                added += 1
        new_json = json.dumps(d, ensure_ascii=False, indent=2)
        s = s[:m.start(1)] + '\n' + new_json + '\n' + s[m.end(1):]
        print(f'    合并 {added} 条新问答（合并后 {len(d["mainEntity"])} 条）')

    open(path, 'w', encoding='utf-8').write(s)
    print(f'    → 剩余 {len(blocks_of(s))} 个 JSON-LD 区块')
    return len(dups)


def main(root, apply):
    n = 0
    for dirpath, _dirs, files in os.walk(root):
        for f in sorted(files):
            if f.endswith('.html'):
                n += process(os.path.join(dirpath, f), apply)
    print(f'total duplicate blocks: {n}')
    return 0


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    sys.exit(main(args[0] if args else 'public', '--apply' in sys.argv))
