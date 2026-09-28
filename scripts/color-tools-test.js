#!/usr/bin/env node
/* Color Tools 测试 —— 对 public/tools/color-tools.html 里**真实的内联脚本**跑断言。
 *
 * 为什么需要：这个页面即将被扩写正文，正文里会写「complementary 给 2 个色」「monochromatic
 * 用固定的 20/36/52/68/84% 明度阶梯」这类**可验证的事实**。事实必须来自跑起来的代码，
 * 不能来自读代码的猜。另外顺手验证 3 位十六进制（#0af）会不会把 <input type=color> 写坏。
 *
 * 用法:
 *   node scripts/color-tools-test.js
 *   node scripts/color-tools-test.js --old   # 反向测试：装回 3 位不展开的旧实现，应当失败
 */
const fs = require('fs');
const path = require('path');

const OLD = process.argv.includes('--old');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'tools', 'color-tools.html'), 'utf8');

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) { console.error('找不到内联 script'); process.exit(2); }
let code = blocks[blocks.length - 1][1];

if (OLD) {
  // 反向测试：parseHex 不把 3 位展开成 6 位（修复前的行为）
  code = code.replace(
    /function parseHex\(val\) \{[\s\S]*?\n\}/,
    `function parseHex(val) {
  let h = val.trim();
  if (!h.startsWith('#')) h = '#' + h;
  if (/^#[0-9a-fA-F]{6}$/.test(h)) return h;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return h;
  return null;
}`);
}

// ── 桩出浏览器环境 ──────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: '', textContent: '', innerHTML: '', style: {},
      classList: { add() {}, remove() {}, contains: () => false },
      addEventListener() {}, getAttribute: (n) => els[id]['_' + n] || null,
      querySelector: () => el(id + ':child'),
    };
  }
  return els[id];
}
const document = {
  getElementById: el,
  querySelector: (sel) => el('q:' + sel),
  querySelectorAll: () => [],
};
const navigator = { clipboard: { writeText: () => Promise.resolve() } };
const ctx = { document, navigator, Math, Number, String, JSON, console, setTimeout, parseInt };
const fn = new Function(...Object.keys(ctx),
  code + '\nreturn { hexToRgb, rgbToHsl, hslToRgb, rgbToHex, parseHex, parseRgb, parseHsl,' +
  ' getTextColor, setScheme, updateAll, generateRandomColors, randomColor };');
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
function palette(scheme) {
  api.setScheme(scheme);
  return [...String(el('palette').innerHTML).matchAll(/title="(#[0-9a-f]{6})"/g)].map(m => m[1]);
}
function hslOf(hex) { const c = api.hexToRgb(hex); return api.rgbToHsl(c.r, c.g, c.b); }

console.log('HEX → RGB');
check('#00d4aa', api.hexToRgb('#00d4aa'), { r: 0, g: 212, b: 170 });
check('#0af 三位缩写展开', api.hexToRgb('#0af'), { r: 0, g: 170, b: 255 });
check('#000000', api.hexToRgb('#000000'), { r: 0, g: 0, b: 0 });
check('#ffffff', api.hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });
check('#zzzzzz → null', api.hexToRgb('#zzzzzz'), null);

console.log('\nRGB → HSL');
check('red', api.rgbToHsl(255, 0, 0), { h: 0, s: 100, l: 50 });
check('页面示例 #00d4aa', api.rgbToHsl(0, 212, 170), { h: 168, s: 100, l: 42 });
check('grey 无饱和度', api.rgbToHsl(128, 128, 128), { h: 0, s: 0, l: 50 });

console.log('\nHSL → RGB（往返，注意整数精度是有损的）');
const back = Object.values(api.hslToRgb(168, 100, 42));
check('hsl(168,100%,42%) 逐通道差 ≤2（整数 HSL 存不下原色）',
  api.rgbToHex(...back) === '#00d4aa' ||
  back.every((v, i) => Math.abs(v - [0, 212, 170][i]) <= 2), true);
check('往返**不**保证逐位相同（这就是要把 HEX 当权威值的原因）',
  api.rgbToHex(...back) !== '#00d4aa', true);
check('hsl(0,0%,0%) 黑', api.rgbToHex(...Object.values(api.hslToRgb(0, 0, 0))), '#000000');

console.log('\nparseHex / parseRgb / parseHsl');
check("'00d4aa' 自动补 #", api.parseHex('00d4aa'), '#00d4aa');
check("'#0AF' 大写 3 位 → 展开并转小写", api.parseHex('#0AF'), '#00aaff');
check("'#12345' 拒绝（5 位非法）", api.parseHex('#12345'), null);
check("'red' 名称拒绝（只吃十六进制）", api.parseHex('red'), null);
check('rgb() 空格分隔也接受', api.parseRgb('rgb(0 212 170)'), { r: 0, g: 212, b: 170 });
check('rgb() 超范围被 clamp', api.parseRgb('rgb(300,0,0)'), { r: 255, g: 0, b: 0 });
check('hsl() 小数被拒（只收整数）', api.parseHsl('hsl(168.5,100%,42%)'), null);
check('hsl() 整数可解析', api.parseHsl('hsl(168,100%,42%)'), { h: 168, s: 100, l: 42 });

console.log('\n明暗标签色（BT.601 luma）');
check('白底 → 黑字', api.getTextColor('#ffffff'), '#000');
check('黑底 → 白字', api.getTextColor('#000000'), '#fff');
check('#00d4aa → 黑字', api.getTextColor('#00d4aa'), '#000');

// 基准色固定为页面默认 #00d4aa → H168 S100 L42
console.log('\n六种配色方案的**真实产出**（基准 #00d4aa）');
const counts = {};
for (const s of ['complementary', 'analogous', 'triadic', 'split-complementary',
                 'tetradic', 'monochromatic']) {
  counts[s] = palette(s).length;
}
check('色数', counts, { complementary: 2, analogous: 5, triadic: 3,
                        'split-complementary': 4, tetradic: 4, monochromatic: 5 });

const comp = palette('complementary');
check('complementary 第 1 个 = 基准色', comp[0], '#00d4aa');
check('complementary 第 2 个色相 = 168+180 → 348', hslOf(comp[1]).h, 348);

check('triadic 色相 168 / 288 / 48',
  palette('triadic').map(h => hslOf(h).h), [168, 288, 48]);
check('split-comp = 基准 + 120°/150°/180°（互补色侧的三档）',
  palette('split-complementary').map(h => hslOf(h).h), [168, 288, 318, 348]);
check('tetradic 色相 每 90°',
  palette('tetradic').map(h => hslOf(h).h), [168, 258, 348, 78]);
check('analogous 色相 基准 ±30°/±60°（饱和 +10 被 clamp 到 100）',
  palette('analogous').map(h => hslOf(h).h), [108, 138, 168, 198, 228]);
check('monochromatic 是**固定明度阶梯** 20/36/52/68/84（与基准明度无关）',
  palette('monochromatic').map(h => hslOf(h).l), [20, 36, 52, 68, 84]);
check('monochromatic 保留基准色相',
  palette('monochromatic').map(h => hslOf(h).h), [168, 168, 168, 168, 168]);

console.log('\n3 位十六进制（#0af）不能把 <input type=color> 写坏');
api.updateAll('#0af');
check('parseHex("#0af") 展开成 6 位', api.parseHex('#0af'), '#00aaff');
check('colorPicker.value 是 6 位（浏览器会拒绝 3 位）',
  /^#[0-9a-f]{6}$/.test(String(el('colorPicker').value)), true);
check('主色显示同步为 6 位', String(el('mainHex').textContent), '#00aaff');

console.log('\n随机色');
check('randomColor() 形状', /^#[0-9a-f]{6}$/.test(api.randomColor()), true);
api.generateRandomColors();
check('随机色网格 = 15 格',
  [...String(el('randomGrid').innerHTML).matchAll(/random-cell/g)].length, 15);
check('15 个随机色互不相同（概率性，重复即失败）',
  new Set([...String(el('randomGrid').innerHTML).matchAll(/title="(#[0-9a-f]{6})"/g)].map(m => m[1])).size, 15);

console.log(`\n${pass} passed, ${fail} failed` +
  (OLD ? '  [OLD 反向测试：上面出现失败即证明测试有效]' : ''));
process.exit(fail ? 1 : 0);
