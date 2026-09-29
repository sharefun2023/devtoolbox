#!/usr/bin/env python3
"""Expand /cron/ (Cron Expression Editor) from 85 visible words to a real page.

What it does, all idempotent:
  1. head: title / description / keywords / og:* / twitter:* freed up for the two
     head keywords ("cron expression editor", "crontab generator")
  2. swaps the mangled one-line WebApplication JSON-LD for three well-formed
     blocks (WebApplication + BreadcrumbList + FAQPage)
  3. inserts the .seo-content body block (painted from this page's own CSS
     variables, not the newer tool pages' palette)
  4. inserts a visible FAQ section — **generated from the same FAQ list as the
     FAQPage schema**, so the two can never drift apart

Every factual sentence in the body is the tool's own measured output; the
sentences were produced by scripts/cron-measure.js, not written from memory.

Usage:
  python3 scripts/expand-cron-page.py            # dry run (prints the diff size)
  python3 scripts/expand-cron-page.py --apply
"""
import json
import re
import sys

PAGE = 'public/cron/index.html'
URL = 'https://23232322.xyz/cron/'
TITLE = 'Cron Expression Editor — Crontab Generator &amp; Tester | DevToolBox'
DESC = ('Build a 5-field cron expression or click a preset, read it in plain English and preview '
        'the next 10 runs. Free crontab tester, nothing is uploaded.')
KEYWORDS = ('cron expression editor, crontab generator, cron tester, cron schedule preview, '
            'cron expression online, crontab editor, cron syntax validator')
SCHEMA_NAME = 'Cron Expression Editor — Crontab Generator & Tester'
SCHEMA_DESC = ('Free online cron expression editor: build or parse a 5-field crontab expression, '
               'translate it into plain English and preview the next executions in UTC and your '
               'local time. Runs entirely client-side.')
DATE = '2026-09-29'

# (question, answer) — one source for the visible FAQ *and* the FAQPage schema
FAQ = [
    ('Is this cron expression editor free to use?',
     'Yes. There is no sign-up, no usage limit and nothing to install — the whole editor runs in your browser.'),
    ('Does it require an internet connection?',
     'Only to load the page. Once it is open, parsing, translating and the next-runs preview all run '
     'client-side, so the editor keeps working offline.'),
    ('Does it support seconds or six-field cron expressions?',
     'No. This is the 5-field crontab form, so a 6-field Quartz or Spring expression such as '
     '"0 0 12 * * ?" is reported as an error instead of being half-interpreted. Seconds-level '
     'scheduling needs a different tool.'),
    ('What happens when both the day-of-month and the day-of-week fields are set?',
     'They are ORed, which is what Vixie cron does: "0 0 1 * 1" means midnight on the 1st of the '
     'month or on any Monday. The editor applies that rule and says so in the sentence it prints. '
     'If either of the two fields is *, the other one applies on its own.'),
    ('Can I write MON or JAN instead of numbers?',
     'Yes. Three-letter names are accepted in the month and day-of-week fields and are '
     'case-insensitive, so "0 12 * * MON" and "0 12 * * 1" mean the same thing.'),
    ('Is 7 accepted as Sunday?',
     'Yes. Both 0 and 7 mean Sunday in the day-of-week field, so "0 0 * * 0" and "0 0 * * 7" '
     'produce the same schedule.'),
    ('Which timezone are the next executions shown in?',
     'The left column is UTC and the right column is your browser\'s own timezone. There is no '
     'timezone picker, so if the job runs on a server in another region, read the UTC column.'),
    ('Why does an expression like "0 0 30 2 *" show no upcoming run?',
     'Because February never has 30 days, so that schedule can never fire. The page says there is '
     'no run in the next five years rather than leaving the list blank — that is what an impossible '
     'day/month combination looks like.'),
    ('Can I paste a whole crontab file into it?',
     'No. The editor takes one expression at a time and does not parse crontab files, MAILTO or '
     'PATH lines, or the commands themselves.'),
    ('What day does the week start on?',
     'Sunday. 0 (and 7) is Sunday, 1 is Monday, through 6 for Saturday — matching crontab.'),
]

CSS = """    /* --- SEO content block (uses this page's own palette) --- */
    .seo-content{margin-top:44px;border-top:1px solid var(--border);padding-top:26px;line-height:1.75;font-size:.95rem}
    .seo-content h2{font-size:1.15rem;color:var(--text);margin:28px 0 10px}
    .seo-content h3{font-size:1rem;color:var(--accent);margin:20px 0 8px}
    .seo-content p{margin:8px 0;color:var(--text)}
    .seo-content ul,.seo-content ol{padding-left:22px;margin:8px 0}
    .seo-content li{margin:6px 0}
    .seo-content strong{color:var(--text)}
    .seo-content code{background:var(--bg);border:1px solid var(--border);padding:1px 6px;border-radius:4px;font-family:'JetBrains Mono','Fira Code',monospace;font-size:.9em;color:var(--green)}
    .seo-content table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.9rem}
    .seo-content th,.seo-content td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}
    .seo-content th{background:var(--card);color:var(--muted);font-weight:600}
    .seo-content .related-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
    .seo-content .related-links a{color:var(--accent);text-decoration:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:.9rem}
    .seo-content .related-links a:hover{border-color:var(--accent)}
    .faq-visible{margin-top:34px;border-top:1px solid var(--border);padding-top:22px;line-height:1.75;font-size:.95rem}
    .faq-visible h2{font-size:1.15rem;color:var(--text);margin-bottom:10px}
    .faq-visible h3{font-size:1rem;color:var(--text);margin:18px 0 4px}
    .faq-visible p{color:var(--muted);margin:0}
"""

BODY = """  <!-- dtb:cron-seo-content -->
  <div class="seo-content">
    <h2>Cron Expression Editor: What This Page Does</h2>
    <p>A cron expression is five fields that describe a repeating schedule. This editor works with
    them in three ways, all inside your browser: it builds or parses the expression, translates it
    into a sentence in English and Chinese, and lists the next ten times it will actually run.</p>
    <ul>
      <li><strong>Two-way editing</strong> — type into the expression bar and the five field boxes
      follow; edit any field box and the bar is rebuilt. Whichever side you prefer, you end up with
      the same five fields.</li>
      <li><strong>Plain-language translation</strong> — every valid expression gets a sentence that
      says what it means, including the part most people get wrong: the day-of-month / day-of-week
      rule (see below).</li>
      <li><strong>The next ten executions</strong> — two columns, the same instants as UTC and as
      your browser's local time. Catching a mistake here is much cheaper than catching it in a log
      file at 03:00.</li>
      <li><strong>Fourteen presets</strong> for schedules that come up constantly — every five
      minutes, weekdays at 9 AM, first of the month, yearly on January 1st. One click loads the
      expression and updates everything on the page.</li>
      <li><strong>Validation that names the problem</strong> — <code>60 * * * *</code>,
      <code>*/0 * * * *</code> or a field with a typo produce an error naming the offending field,
      instead of silently showing an empty list.</li>
    </ul>

    <h2>The Five Fields, In Order</h2>
    <table>
      <thead><tr><th>#</th><th>Field</th><th>Allowed values</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>Minute</td><td>0–59</td><td>—</td></tr>
        <tr><td>2</td><td>Hour</td><td>0–23</td><td>24-hour clock, no AM/PM</td></tr>
        <tr><td>3</td><td>Day of month</td><td>1–31</td><td>a 31 here simply never fires in a
        shorter month</td></tr>
        <tr><td>4</td><td>Month</td><td>1–12 or JAN–DEC</td><td>names are case-insensitive</td></tr>
        <tr><td>5</td><td>Day of week</td><td>0–6 or SUN–SAT</td><td>0 = Sunday, and 7 also means
        Sunday</td></tr>
      </tbody>
    </table>
    <p>All five fields are required. This is the POSIX / Vixie crontab form — the one used by
    <code>crontab -e</code> and by the files in <code>/etc/cron.d/</code> on Linux and BSD.</p>

    <h2>Syntax This Editor Understands</h2>
    <table>
      <thead><tr><th>Operator</th><th>Meaning</th><th>Example</th></tr></thead>
      <tbody>
        <tr><td><code>*</code></td><td>every value in the field's range</td>
        <td><code>* * * * *</code> — once a minute</td></tr>
        <tr><td><code>,</code></td><td>a list of values</td>
        <td><code>0 9,17 * * *</code> — at 09:00 and at 17:00</td></tr>
        <tr><td><code>-</code></td><td>an inclusive range</td>
        <td><code>0 9-17 * * *</code> — every hour from 09:00 through 17:00</td></tr>
        <tr><td><code>/</code></td><td>a step, from the start of the range</td>
        <td><code>*/15 * * * *</code> — every 15 minutes</td></tr>
        <tr><td><code>a/n</code></td><td>start at <code>a</code>, then repeat every
        <code>n</code></td>
        <td><code>5/10 * * * *</code> — minutes 5, 15, 25, 35, 45, 55</td></tr>
        <tr><td><code>a-b/n</code></td><td>every <code>n</code> inside a range</td>
        <td><code>1-30/2 * * * *</code> — odd minutes in the first half of the hour</td></tr>
        <tr><td><code>JAN–DEC</code>, <code>SUN–SAT</code></td><td>three-letter names, any
        case</td><td><code>0 12 * * MON</code> — every Monday at noon</td></tr>
      </tbody>
    </table>

    <h3>The day-of-month / day-of-week rule</h3>
    <p>When <em>both</em> day fields are restricted, Vixie cron — and cronie, and the other
    implementations descended from it — treat them as <strong>OR</strong>, not AND.
    <code>0 0 1 * 1</code> therefore means "midnight on the 1st of the month <em>or</em> on any
    Monday", not "midnight on Mondays that happen to be the 1st". This editor applies the OR rule
    and its sentence says so; you can confirm it from the next-executions list, where plain Mondays
    show up alongside the 1st. If one of the two fields is <code>*</code>, the rule does not
    apply — the remaining condition is simply used on its own.</p>
    <p>One caveat worth carrying with you: not every scheduler implements cron the same way. Quartz
    (Java) wants a <code>?</code> in one of the two day fields, and AWS EventBridge has its own
    restrictions and limits. What this page validates is the standard crontab dialect.</p>

    <h2>Worked Examples</h2>
    <p>Every sentence in the right-hand column is this editor's own output — measured, not
    paraphrased.</p>
    <table>
      <thead><tr><th>Expression</th><th>What the page says</th></tr></thead>
      <tbody>
        <tr><td><code>* * * * *</code></td><td>Every minute</td></tr>
        <tr><td><code>*/5 * * * *</code></td><td>Every 5 minutes</td></tr>
        <tr><td><code>5/10 * * * *</code></td><td>Every day, every 10 minutes from :05 to :59 of
        every hour</td></tr>
        <tr><td><code>*/15 9-17 * * 1-5</code></td><td>Every Mon to Fri, every 15 minutes from
        09:00 to 17:45</td></tr>
        <tr><td><code>0 9 * * 1-5</code></td><td>Weekdays at 9:00 AM</td></tr>
        <tr><td><code>0 0 1 * *</code></td><td>First day of every month at midnight</td></tr>
        <tr><td><code>0 0 1 1 *</code></td><td>January 1st at midnight (yearly)</td></tr>
        <tr><td><code>0 0 1 * 1</code></td><td>On day 1 of the month or on Mon, at 00:00</td></tr>
        <tr><td><code>0 0 * * 7</code></td><td>Every Sun, at 00:00</td></tr>
        <tr><td><code>0 0 29 2 *</code></td><td>On day 29 of the month in Feb, at 00:00 — a real
        schedule, but only in leap years: the next run is 2028-02-29</td></tr>
        <tr><td><code>0 0 30 2 *</code></td><td>On day 30 of the month in Feb, at 00:00, plus
        "No run in the next 5 years — check the day / month combination"</td></tr>
      </tbody>
    </table>

    <h2>What It Deliberately Does Not Support</h2>
    <ul>
      <li><strong>Seconds.</strong> This is the 5-field form. A 6-field Quartz or Spring expression
      such as <code>0 0 12 * * ?</code> is reported as an error rather than half-interpreted.</li>
      <li><strong>Quartz-only tokens.</strong> <code>L</code> (last day of the month),
      <code>W</code> (nearest weekday) and <code>#</code> (nth weekday) are not part of the Vixie
      grammar and are rejected.</li>
      <li><strong>Macros.</strong> <code>@daily</code>, <code>@hourly</code> and
      <code>@reboot</code> are rejected too — write <code>0 0 * * *</code> instead of
      <code>@daily</code>.</li>
      <li><strong>Whole crontab files.</strong> One expression at a time. There is no way to paste
      a crontab, an <code>/etc/cron.d/</code> snippet, or a file that mixes
      <code>MAILTO=</code>, <code>PATH=</code> and comments with commands.</li>
      <li><strong>A timezone picker.</strong> The next-runs list is computed in your browser's
      timezone, with a UTC column beside it. If the job runs on a server in another region, read
      the UTC column.</li>
      <li><strong>Frequency maths and DST simulation.</strong> "This fires 720 times a month", or
      what a particular daemon does with 02:30 on a spring-forward day, are left to the
      scheduler's own documentation.</li>
    </ul>

    <h2>How To Use It</h2>
    <ol>
      <li><strong>Start from either end</strong> — type or paste an expression into the bar, or
      click one of the presets.</li>
      <li><strong>Read the sentence.</strong> If it does not describe what you intended, the field
      you got wrong is usually obvious from the wording.</li>
      <li><strong>Check the next ten runs.</strong> The local-time column is the one to compare
      against your own expectation of when the job should have happened.</li>
      <li><strong>Or build it field by field</strong> — set minute, hour, day, month and weekday
      and watch the expression bar update.</li>
      <li><strong>Copy the expression</strong> into your crontab, workflow file or manifest.</li>
    </ol>

    <h2>Where The Expression Goes Next</h2>
    <ul>
      <li><strong>Linux and BSD crontab</strong> — <code>crontab -e</code>, or a file under
      <code>/etc/cron.d/</code>.</li>
      <li><strong>CI/CD schedules</strong> — GitHub Actions and GitLab both take a cron string for
      scheduled pipelines. Hosted schedulers often enforce a minimum interval and run in UTC, so
      check the platform's own documentation before assuming your local time.</li>
      <li><strong>Kubernetes CronJob</strong> — <code>spec.schedule</code> is the same five fields,
      and the cluster's timezone (usually UTC) is what counts.</li>
      <li><strong>Application schedulers</strong> — Celery beat, Sidekiq-Cron, node-cron and
      friends all speak this dialect, which is exactly why the 5-field form is worth knowing by
      heart.</li>
    </ul>

    <h3>Related Tools</h3>
    <div class="related-links">
      <a href="/tools/timestamp-converter">Timestamp Converter</a>
      <a href="/tools/jwt-debugger">JWT Debugger</a>
      <a href="/categories/devops-cicd">DevOps &amp; CI/CD</a>
      <a href="/categories/dev-tools">Dev Tools</a>
      <a href="/">All Tools</a>
    </div>
  </div>
"""


def faq_visible():
    out = ['  <!-- dtb:faq-visible -->',
           '  <section class="faq-visible">',
           '    <h2>❓ Frequently Asked Questions</h2>']
    for q, a in FAQ:
        out.append('    <h3>%s</h3>' % q)
        out.append('    <p>%s</p>' % a)
    out.append('  </section>')
    return '\n'.join(out) + '\n'


def jsonld_blocks(date):
    webapp = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": SCHEMA_NAME,
        "description": SCHEMA_DESC,
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Any",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "url": URL,
        "dateModified": date,
    }
    crumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://23232322.xyz/"},
            {"@type": "ListItem", "position": 2, "name": "Cron Expression Editor", "item": URL},
        ],
    }
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q,
             "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in FAQ
        ],
    }
    out = []
    for obj in (webapp, crumbs, faq):
        out.append('<script type="application/ld+json">\n'
                   + json.dumps(obj, ensure_ascii=False, indent=2) + '\n</script>')
    return '\n'.join(out)


def main():
    apply_ = '--apply' in sys.argv
    src = open(PAGE, encoding='utf-8').read()
    orig = src
    if len(DESC) > 160 or len(DESC) < 138:
        sys.exit('description is %d chars, outside the 138-156 band' % len(DESC))

    # 1) head meta
    src = re.sub(r'<title>.*?</title>', '<title>%s</title>' % TITLE, src, count=1)
    src = re.sub(r'<meta name="description" content=".*?">',
                 '<meta name="description" content="%s">' % DESC, src, count=1)
    if '<meta name="keywords"' not in src:
        src = src.replace('<title>%s</title>' % TITLE,
                          '<title>%s</title>\n<meta name="keywords" content="%s">' % (TITLE, KEYWORDS), 1)
    else:
        src = re.sub(r'<meta name="keywords" content=".*?">',
                     '<meta name="keywords" content="%s">' % KEYWORDS, src, count=1)
    for prop, val in (('og:title', TITLE), ('twitter:title', TITLE),
                      ('og:description', DESC), ('twitter:description', DESC)):
        src = re.sub(r'<meta property="%s" content=".*?">' % prop,
                     '<meta property="%s" content="%s">' % (prop, val), src, count=1)
        src = re.sub(r'<meta name="%s" content=".*?">' % prop,
                     '<meta name="%s" content="%s">' % (prop, val), src, count=1)

    # 2) JSON-LD: replace the whole run of ld+json blocks with three clean ones.
    #    (Replacing only the *first* match is not idempotent: a second run would
    #    leave the previous BreadcrumbList/FAQPage behind and append another pair.)
    blocks = list(re.finditer(r'<script type="application/ld\+json">.*?</script>', src, re.S))
    if not blocks or 'WebApplication' not in blocks[0].group(0):
        sys.exit('could not find the WebApplication JSON-LD block')
    gaps = [src[blocks[i].end():blocks[i + 1].start()] for i in range(len(blocks) - 1)]
    if any(g.strip() for g in gaps):
        sys.exit('unexpected content between the JSON-LD blocks — refusing to splice')
    # the dateModified in the page is owned by sitemap-lastmod-honest.py (it derives
    # the date from git history); preserve whatever is there instead of resetting it
    dm = re.search(r'"dateModified": "(\d{4}-\d{2}-\d{2})"', src)
    src = src[:blocks[0].start()] + jsonld_blocks(dm.group(1) if dm else DATE) + src[blocks[-1].end():]

    # 3) CSS
    if '.seo-content{margin-top' not in src:
        src = src.replace('</style>', CSS + '</style>', 1)

    # 4) body + FAQ
    if '<!-- dtb:cron-seo-content -->' not in src:
        anchor = '<div class="copied" id="copied">'
        i = src.index(anchor)
        # insert before the </div> that closes .container
        close = src.rindex('</div>', 0, i)
        src = src[:close] + BODY + faq_visible() + src[close:]

    if src == orig:
        print('already up to date (0 changes)')
        return
    print('changed: %d -> %d chars' % (len(orig), len(src)))
    if not apply_:
        print('dry run — pass --apply to write')
        return
    open(PAGE, 'w', encoding='utf-8').write(src)
    print('written %s' % PAGE)


if __name__ == '__main__':
    main()
