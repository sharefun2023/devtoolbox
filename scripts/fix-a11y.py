#!/usr/bin/env python3
"""devtoolbox 无障碍结构修复（幂等，dry-run 默认）。

修 4 件事，全部是「结构层面、不碰任何工具逻辑」的：
  1. 每页补 skip-link（WCAG 2.4.1 Bypass Blocks）—— 页首第一个可聚焦元素，指向 #main
  2. 每页保证有且仅有一个 <main id="main"> 地标（skip-link 的落点，也是读屏用户的「正文」边界）
  3. 69 个 <th> 补 scope="col"（WCAG 1.3.1；全站 th 只在表头行，无行表头）
  4. div/span 上的 onclick 控件补 role="button" tabindex="0"（WCAG 2.1.1），
     键盘激活由新增的 /js/a11y.js 统一委托处理（Enter/Space → click）

用法：
  python3 scripts/fix-a11y.py public --dry-run   # 只看会改什么
  python3 scripts/fix-a11y.py public --apply     # 真改
判据：第二次 --apply 必须打印 0 file(s) rewritten。
"""
import os
import re
import sys

ROOT = "public"
APPLY = "--apply" in sys.argv
for a in sys.argv[1:]:
    if not a.startswith("--"):
        ROOT = a

SKIP_CSS = """
/* a11y: 跳转链接（WCAG 2.4.1）—— 键盘用户按 Tab 第一下即可跳过导航 */
.skip-link{position:absolute;left:-9999px;top:0;z-index:9999;background:#0a0e14;color:#39bae6;
  border:1px solid #39bae6;border-radius:6px;padding:10px 16px;font-size:14px;text-decoration:none}
.skip-link:focus{left:8px;top:8px;outline:2px solid #39bae6;outline-offset:2px}
/* a11y: 假控件获得焦点时的可见环 */
[role="button"][tabindex]:focus-visible{outline:2px solid #39bae6;outline-offset:2px}
"""

A11Y_JS = """// a11y.js — 让 div/span 上的 onclick 控件可被键盘激活（WCAG 2.1.1）。
// 只做一件事：把 [role="button"][tabindex] 上的 Enter / Space 转发成 click。
// 不复制、不替换任何页面自己的逻辑 —— 事件委托，任何时刻新增的控件都自动生效。
(function () {
  if (window.__dtA11yInstalled) return;
  window.__dtA11yInstalled = true;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('role') !== 'button' || el.getAttribute('tabindex') === null) return;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return;
    e.preventDefault();          // 阻止 Space 滚动页面
    el.click();                  // 走页面原本的 onclick，行为完全一致
  });
})();
"""


def skip_label(html):
    return "跳到主要内容" if 'lang="zh' in html else "Skip to content"


def fix_skip_link(html):
    if 'class="skip-link"' in html:
        return html, False
    m = re.search(r"<body[^>]*>\s*\n", html)
    if not m:
        return html, False
    tag = f'<a class="skip-link" href="#main">{skip_label(html)}</a>\n'
    return html[: m.end()] + tag + html[m.end():], True


def fix_main(html):
    """保证页面有一个 id="main" 的 main 地标。

    两条路径，选哪条取决于「能不能安全地插入闭标签」：
      · 页面有 <footer>  → 插 <main id="main">…</main>（footer 是顶层元素，闭合点确定）
      · 页面无 <footer>  → 不插标签，只给已有的顶层容器 div 加 id="main" role="main"
        ⚠️ 无 footer 的页面末尾常有内联 JS（里面含 HTML 字符串），
           `</main>` 会被解析器的栈打乱 → nesting-audit 报「未匹配的结束标签」。
           加属性不改变任何嵌套关系，零风险。
    """
    changed = False
    if re.search(r"<main\b", html):
        if not re.search(r"<main\b[^>]*\bid=\"main\"", html):
            html = re.sub(r"<main\b", '<main id="main"', html, count=1)
            changed = True
        return html, changed

    if "<footer" not in html:
        m = re.search(r'<div class="(?:tool-)?container"[^>]*>', html)
        if not m:
            return html, changed
        tag = m.group(0)
        if re.search(r"\bid=", tag) or "role=\"main\"" in tag:
            return html, changed
        new = tag[:-1] + ' id="main" role="main">'
        return html.replace(tag, new, 1), True

    anchor = None
    m = re.search(r"</nav>\s*\n", html)
    if m:
        anchor = m.end()
    else:
        m = re.search(r'<a class="skip-link"[^>]*>[^<]*</a>\s*\n', html)
        if m:
            anchor = m.end()
        else:
            m = re.search(r"<body[^>]*>\s*\n", html)
            if not m:
                return html, changed
            anchor = m.end()
    html = html[:anchor] + '<main id="main">\n' + html[anchor:]
    fidx = html.find("<footer")
    if fidx == -1:
        return html, changed
    html = html[:fidx] + "</main>\n\n" + html[fidx:]
    return html, True


def fix_th_scope(html):
    new, n = re.subn(r"<th(?![^>]*\bscope=)(?=[\s>])", '<th scope="col"', html)
    return new, n > 0


def fix_fake_controls(html):
    changed = False

    def add(tag):
        nonlocal changed
        return tag

    def repl(m):
        nonlocal changed
        tag = m.group(0)
        # 已经有 role 或 tabindex 的不动（避免覆盖页面作者写的语义）
        if re.search(r'\brole="', tag) or re.search(r"\btabindex=", tag):
            return tag
        changed = True
        out = re.sub(r"^<(div|span)\b", r'<\1 role="button" tabindex="0"', tag)
        return out

    # 只处理「静态 HTML 里的」onclick 元素；JS 模板串里的是另一处（见 PATCHES）
    new = re.sub(r"<(?:div|span)\b[^>]*\bonclick=[^>]*>", repl, html)
    return new, changed


# JS 模板串里生成的控件（调色板色块 / 随机色块）—— 字符串字面替换，命中数必须为 1
PATCHES = [
    ('tools/color-tools.html',
     """class="palette-color" style="background:${c}" onclick="setFromPalette('${c}')" title="${c}\"""",
     """class="palette-color" role="button" tabindex="0" aria-label="Use color ${c}" style="background:${c}" onclick="setFromPalette('${c}')" title="${c}\""""),
    ('tools/color-tools.html',
     """class="random-cell" style="background:${c}" onclick="setFromPalette('${c}')" title="${c}\"""",
     """class="random-cell" role="button" tabindex="0" aria-label="Use color ${c}" style="background:${c}" onclick="setFromPalette('${c}')" title="${c}\""""),
]


def ensure_page_css(html):
    """没有外部样式表的页面（全站 8 页用内联 <style>）必须把 skip-link 规则写进页内。

    ⚠️ 这是真机上量出来的缺口：只把规则追加到 style.css / tool.css 时，
    这些页面根本没有加载那两个文件 → skip-link 变成页面顶部的可见文字（视觉回归）。
    """
    if 'rel="stylesheet"' in html:
        return html, False
    if ".skip-link" in html:
        return html, False
    idx = html.rfind("</style>")
    if idx == -1:
        return html, False
    return html[:idx] + SKIP_CSS + html[idx:], True


def ensure_css():
    for css in ("public/css/style.css", "public/css/tool.css"):
        path = os.path.join(ROOT, css.split("public/", 1)[1])
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            src = f.read()
        if ".skip-link" in src:
            continue
        if APPLY:
            with open(path, "w", encoding="utf-8") as f:
                f.write(src.rstrip("\n") + "\n" + SKIP_CSS)
        print(f"css  {path}: +skip-link 规则")


def ensure_js():
    path = os.path.join(ROOT, "js", "a11y.js")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if "__dtA11yInstalled" in f.read():
                return False
    if APPLY:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(A11Y_JS)
    print(f"js   {path}: 写入键盘激活委托")
    return True


def ensure_js_include(html):
    if "/js/a11y.js" in html:
        return html, False
    # 放在 </body> 前：它只挂一个 document 级监听，不依赖 DOM 就绪
    idx = html.rfind("</body>")
    if idx == -1:
        return html, False
    return html[:idx] + '<script src="/js/a11y.js" defer></script>\n' + html[idx:], True


def main():
    files = []
    for dirpath, _d, names in os.walk(ROOT):
        for n in sorted(names):
            if n.endswith(".html"):
                files.append(os.path.join(dirpath, n))
    files.sort()

    rewritten = 0
    stats = {"skip": 0, "main": 0, "th": 0, "ctrl": 0, "js": 0, "css": 0}
    for p in files:
        with open(p, encoding="utf-8") as f:
            src = f.read()
        html = src
        html, c1 = fix_skip_link(html)
        html, c2 = fix_main(html)
        html, c3 = fix_th_scope(html)
        html, c4 = fix_fake_controls(html)
        html, c5 = ensure_js_include(html)
        html, c6 = ensure_page_css(html)
        stats["skip"] += c1
        stats["main"] += c2
        stats["th"] += c3
        stats["ctrl"] += c4
        stats["js"] += c5
        stats["css"] += c6
        if html != src:
            rewritten += 1
            if APPLY:
                with open(p, "w", encoding="utf-8") as f:
                    f.write(html)

    for rel, old, new in PATCHES:
        path = os.path.join(ROOT, rel)
        with open(path, encoding="utf-8") as f:
            src = f.read()
        hits = src.count(old)
        if hits == 0 and new in src:
            continue  # 已打过
        if hits != 1:
            print(f"ABORT {rel}: 锚点命中 {hits} 次（应为 1）—— 人工核对")
            sys.exit(2)
        if APPLY:
            with open(path, "w", encoding="utf-8") as f:
                f.write(src.replace(old, new))
        print(f"js-template {rel}: +role/tabindex/aria-label")

    ensure_css()
    ensure_js()

    if APPLY and rewritten:
        print(f"{rewritten} file(s) rewritten | skip-link +{stats['skip']} main +{stats['main']} "
              f"th +{stats['th']} controls +{stats['ctrl']} a11y-js +{stats['js']} inline-css +{stats['css']}")
    elif APPLY:
        print("0 file(s) rewritten (already up to date)")
    else:
        print(f"[dry-run] would rewrite {rewritten} file(s) | skip-link +{stats['skip']} "
              f"main +{stats['main']} th +{stats['th']} controls +{stats['ctrl']} a11y-js +{stats['js']}")


if __name__ == "__main__":
    main()
