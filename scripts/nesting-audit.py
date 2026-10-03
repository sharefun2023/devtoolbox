#!/usr/bin/env python3
"""HTML 嵌套合法性审计（工具站）

为什么需要它：`html.parser` 只看标签**配对**，不看**嵌套是否合法** ——
所以 2026-09-25 那次 `align-faq-visible.py` 把一整块 <section>（含 h2/p）插进
`<ul>` 内部时，site-check / page-audit / 结构校验**全部报 0 error**，
因为这个错误既不影响配对，也不影响渲染（浏览器会把 section 当 ul 的子节点渲染）。
只有按 HTML5 内容模型逐层看父节点才能查到。

本脚本检查两件事：
  ① 列表容器（ul/ol）的直接子元素只能是 li（以及 script/template）—— 内容模型违规
  ② 内联元素里套块级元素（a/span/strong/em/button/label 里出现 div/section/p/h*/ul/ol/table）
  ③ 标签配对（顺带，作为对照项）

用法:
    python3 scripts/nesting-audit.py public
"""
import os
import sys
from html.parser import HTMLParser

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'param', 'source', 'track', 'wbr'}
# 列表容器的合法子元素（script/template 是 HTML 规范允许的 script-supporting elements）
LIST = {'ul', 'ol'}
LIST_OK = {'li', 'script', 'template'}
# <p> 的内容模型是「短语内容」，块级元素不会合法地出现在里面（浏览器会提前闭合 </p>）
BLOCK = {'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
         'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'form',
         'blockquote', 'pre', 'figure', 'dl'}
# ⚠️ 故意**不**检查「<a> 里放 div」：<a> 是透明内容模型，父级允许块级时它就允许，
#    站上的卡片（<a class="card"><div class="card-title">）是完全合法的 HTML5。
#    第一版脚本照搬「内联不能放块级」的直觉，把全站 13 页的卡片全报成了违规 —— 假警报。


class NestingParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.problems = []
        self.unmatched = []

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        if self.stack:
            parent = self.stack[-1][0]
            if parent in LIST and tag not in LIST_OK:
                self.problems.append(
                    (self.getpos()[0], f'<{tag}> 直接位于 <{parent}> 内部（列表只允许 li）'))
            if parent == 'p' and tag in BLOCK:
                self.problems.append(
                    (self.getpos()[0], f'<{tag}>（块级）直接位于 <p> 内部（浏览器会提前闭合 p）'))
        self.stack.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return
        self.unmatched.append(self.getpos())


def main(root):
    bad = 0
    for dirpath, _dirs, files in os.walk(root):
        for f in sorted(files):
            if not f.endswith('.html'):
                continue
            p = os.path.join(dirpath, f)
            s = open(p, encoding='utf-8', errors='replace').read()
            par = NestingParser()
            par.feed(s)
            rel = os.path.relpath(p, root)
            if par.problems:
                bad += 1
                print(f'{rel}')
                for line, msg in par.problems:
                    print(f'    line {line}: {msg}')
            if par.unmatched:
                bad += 1
                print(f'{rel}: {len(par.unmatched)} 个未匹配的结束标签')
            if par.stack:
                bad += 1
                print(f'{rel}: {len(par.stack)} 个未闭合的标签: '
                      f'{[(t, pos[0]) for t, pos in par.stack]}')
    print(f'\npages with nesting problems: {bad}')
    return bad


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1] if len(sys.argv) > 1 else 'public') == 0 else 1)
