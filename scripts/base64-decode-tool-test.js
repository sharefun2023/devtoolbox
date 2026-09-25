#!/usr/bin/env node
/* Base64 解码器测试（对 public/base64-decode.html 里**真实的内联脚本**跑断言）
 *
 * 起因：页面上写着「handles URL-safe Base64 (with - and _ instead of + and /)」，
 * 而实现是裸 atob(input) —— atob() 遇到 - 或 _ 会抛 InvalidCharacterError，
 * 即那条声明是假的。修完必须能被测试证明，而不是「看着像修好了」。
 *
 * 用法:
 *   node scripts/base64-decode-tool-test.js
 *   node scripts/base64-decode-tool-test.js --old   # 反向测试：装回旧实现，应当失败
 */
const fs = require('fs');
const path = require('path');

const OLD = process.argv.includes('--old');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'base64-decode.html'), 'utf8');

// 取最后一个内联 <script>（页面自己的逻辑；前面那个是 gtag）
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) { console.error('找不到内联 script'); process.exit(2); }
let code = blocks[blocks.length - 1][1];

if (OLD) {
  // 反向测试：把 b64Decode 换回修复前的实现（裸 atob），断言必须挂
  code = code
    .replace(/const norm=b64Normalize\(input\);[\s\S]*?try\{/,
             "const norm=input.replace(/\\s/g,'');\n  try{")
    .replace(/atob\(norm\)/, 'atob(norm)');
}

// ── 桩出浏览器环境 ──────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) els[id] = { value: '', textContent: '', style: {}, src: '',
                            onerror: null, onload: null };
  return els[id];
}
const document = { getElementById: el, querySelectorAll: () => [] };
const alerts = [];
const alert = m => alerts.push(m);
const ctx = { document, alert, navigator: { clipboard: { writeText() {} } },
              console, String, Number, Math, JSON, escape, decodeURIComponent,
              unescape, atob, btoa };
const fn = new Function(...Object.keys(ctx), code + '\nreturn { b64Decode, b64Normalize, decodeImage };');
const api = fn(...Object.values(ctx));

// ── 断言 ────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ERR = 'Error: Invalid Base64 input.';
function check(name, got, want) {
  if (got === want) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      got : ' + JSON.stringify(got) +
                             '\n      want: ' + JSON.stringify(want)); }
}
function decode(input) {
  el('b64in').value = input;
  el('b64out').value = '';
  api.b64Decode();
  return el('b64out').value;
}

// 造一个 base64url 里**真的含 - 或 _**的 ASCII 输入
const tricky = '>>>???';
const std = Buffer.from(tricky, 'utf8').toString('base64');
const url = Buffer.from(tricky, 'utf8').toString('base64url');
if (!/[+/\-_]/.test(std + url)) throw new Error('测试样本没覆盖 - / _ / +，需换样本');
console.log(`样本: ${JSON.stringify(tricky)} → base64=${std} base64url=${url}\n`);

console.log('标准 Base64:');
check('带 padding', decode(std), tricky);
check('去掉 padding 也能解', decode(std.replace(/=+$/, '')), tricky);
check('内部换行/空格被忽略', decode('aGVs\n bG8='), 'hello');
check('data URI 前缀被剥掉', decode('data:text/plain;base64,aGVsbG8='), 'hello');

console.log('\nBase64url（修复前必挂）:');
check('base64url 含 - 和 _', decode(url), tricky);
check('base64url 无 padding', decode(url.replace(/=+$/, '')), tricky);
check('base64url 的 JWT 段', decode('eyJhbGciOiJIUzI1NiJ9'), '{"alg":"HS256"}');

console.log('\nUTF-8:');
const zh = '中文 emoji 🎉 done';
check('中文+emoji 往返',
  decode(Buffer.from(zh, 'utf8').toString('base64')), zh);
check('中文+emoji 的 base64url',
  decode(Buffer.from(zh, 'utf8').toString('base64url')), zh);

console.log('\n非法输入（必须是报错文案，不能抛异常）:');
check('非法字符 *', decode('aGVs*bG8=').startsWith(ERR), true);
check('长度 %4==1', decode('aGVsb').startsWith(ERR), true);   // 5 字符，Base64 不可能
check('长度 %4==1（含 - 的 base64url）', decode('Pz8-8').startsWith(ERR), true);
check('非法字符不影响后续解码', decode(std), tricky);
check('空输入提示', decode('   '), 'Please paste a Base64 string first');

console.log('\nb64Normalize 归一化:');
check('去空白 + -/_ 还原', api.b64Normalize(' Pz8_ \n'), 'Pz8/');
check('补 padding', api.b64Normalize('Pz8'), 'Pz8=');
check('长度 %4==1 → null', api.b64Normalize('Pz8z8'), null);
check('空串', api.b64Normalize(''), '');

console.log('\n图片路径（用归一化后的串拼 data URI）:');
el('b64in').value = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64url');
el('previewImg').src = '';
api.decodeImage();
check('base64url 的 PNG 也能拼出 data URI',
  String(el('previewImg').src).startsWith('data:image/png;base64,'), true);
check('data URI 里不含 - / _', /[-_]/.test(String(el('previewImg').src).split(',')[1] || ''), false);

console.log(`\n${pass} passed, ${fail} failed${OLD ? '  [OLD 反向测试：上面出现失败即证明测试有效]' : ''}`);
process.exit(fail ? 1 : 0);
