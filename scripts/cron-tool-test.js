#!/usr/bin/env node
/* Cron Expression Editor 测试 —— 对 public/cron/index.html 里**真实的内联脚本**跑断言。
 *
 * 为什么需要：这页正文里要写「支持哪些语法、DOM/DOW 同时限定时是 AND 还是 OR、
 * 远期表达式能不能算出来、非法值会不会报错」这类**可验证的事实**。事实必须来自
 * 跑起来的代码，不能来自读代码的猜。
 *
 * 用法:
 *   node scripts/cron-tool-test.js
 *   node scripts/cron-tool-test.js --old   # 反向测试：装回修复前的行为，相关断言必须失败
 *
 * --old 会装回 5 个修复前的行为（OR→AND、逐分钟搜索+10 万次上限、无校验、
 * 不支持 JAN/MON 这类名字、不支持 1-30/2 这种「区间+步长」、不支持 7=周日），
 * 所以对应的断言应当成片失败 —— 那是「测试确实绑在这些修复上」的证明。
 */
const fs = require('fs');
const path = require('path');

const OLD = process.argv.includes('--old');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'cron', 'index.html'), 'utf8');

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) { console.error('找不到内联 script'); process.exit(2); }
let code = blocks[blocks.length - 1][1];

if (OLD) {
  // 1) 逐分钟搜索 + 10 万次上限（修复前的搜索）
  code = code.replace(/while \(results\.length < count[\s\S]*?\n  \}/,
`while (results.length < count && guard++ < 100000) {
    if (matchField(d.getMinutes(), 'minute', min) &&
        matchField(d.getHours(), 'hour', hour) &&
        matchField(d.getDate(), 'dom', dom) &&
        matchField(d.getMonth() + 1, 'month', mon) &&
        matchField(d.getDay(), 'dow', dow)) {
      results.push(new Date(d));
    }
    d.setMinutes(d.getMinutes() + 1);
  }`);
  // 2) 没有校验
  code = code.replace('function validateExpr(parts) {', 'function validateExpr(parts) {\n  return null;');
  // 3) 不支持 JAN/MON 这类三字母名字
  code = code.replace("if (/^\\d+$/.test(s)) return parseInt(s, 10);",
                      "if (/^\\d+$/.test(s)) return parseInt(s, 10);\n  return null;");
  // 4) 不支持「区间/起点 + 步长」（旧实现只认 * 带步长）
  code = code.replace("const slash = tok.split('/');",
                      "const slash = tok.split('/');\n  if (slash.length === 2 && slash[0] !== '*') return errPair('unsupported', '不支持');");
  // 5) 不支持 7 = 周日
  code = code.replace("if (kind === 'dow' && val === 0 && tokenMatch(7, t, kind)) return true;", "");
}

// ── 桩出浏览器环境 ──────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: '', textContent: '', innerHTML: '', style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, getAttribute: () => null,
      querySelector: () => el(id + ':child'),
    };
  }
  return els[id];
}
const document = {
  getElementById: el,
  querySelector: () => el('q'),
  querySelectorAll: () => [],
};
const navigator = { clipboard: { writeText: () => Promise.resolve() } };
const ctx = { document, navigator, Math, Number, String, JSON, console, setTimeout,
              parseInt, Date };
const fn = new Function(...Object.keys(ctx),
  code + '\nreturn { describeCron, describeTime, describeDate, getNextDates, matchField,' +
  ' matchDay, validateExpr, validateField, parseToken, parseExpr, syncFromFields, pad2 };');
const api = fn(...Object.values(ctx));

// ── 断言 ────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; console.log('  ✗ ' + name + '\n      got : ' + JSON.stringify(got) +
                        '\n      want: ' + JSON.stringify(want));
  }
}
function next(expr, n) {
  try { return api.getNextDates(expr, n || 10); } catch (e) { return 'THREW: ' + e.message; }
}
// 本地时间（页面按浏览器时区显示，测试也按本地时区判断）
function hm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
const mf = (v, kind, p) => api.matchField(v, kind, p);

console.log('1) 基础匹配：分 / 时 / 日 / 月 / 星期');
check('*/2 命中偶数分钟', mf(4, 'minute', '*/2'), true);
check('*/2 不命中奇数分钟', mf(3, 'minute', '*/2'), false);
check('0-59 全范围 = 每分钟', mf(37, 'minute', '*'), true);
check('1-5 区间内', mf(3, 'hour', '1-5'), true);
check('1-5 区间外', mf(6, 'hour', '1-5'), false);
check('列表 1,15,30 命中 15', mf(15, 'minute', '1,15,30'), true);
check('列表 1,15,30 不命中 16', mf(16, 'minute', '1,15,30'), false);
check('日字段 */2 从 1 起（1,3,5…）', [mf(1, 'dom', '*/2'), mf(2, 'dom', '*/2'), mf(3, 'dom', '*/2')], [true, false, true]);

console.log('\n2) 「区间/起点 + 步长」（标准 cron 语法，旧实现完全不支持）');
check('分钟 1-30/2 命中 5', mf(5, 'minute', '1-30/2'), true);
check('分钟 1-30/2 不命中 6', mf(6, 'minute', '1-30/2'), false);
check('分钟 1-30/2 不命中 33（区间外）', mf(33, 'minute', '1-30/2'), false);
check('分钟 5/10（起点 5 起每 10 分）命中 25', mf(25, 'minute', '5/10'), true);
check('分钟 5/10 不命中 6', mf(6, 'minute', '5/10'), false);
check('小时 8-18/2 命中 10', mf(10, 'hour', '8-18/2'), true);

console.log('\n3) 三字母名字（JAN-DEC / SUN-SAT，大小写不敏感）');
check('MON 命中星期一', mf(1, 'dow', 'MON'), true);
check('mon 小写同样命中', mf(1, 'dow', 'mon'), true);
check('MON 不命中星期二', mf(2, 'dow', 'MON'), false);
check('JAN 命中 1 月', mf(1, 'month', 'JAN'), true);
check('DEC 命中 12 月', mf(12, 'month', 'DEC'), true);
check('SUN 命中 0（周日）', mf(0, 'dow', 'SUN'), true);
check('JAN-FEB 区间', [mf(1, 'month', 'JAN-FEB'), mf(2, 'month', 'JAN-FEB'), mf(3, 'month', 'JAN-FEB')], [true, true, false]);

console.log('\n4) 7 = 周日（Vixie cron 同时接受 0 和 7）');
check('dow=7 命中周日', mf(0, 'dow', '7'), true);
check('dow=5-7 命中周日', mf(0, 'dow', '5-7'), true);
check('dow=5-7 命中周五', mf(5, 'dow', '5-7'), true);
check('dow=5-7 不命中周三', mf(3, 'dow', '5-7'), false);
check('dow=7 的表达式能算出下一次', next('0 0 * * 7', 1).length, 1);

console.log('\n5) DOM / DOW 同时限定 = OR（Vixie 语义，旧实现是 AND）');
const mixed = next('0 0 1 * 1', 5);
check('0 0 1 * 1 能给出 5 条（旧实现给 0 条）', Array.isArray(mixed) ? mixed.length : mixed, 5);
if (Array.isArray(mixed)) {
  check('每一条都是「1 号 或 周一」',
    mixed.every(d => d.getDate() === 1 || d.getDay() === 1), true);
  check('结果里既有「只是周一」也有「1 号」（证明是 OR 不是 AND）',
    mixed.some((d, i) => d.getDate() === 1 && mixed.some((e, j) => e.getDay() === 1 && e.getDate() !== 1)), true);
}

console.log('\n6) 远期表达式（旧实现逐分钟搜索 + 10 万次上限 = 约 69 天，超出就返回空表）');
const yearly = next('0 0 1 1 *', 10);
check('0 0 1 1 *（每年 1/1，页面预设之一）至少 5 条', Array.isArray(yearly) ? yearly.length >= 5 : yearly, true);
check('0 0 1 1 * 的每一条都是 1 月 1 日 00:00',
  Array.isArray(yearly) && yearly.every(d => d.getMonth() === 0 && d.getDate() === 1 && hm(d) === '00:00'), true);
check('0 0 1 * *（每月 1 号）10 条', next('0 0 1 * *', 10).length, 10);
check('0 0 29 2 *（2 月 29 日）至少 1 条（旧实现给 0 条）', next('0 0 29 2 *', 10).length >= 1, true);
check('0 0 29 2 * 算出来的确实是 2 月 29 日',
  next('0 0 29 2 *', 3).every(d => d.getMonth() === 1 && d.getDate() === 29), true);

console.log('\n7) 非法输入必须报错（旧实现静默给空列表）');
function withExpr(expr) {
  el('expr').value = expr;
  api.parseExpr();
  return String(el('desc-en').textContent) + ' | ' + String(el('desc-zh').textContent) +
         ' | ' + String(el('next-list').innerHTML);
}
check('60 * * * * → 分钟越界报错', /invalid/i.test(withExpr('60 * * * *')), true);
check('60 * * * * → 报错里带中文', /无效/.test(withExpr('60 * * * *')), true);
check('*/0 * * * * → 步长 0 报错', /invalid/i.test(withExpr('*/0 * * * *')), true);
check('* * * * → 明确提示需要 5 个字段', /5 fields/.test(withExpr('* * * *')), true);
check('0 0 32 * * → 日报错', /invalid/i.test(withExpr('0 0 32 * *')), true);
check('0 0 1 13 * → 月报错', /invalid/i.test(withExpr('0 0 1 13 *')), true);
check('0 0 * * FUNDAY → 报错（不是静默空表）', /invalid/i.test(withExpr('0 0 * * FUNDAY')), true);
check('合法表达式不报错', /invalid/i.test(withExpr('*/5 * * * *')), false);

console.log('\n8) 人类可读翻译（英文 + 中文）');
check('* * * * *', api.describeCron(['*', '*', '*', '*', '*']).en, 'Every minute');
check('*/5 * * * *', api.describeCron(['*/5', '*', '*', '*', '*']).en, 'Every 5 minutes');
check('0 0 * * *', api.describeCron(['0', '0', '*', '*', '*']).en, 'Every day at midnight');
check('15 3 * * * 不再是「at at 3:15」', api.describeCron(['15', '3', '*', '*', '*']).en, 'Every day, at 03:15');
check('*/5 * * * * 中文', api.describeCron(['*/5', '*', '*', '*', '*']).zh, '每 5 分钟');
check('15 3 * * * 中文', api.describeCron(['15', '3', '*', '*', '*']).zh, '每天，在 03:15');
check('30 8 * * 1-5 → 周一到周五（三字母缩写，与月名同风格）', api.describeCron(['30', '8', '*', '*', '1-5']).en,
  'Every Mon to Fri, at 08:30');
check('30 8 * * 1-5 中文', api.describeCron(['30', '8', '*', '*', '1-5']).zh, '周一到周五，在 08:30');
check('0 12 * * MON 说出 Mon', api.describeCron(['0', '12', '*', '*', 'MON']).en.includes('Mon'), true);
check('0 12 * JAN * 说出 Jan', api.describeCron(['0', '12', '*', 'JAN', '*']).en.includes('Jan'), true);
check('0 0 1 * 1 的文案带 or（把 OR 语义说出来）',
  /\bor\b/.test(api.describeCron(['0', '0', '1', '*', '1']).en), true);
check('0 9,17 * * * → 09:00 和 17:00 都在', api.describeCron(['0', '9,17', '*', '*', '*']).en, 'Every day, at 09:00, 17:00');
check('*/5 * * * * 描述里没有重复的 at at',
  /at at/i.test(api.describeCron(['*/5', '*', '*', '*', '*']).en), false);
check('*/5 * * * * 描述里没有「every hour」这种废话',
  /every hour/i.test(api.describeCron(['*/5', '*', '*', '*', '*']).en), false);
check('*/15 9-17 * * 1-5 → 用一段区间描述而不是 36 个时刻',
  api.describeCron(['*/15', '9-17', '*', '*', '1-5']).en,
  'Every Mon to Fri, every 15 minutes from 09:00 to 17:45');
check('*/15 9-17 * * 1-5 中文', api.describeCron(['*/15', '9-17', '*', '*', '1-5']).zh,
  '周一到周五，09:00 到 17:45 之间每 15 分钟');
check('0 */6 * * * → 每 6 小时', api.describeCron(['0', '*/6', '*', '*', '*']).en, 'Every day, every 6 hours');

console.log('\n9) 校验函数本身');
check('validateExpr 合法 → null', api.validateExpr(['*/5', '*', '*', '*', '*']), null);
check('validateExpr 字段数不对 → 报错对象', String((api.validateExpr(['*', '*', '*', '*']) || {}).en).includes('5 fields'), true);
check('validateField 空字段 → 报错', typeof (api.validateField('', 'minute') || {}).en, 'string');
check('validateField 反向区间 30-1 → 报错', typeof (api.validateField('30-1', 'minute') || {}).en, 'string');

console.log(`\n${pass} passed, ${fail} failed` +
  (OLD ? '  [OLD 反向测试：上面应当有成片失败 = 证明测试确实绑在修复上]' : ''));
process.exit(fail ? 1 : 0);
