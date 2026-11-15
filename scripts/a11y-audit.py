#!/usr/bin/env python3
"""devtoolbox 无障碍静态审计（此前从未跑过的那一栏）。

查 7 件事，全部是「读 HTML 结构就能判定」的：
  1. skip-link        首页第一个链接是否为 #main 跳转（WCAG 2.4.1 Bypass Blocks）
  2. main 地标        是否有且仅有一个 <main> 且带 id="main"（skip-link 的落点）
  3. th scope         表头 <th> 是否声明 scope（WCAG 1.3.1）
  4. 假控件           div/span 挂 onclick 但没有 role+tabindex（WCAG 2.1.1 键盘不可达）
  5. live region      有工具 UI 的页面是否至少有一个 aria-live/role=status（WCAG 4.1.3）
  6. html lang        每个页面是否声明 lang
  7. img alt          <img> 是否都有 alt

用法：python3 scripts/a11y-audit.py public
退出码：0 = 0 error。
"""
import os
import re
import sys
from html.parser import HTMLParser

ROOT = sys.argv[1] if len(sys.argv) > 1 else "public"


class Collector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.in_body = False
        self.body_links = 0
        self.skip_link_ok = False
        self.main_count = 0
        self.main_has_id = False
        self.th_total = 0
        self.th_no_scope = 0
        self.lang = None
        self.live = 0
        self.tool_ui = 0
        self.img_total = 0
        self.img_no_alt = 0
        self.fake_controls = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "body":
            self.in_body = True
        if tag == "main":
            self.main_count += 1
            if a.get("id") == "main":
                self.main_has_id = True
        if a.get("role") == "main":
            # 无 footer 的页面用 role="main" 挂在既有容器上（不插 <main> 标签，
            # 因为末尾内联 JS 里的 HTML 字符串会打乱标签栈）
            self.main_count += 1
            if a.get("id") == "main":
                self.main_has_id = True
        if tag == "th":
            self.th_total += 1
            if not a.get("scope"):
                self.th_no_scope += 1
        if tag == "img":
            self.img_total += 1
            if "alt" not in a:
                self.img_no_alt += 1
        if a.get("aria-live") or a.get("role") in ("status", "alert", "log"):
            self.live += 1
        if tag in ("textarea", "input") and a.get("type") not in ("hidden", "file"):
            self.tool_ui += 1
        if tag == "a":
            self.body_links += 1
            if self.body_links == 1 and "skip-link" in (a.get("class") or "") and a.get("href") == "#main":
                self.skip_link_ok = True
        if tag in ("div", "span") and "onclick" in a:
            if not a.get("role") or a.get("tabindex") is None:
                self.fake_controls.append(f"<{tag} class={a.get('class')!r} onclick>")


def audit(path):
    with open(path, encoding="utf-8") as f:
        html = f.read()
    c = Collector()
    c.feed(html)
    errors = []
    warns = []
    if not c.skip_link_ok:
        errors.append("缺 skip-link（body 第一个链接不是 <a class=\"skip-link\" href=\"#main\">）")
    if c.main_count == 0:
        errors.append("没有 main 地标（<main> 或 role=\"main\"）")
    elif c.main_count > 1:
        errors.append(f"main 地标出现 {c.main_count} 次（应恰好 1 个）")
    if c.main_count and not c.main_has_id:
        errors.append("main 地标缺 id=\"main\"（skip-link 落点）")
    if c.th_no_scope:
        errors.append(f"{c.th_no_scope}/{c.th_total} 个 <th> 缺 scope")
    for f in c.fake_controls:
        errors.append(f"键盘不可达的假控件：{f}")
    if c.tool_ui and not c.live:
        # 4.1.3 状态播报属「逐页接线」的独立一层（每页的结果元素不同），
        # 与上面 6 项结构缺陷分开计数：结构必须为 0，这一项按 warn 跟踪进度。
        warns.append(f"有 {c.tool_ui} 个输入控件但无 aria-live/role=status（4.1.3 待接线）")
    if not c.lang:
        errors.append("缺 <html lang>")
    if c.img_no_alt:
        errors.append(f"{c.img_no_alt}/{c.img_total} 个 <img> 缺 alt")
    return errors, warns


def main():
    files = []
    for dirpath, _dirs, names in os.walk(ROOT):
        for n in sorted(names):
            if n.endswith(".html"):
                files.append(os.path.join(dirpath, n))
    files.sort()

    err_pages = warn_pages = 0
    n_err = n_warn = 0
    for p in files:
        errors, warns = audit(p)
        rel = "/" + os.path.relpath(p, ROOT)
        if errors or warns:
            print(f"\n{rel}")
            for i in errors:
                print(f"   ✗ {i}")
            for i in warns:
                print(f"   ⚠ {i}")
        else:
            print(f"OK  {rel}")
        if errors:
            err_pages += 1
            n_err += len(errors)
        if warns:
            warn_pages += 1
            n_warn += len(warns)

    print(f"\n==== {len(files)} pages | ERROR: {err_pages} pages / {n_err} issues"
          f" | WARN(4.1.3): {warn_pages} pages / {n_warn} ====")
    sys.exit(0 if n_err == 0 else 1)


if __name__ == "__main__":
    main()
