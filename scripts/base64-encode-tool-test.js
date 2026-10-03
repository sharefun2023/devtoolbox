#!/usr/bin/env node
/* Base64 编码器测试（对 public/base64-encode.html 里**真实的内联脚本**跑断言）
 *
 * 起因：站上 9 处文案（首页卡片 / about 区块 / 4 个分类页 / 2 个工具页 / 本页 subtitle+description）
 * 都写着这个编码器「supports URL-safe Base64」，而实现是裸的 btoa()，**没有任何 URL-safe 开关**
 * —— 即那些声明是假的，而 base64url 恰好是 JWT / URL 参数 / data URI 里最常见的形态。
 * 修完必须能被测试证明，而不是「看着像修好了」。
 *
 * 用法:
 *   node scripts/base64-encode-tool-test.js
 *   node scripts/base64-encode-tool-test.js --old   # 反向测试：装回旧实现，URL-safe 断言应当失败
 */
const fs = require('fs');
const path = require('path');

const OLD = process.argv.includes('--old');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'base64-encode.html'), 'utf8');

// 取最后一个内联 <script>（页面自己的逻辑；前面那个是 gtag）
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) { console.error('找不到内联 script'); process.exit(2); }
let code = blocks[blocks.length - 1][1];

if (OLD) {
  // 反向测试：把 b64Encode 换回修复前的实现（裸 btoa，无 URL-safe）
  code = code
    .replace(/function b64Encode\(\)\{[\s\S]*?\n\}/,
      "function b64Encode(){\n  try{$('b64out').value=btoa(unescape(encodeURIComponent($('b64in').value)));b64Stats()}\n  catch(e){$('b64out').value='Error: '+e.message}\n}");
}

// ── 桩出浏览器环境 ──────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) els[id] = { value: '', textContent: '', style: {}, checked: false,
                            files: [], src: '', onerror: null, onload: null,
                            classList: { add() {}, remove() {} } };
  return els[id];
}
const document = {
  getElementById: el,
  querySelectorAll: () => [],
};
const ctx = { document, navigator: { clipboard: { writeText(t) { ctx.clipboardText = t; } } },
              console, String, Number, Math, JSON, escape, decodeURIComponent,
              unescape, atob, btoa, FileReader: undefined };
// FileReader 桩：把 file 对象转成 data URI（与浏览器行为一致）
class FakeFileReader {
  readAsDataURL(file) {
    this.result = 'data:' + (file.type || 'application/octet-stream') +
                  ';base64,' + Buffer.from(file.bytes).toString('base64');
    if (this.onload) this.onload();
  }
}
ctx.FileReader = FakeFileReader;
// toUrlSafe 是修复才引入的：修复前它不存在，用 typeof 守卫以便先跑出「修复前」的基线
const fn = new Function(...Object.keys(ctx),
  code + '\nreturn { b64Encode, b64Stats, "toUrlSafe": typeof toUrlSafe === "undefined" ? null : toUrlSafe, fileToBase64 };');
const api = fn(...Object.values(ctx));

// ── 断言 ────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(name, got, want) {
  if (got === want) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      got : ' + JSON.stringify(got) +
                             '\n      want: ' + JSON.stringify(want)); }
}
function encode(input, urlSafe) {
  el('b64in').value = input;
  el('b64out').value = '';
  el('b64url').checked = !!urlSafe;
  api.b64Encode();
  return el('b64out').value;
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const b64url = s => Buffer.from(s, 'utf8').toString('base64url');

console.log('标准 Base64（不能回归）:');
check('空输入 → 空输出', encode(''), '');
check('hello', encode('hello'), 'aGVsbG8=');
check('Hello World!', encode('Hello World!'), 'SGVsbG8gV29ybGQh');
check('对齐到 3 字节边界无 padding', encode('abc'), 'YWJj');
check('1 个 padding', encode('ab'), 'YWI=');
check('2 个 padding', encode('a'), 'YQ==');
check('JSON 片段', encode('{"a":1}'), b64('{"a":1}'));

console.log('\nUTF-8（原有能力，不能回归）:');
for (const s of ['中文', '中文 emoji 🎉 ok', 'café — naïve — ñ', '日本語テキスト']) {
  check(JSON.stringify(s), encode(s), b64(s));
}

console.log('\nURL-safe / base64url（修复前必挂）:');
const tricky = '??>>??~';
if (!/[+/]/.test(b64(tricky))) throw new Error('样本没覆盖 + / ，需换样本');
check('含 + 和 / 的输入 → URL-safe', encode(tricky, true), b64url(tricky));
check('URL-safe 输出不含 + / =', /[+/=]/.test(encode(tricky, true)), false);
check('URL-safe 中文', encode('中文 🎉', true), b64url('中文 🎉'));
check('URL-safe 的 padding 被去掉', encode('a', true), 'YQ');
check('勾选着也能再切回标准', (() => { encode('a', true); return encode('a', false); })(), 'YQ==');
check('data URI 场景用标准表（不得被 URL-safe 污染）',
  /[+/=]/.test(encode(tricky, false)), true);

console.log('\ntoUrlSafe 纯函数:');
const toUrlSafe = api.toUrlSafe || (() => null);   // 修复前为 null，下面三条即是基线失败
check('替换 + /', toUrlSafe('a+b/c='), 'a-b_c');
check('去掉尾部 padding', toUrlSafe('YWJj'), 'YWJj');
check('空串', toUrlSafe(''), '');

console.log('\n统计行:');
el('b64in').value = 'hello'; el('b64url').checked = false; api.b64Encode(); api.b64Stats();
check('标准模式统计', el('b64stats').textContent, '8 chars');
el('b64url').checked = true; api.b64Encode();
check('URL-safe 模式统计标明模式',
  /URL-safe/.test(el('b64stats').textContent), true);

console.log('\n非法输入（必须是报错文案，不能抛异常）:');
let threw = false;
try { encode('\uD800'); } catch (e) { threw = true; }
check('孤立代理项不抛异常', threw, false);
check('孤立代理项给出可读报错',
  /Error:/.test(encode('\uD800')), true);
check('报错后仍能正常编码', encode('hello'), 'aGVsbG8=');

console.log('\n文件 → Base64（FileReader 路径）:');
el('fileName').textContent = ''; el('fileSize').textContent = '';
el('fileB64out').value = ''; el('filestats').textContent = '';
el('fileInput').files = [{ name: 'tiny.png', size: 4, type: 'image/png',
                           bytes: [0x89, 0x50, 0x4e, 0x47] }];
api.fileToBase64();
check('剥掉 data URI 前缀', el('fileB64out').value, 'iVBORw==');
check('显示文件名', el('fileName').textContent, 'tiny.png');
check('统计行含字节数', /4\s*bytes/.test(el('filestats').textContent), true);
check('文件输出用标准表（data URI 需要）',
  /[+/=]/.test(el('fileB64out').value), true);

console.log(`\n${pass} passed, ${fail} failed${OLD ? '  [OLD 反向测试：上面出现失败即证明测试有效]' : ''}`);
process.exit(fail ? 1 : 0);
