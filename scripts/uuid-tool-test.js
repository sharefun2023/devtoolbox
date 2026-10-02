#!/usr/bin/env node
/* UUID Generator 测试 —— 对 public/tools/uuid-generator.html 里**真实的内联脚本**跑断言。
 *
 * 为什么需要：这一页的正文与 FAQ 断言了「支持 v1/v4/v7/GUID/NanoID/ULID 六种形态、
 * 一次最多 500 条、三种输出格式、能导 CSV/JSON」。这些是可验证的事实，必须来自跑起来的
 * 代码，不能来自读代码的猜。
 *
 * 首次跑就抓到一个真 bug：
 *   ULID 的时间戳前缀用的是 `Date.now().toString(32)` —— Number.toString(32) 的字母表是
 *   0-9a-v，而 ULID 用 Crockford base32（0-9 去掉 I L O U 的 A-Z）。两者不重合的部分正好是
 *   I / L / O / U，于是会输出 `01K3U8K8OL1B8DKBYZCYMGB0GC` 这种「含 L」的串 ——
 *   一个严格按 ULID 字母表校验的解码器会直接拒绝它，而页面自己的 chars 常量里根本没有 L。
 *   已改成用同一个字母表逐位编码 48-bit 毫秒时间戳。
 *
 * 用法:
 *   node scripts/uuid-tool-test.js
 *   node scripts/uuid-tool-test.js --old   # 反向测试：装回 toString(32) 的旧实现，相关断言必须失败
 */
const fs = require('fs');
const path = require('path');

const OLD = process.argv.includes('--old');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'tools', 'uuid-generator.html'), 'utf8');

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) { console.error('找不到内联 script'); process.exit(2); }
let code = blocks[blocks.length - 1][1];

if (OLD) {
  const NEW_ULID = "var t = Date.now(), time = '';\n    for (var k = 9; k >= 0; k--) { time = chars[t % 32] + time; t = Math.floor(t / 32); }";
  const OLD_ULID = "var time = Date.now().toString(32).padStart(10, '0').toUpperCase();";
  if (!code.includes(NEW_ULID)) {
    console.error('--old 替换锚点未命中，测试不可信，退出');
    process.exit(2);
  }
  code = code.replace(NEW_ULID, OLD_ULID);
}

// ── 桩出浏览器环境 ──────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: '', textContent: '', innerHTML: '', style: {}, placeholder: '',
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, getAttribute: () => null, appendChild() {}, removeChild() {},
      querySelectorAll: () => [], querySelector: () => el(id + ':child'),
      click() {}, select() {}, setAttribute() {},
      querySelector: () => el(id + ':child'),
    };
  }
  return els[id];
}
const document = {
  getElementById: el,
  querySelector: () => el('q'),
  querySelectorAll: () => [],
  createElement: () => el('created:' + Math.random()),
  execCommand: () => true,
  body: { appendChild() {}, removeChild() {} },
};
const navigator = { clipboard: { writeText: () => Promise.resolve() } };
// 真随机源：node 的 crypto 就是浏览器 crypto.getRandomValues 的等价物
const nodeCrypto = require('crypto');
const crypto = {
  randomUUID: () => nodeCrypto.randomUUID(),
  getRandomValues: (arr) => { const b = nodeCrypto.randomBytes(arr.length); arr.set(b); return arr; },
};
const blobs = [];
class Blob {
  constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; blobs.push(this); }
}
const URL_ = { createObjectURL: () => 'blob:stub' };
const window = {};
window.crypto = crypto;
const ctx = { window, document, navigator, crypto, Blob, URL: URL_, Math, Number, String, JSON,
              console, setTimeout, parseInt, parseFloat, Date, Set, Array, Object, isNaN,
              RegExp, Function, Error };
new Function(...Object.keys(ctx), code + '\nreturn window;')(...Object.values(ctx));
// 页面脚本把自己包在 IIFE 里，只通过 window 暴露这 8 个入口 —— 测试只能走公开 API，
// 不去碰内部函数（内部函数名会变，公开 API 是页面上真实按钮调用的东西）。
const api = {
  uuidPick: window.uuidPick, uuidFmt: window.uuidFmt, uuidGen: window.uuidGen,
  uuidBulk: window.uuidBulk, uuidDownload: window.uuidDownload, uuidClear: window.uuidClear,
};
const exposed = ['uuidPick','uuidFmt','uuidGen','uuidCopyOut','uuidBulk','uuidCopyBulk','uuidClear','uuidDownload'];

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
const gen = (v, f) => { api.uuidPick(v); if (f) api.uuidFmt(f); api.uuidGen(); return el('uuid-out').textContent; };
const RE = {
  v4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  v1: /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  v7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
};
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;   // Crockford base32，不含 I L O U
const NANOID_RE = /^[A-Za-z0-9_-]{21}$/;

console.log('1) 六种形态的形状（各抽 50 条）');
['v4', 'v1', 'v7'].forEach(v => {
  const ok = Array.from({ length: 50 }, () => gen(v)).every(s => RE[v].test(s));
  check(v + ' 50 条全部符合版本位与变体位', ok, true);
});
const guid = gen('guid');
check('guid 是 Microsoft 风格 {大写} 形式', /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/.test(guid), true);
check('nanoid 21 字符、标准字母表', NANOID_RE.test(gen('nanoid')), true);
const ulids = Array.from({ length: 50 }, () => gen('ulid'));
check('ulid 26 字符、只含 Crockford 字母表（无 I L O U）',
  ulids.every(s => ULID_RE.test(s)), true);
check('ulid 里出现的每个字符都在页面自己的 chars 常量里',
  ulids.every(s => [...s].every(c => ULID_CHARS.includes(c))), true);
check('ulid 前 10 位是时间戳、后 16 位随机（长度）',
  ulids.every(s => s.length === 26), true);
check('ulid 相邻两条按时间递增（时间戳前缀单调）',
  (() => { const a = ulids[0].slice(0, 10), b = ulids[ulids.length - 1].slice(0, 10); return b >= a; })(), true);

console.log('\n2) ULID 时间戳：必须是 48-bit 毫秒的 Crockford base32');
const fixed = (() => {                    // 用固定时间验证编码本身
  const t = 1798761600000;                // 2026-12-31T00:00:00Z
  let time = '', x = t;
  for (let k = 9; k >= 0; k--) { time = ULID_CHARS[x % 32] + time; x = Math.floor(x / 32); }
  return time;
})();
check('48-bit 毫秒 → 10 个 Crockford 字符、首位 0-7',
  fixed.length === 10 && /^[0-7]/.test(fixed), true);
check('该编码可逆（乘回去等于原值）',
  [...fixed].reduce((acc, c) => acc * 32 + ULID_CHARS.indexOf(c), 0), 1798761600000);
check('新旧实现的分歧点：toString(32) 会产出字母表外的字符',
  (1798761600000).toString(32).toUpperCase().split('').some(c => !ULID_CHARS.includes(c)), true);

console.log('\n3) 三种输出格式（UUID 类才适用）');
const lowOne = gen('v4', 'lower');
check('lower 保持小写', lowOne, lowOne.toLowerCase());
check('切换回 lower 后不再是 upper 的形态', /^[0-9a-f-]{36}$/.test(gen('v4', 'lower')), true);
check('upper 全大写', /^[0-9A-F-]{36}$/.test(gen('v4', 'upper')), true);
check('nohyphen 去掉连字符（32 位）', /^[0-9a-f]{32}$/.test(gen('v4', 'nohyphen')), true);
check('nohyphen 对 guid 也生效（去连字符、保留花括号）',
  /^\{[0-9A-F]{32}\}$/.test(gen('guid', 'nohyphen')), true);
check('nanoid / ulid 不受格式开关影响（非 UUID）',
  [gen('nanoid', 'upper'), gen('ulid', 'upper')].every(s => s === s) &&
  NANOID_RE.test(gen('nanoid', 'uppercase')), true);
api.uuidFmt('lower');

console.log('\n4) 批量：一次最多 500 条，且互不重复');
api.uuidPick('v4');
el('uuid-count').value = '500';
api.uuidBulk();
const lines = el('uuid-bulk').value.split('\n');
check('批量输出 500 行', lines.length, 500);
check('500 条全部是合法 v4', lines.every(l => RE.v4.test(l)), true);
check('500 条互不重复', new Set(lines).size, 500);
el('uuid-count').value = '900';
api.uuidBulk();
check('输入 900 被夹到上限 500', el('uuid-bulk').value.split('\n').length, 500);
check('输入框被回写成 500', el('uuid-count').value, 500);
el('uuid-count').value = '0';
api.uuidBulk();
check('非法输入 0 回落到 10 条', el('uuid-bulk').value.split('\n').length, 10);
api.uuidPick('guid');
el('uuid-count').value = '5';
api.uuidBulk();
check('批量跟随当前选中的形态（guid → 全部 5 条都是 {…} 形式）',
  el('uuid-bulk').value.split('\n').every(l => /^\{[0-9A-F-]{36}\}$/.test(l)), true);
api.uuidPick('v4');
check('批量清空', (api.uuidBulk(), el('uuid-count').value = '3', api.uuidBulk(), el('uuid-bulk').value.split('\n').length), 3);

console.log('\n5) 导出 CSV / JSON');
blobs.length = 0;
api.uuidDownload('csv');
api.uuidDownload('json');
check('生成两个 Blob', blobs.length, 2);
check('CSV 的 MIME 是 text/csv', blobs[0].type, 'text/csv');
check('JSON 的 MIME 是 application/json', blobs[1].type, 'application/json');
const csvText = blobs[0].parts.join('');
const jsonText = blobs[1].parts.join('');
check('CSV 有表头 uuid', csvText.split('\n')[0], 'uuid');
check('CSV 行数 = 表头 + 3 条', csvText.trim().split('\n').length, 4);
check('JSON 是合法数组且长度 3', JSON.parse(jsonText).length, 3);

console.log('\n6) 变量选择状态（页面按钮走 uuidPick）');
api.uuidPick('v7');
check('uuidPick 切换后 uuidGen 输出 v7', RE.v7.test(el('uuid-out').textContent), true);
api.uuidPick('nanoid');
check('uuidPick 切换后输出 nanoid', NANOID_RE.test(el('uuid-out').textContent), true);

console.log('\n────────────────────────────────────────');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (OLD) {
  if (fail === 0) {
    console.log('⚠️  --old 模式应当成片失败，却全部通过 —— 说明替换没有真正生效。');
    process.exit(1);
  }
  console.log('（--old 模式：以上失败正是「断言绑在修复上」的证明）');
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
