#!/usr/bin/env node
/* HTML Minifier 测试 —— 对 public/tools/minifier.html 里**真实的内联脚本**跑断言。
 *
 * 为什么需要：这一页要写「HTML/CSS/JS 三种模式各自到底怎么压缩、故意不做什么」这类
 * **可验证的事实**。事实必须来自跑起来的代码，不能来自读代码的猜。
 * 首次跑（修复前）时挂了一片，逐条查下去发现 6 类真 bug：
 *
 *   CSS 压缩：① 无条件删 `//…` 行 → url(https://…) / url(//cdn…) / content:"http://x"
 *              后面的整行（含右花括号）全被吃掉 —— 实测 `url(https://example.com/a.png)`
 *              输出成 `url(https:`，是最常见 CSS 写法上的数据丢失。
 *             ② `\s*\+\s*` → `+` 把 calc(100% + 20px) 压成 calc(100%+20px)（非法 CSS）。
 *   CSS 美化：③ `:` 无条件加空格 → `a:hover` 变成 `a: hover`（非法）。
 *             ④ 数据 URI 被 `;` `,` 规则拆成两行。
 *             ⑤ 第一层声明完全没有缩进（"beautify" 出来是不缩进的）。
 *   JS  压缩：⑥ `a + +b` → `a++b`、`a - -b` → `a--b`、`i + ++j` → `i+++j`（token 重新解析）。
 *             ⑦ 换行被吞掉后的 ASI 隐患：`a = b` 下一行 `(function(){})()` 会被粘成一次调用；
 *                `return` 独占一行时会被粘到下一行 —— 都是「压缩成功但行为变了」。
 *
 * 用法:
 *   node scripts/minifier-tool-test.js
 *   node scripts/minifier-tool-test.js --old   # 反向测试：装回修复前的实现，相关断言必须失败
 *
 * --old 会装回上面 6 类里的 5 种实现（CSS 行注释 / calc 的 `+` / 旧 beautifyCSS /
 * 旧 needsSpaceBetween / 旧换行处理）。每处替换都会先断言「真的换掉了」，
 * 否则说明替换锚点失效 —— 那样 --old 会静默测到已修复的代码并谎报 0 失败。
 */
const fs = require('fs');
const path = require('path');

const OLD = process.argv.includes('--old');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'tools', 'minifier.html'), 'utf8');

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
if (!blocks.length) { console.error('找不到内联 script'); process.exit(2); }
let code = blocks[blocks.length - 1][1];

// ── --old：把修复前的实现装回去 ──────────────────────────────────
const OLD_BEAUTIFY_CSS = `function beautifyCSS(css) {
  let clean = css.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').trim();
  let indent = 0;
  let result = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{') { result += ' {\\n'; indent++; }
    else if (ch === '}') {
      indent = Math.max(0, indent - 1);
      result += '\\n' + '  '.repeat(indent) + '}';
      if (i + 1 < clean.length) result += '\\n';
    } else if (ch === ';') {
      result += ';\\n';
      if (indent > 0) {
        const nextNonWS = getNextNonSpace(clean, i + 1);
        if (nextNonWS !== '}') result += '  '.repeat(indent);
      }
    } else if (ch === ':') { result += ': '; }
    else if (ch === ',') {
      result += ', '; i++;
      while (i < clean.length && clean[i] === ' ') i++;
      i--;
    } else if (ch === '\\n' || ch === '\\r') {
    } else if (/\\s/.test(ch)) {
      if (result.endsWith('\\n')) result += '  '.repeat(indent);
      if (result.length > 0 && result[result.length - 1] === ' ') continue;
      result += ' ';
    } else { result += ch; }
  }
  return result.trim();
}
function getNextNonSpace(str, pos) {
  while (pos < str.length && (str[pos] === ' ' || str[pos] === '\\n' || str[pos] === '\\r')) pos++;
  return pos < str.length ? str[pos] : null;
}`;

const OLD_MINIFY_WS = `      i++;
      const prevResultChar = result.length > 0 ? result[result.length - 1] : '';
      const nextNonWs = getNextNonWS(js, i);
      if (prevResultChar && nextNonWs &&
          needsSpaceBetween(prevResultChar, nextNonWs)) {
        result += ' ';
      }
      continue;
    }`;

const OLD_NEEDS_SPACE = `function needsSpaceBetween(a, b) {
  if (/[a-zA-Z0-9_$]/.test(a) && /[a-zA-Z0-9_$]/.test(b)) return true;
  if (/[a-zA-Z0-9_$}]/.test(a) && /[{([a-zA-Z0-9_$]/.test(b)) return false;
  return false;
}`;

// 把新实现整段取出（从 `function beautifyCSS(css) {` 到下一个顶层 `function `）
function newBeautifyCss() {
  const start = code.indexOf('function beautifyCSS(css) {');
  const end = code.indexOf('\nfunction beautifyJS', start);
  if (start < 0 || end < 0) { console.error('找不到 beautifyCSS'); process.exit(2); }
  return code.slice(start, end);
}
function newNeedsSpace() {
  const start = code.indexOf('function needsSpaceBetween(a, b) {');
  const end = code.indexOf('\n}\n', start) + 3;
  if (start < 0) { console.error('找不到 needsSpaceBetween'); process.exit(2); }
  return code.slice(start, end);
}
function newMinifyWs() {
  const start = code.indexOf('      let hadNewline = false;');
  const end = code.indexOf('      continue;\n    }', start);
  if (start < 0 || end < 0) { console.error('找不到 minifyJS 的空白分支'); process.exit(2); }
  return code.slice(start, end + '      continue;\n    }'.length);
}

if (OLD) {
  const swaps = [
    // ① CSS 行注释：无条件删 `//…`（会把 https:// 后面的整行吃掉）
    ["    .replace(/^[ \\t]*\\/\\/.*$/gm, '')", "    .replace(/\\/\\/.*$/gm, '')"],
    // ② calc 的 `+`：把两侧空白压掉
    ['    .replace(/;}/g, \'}\')', "    .replace(/\\s*\\+\\s*/g, '+')\n    .replace(/;}/g, '}')"],
    // ③④⑤ 旧的 beautifyCSS（含它用到的 getNextNonSpace）
    [newBeautifyCss(), OLD_BEAUTIFY_CSS],
    // ⑥ 旧的 needsSpaceBetween
    [newNeedsSpace(), OLD_NEEDS_SPACE],
    // ⑦ 旧的换行处理
    [newMinifyWs(), OLD_MINIFY_WS],
  ];
  swaps.forEach(([from, to], n) => {
    if (!code.includes(from)) {
      console.error('--old 替换锚点 ' + (n + 1) + ' 未命中，测试不可信，退出');
      process.exit(2);
    }
    code = code.replace(from, to);
  });
}

// ── 桩出浏览器环境 ──────────────────────────────────────────────
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: '', textContent: '', innerHTML: '', placeholder: '', style: {},
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
  execCommand: () => true,
};
const navigator = { clipboard: { writeText: () => Promise.resolve() } };
const ctx = { document, navigator, Math, Number, String, JSON, console, setTimeout,
              parseInt, Date, Set, RegExp, Function };
const fn = new Function(...Object.keys(ctx),
  code + '\nreturn { minifyHTML, beautifyHTML, minifyCSS, beautifyCSS, minifyJS, ' +
  'beautifyJS, needsSpaceBetween, setMode };');
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
const INLINE_WS = /\u0000/;

console.log('1) HTML 压缩：受保护区块必须逐字节不动');
const preSrc = '<div>\n  <pre>  a\n  b  </pre>\n  <textarea>x  y</textarea>\n</div>';
const preOut = api.minifyHTML(preSrc);
check('<pre> 内容逐字节保留', preOut.includes('<pre>  a\n  b  </pre>'), true);
check('<textarea> 内容逐字节保留', preOut.includes('<textarea>x  y</textarea>'), true);
const scriptSrc = '<script>\n  // 注释里的 // 不能被当 CSS/HTML 注释处理\n  var a = 1 < 2;\n</script>';
check('<script> 内容逐字节保留（含 `//` 与 `<`）',
  api.minifyHTML(scriptSrc).includes('// 注释里的 // 不能被当 CSS/HTML 注释处理'), true);
const styleSrc = '<style>\n  .a > .b { color: red }\n</style>';
check('<style> 内容逐字节保留', api.minifyHTML(styleSrc).includes('.a > .b { color: red }'), true);
check('占位符不泄漏到输出', INLINE_WS.test(api.minifyHTML(preSrc + scriptSrc + styleSrc)), false);

console.log('\n2) HTML 压缩：空白与注释的取舍');
check('普通注释被删掉',
  api.minifyHTML('<div>\n  <!-- 广告位 -->\n  <p>x</p>\n</div>').includes('广告位'), false);
check('IE 条件注释保留',
  api.minifyHTML('<!--[if IE]><b>x</b><![endif]-->').includes('[if IE]'), true);
check('块级标签之间的空白被删',
  api.minifyHTML('<div>a</div>\n\n<div>b</div>'), '<div>a</div><div>b</div>');
check('行内标签之间的空白保留（否则单词会粘起来）',
  api.minifyHTML('<span>a</span>   <span>b</span>'), '<span>a</span> <span>b</span>');
check('文本与行内标签之间的空白保留',
  api.minifyHTML('<p>Hello <b>world</b> !</p>'), '<p>Hello <b>world</b> !</p>');
check('缩进与换行被压成一个空格',
  api.minifyHTML('<p>Hello\n     world</p>'), '<p>Hello world</p>');
check('属性里的 `>` 不会截断标签',
  api.minifyHTML('<a title="a>b">x</a>'), '<a title="a>b">x</a>');
check('未闭合的 `<` 按文本处理（不吞内容）',
  api.minifyHTML('<p>a < b</p>').includes('a < b'), true);

console.log('\n3) HTML 美化：缩进与结构');
const bHTML = api.beautifyHTML('<div><p>Hi</p><ul><li>one</li><li>two</li></ul></div>');
check('块级嵌套每层 +2 空格缩进（trim 掉末尾空行）',
  bHTML.trim().split('\n').map(l => (l.match(/^ */) || [''])[0].length),
  [0, 2, 2, 4, 4, 2, 0]);
check('`<p>x</p>` 同行闭合', bHTML.includes('  <p>Hi</p>'), true);
check('美化不泄漏占位符', INLINE_WS.test(bHTML), false);

console.log('\n4) CSS 压缩：`//` 不能当注释删（修复前会把整行吃掉）');
check('url(https://…) 完整保留',
  api.minifyCSS('body{background:url(https://example.com/a.png) no-repeat}'),
  'body{background:url(https://example.com/a.png) no-repeat}');
check('协议相对 url(//cdn…) 完整保留',
  api.minifyCSS('a{background:url(//cdn.example.com/x.png)}'),
  'a{background:url(//cdn.example.com/x.png)}');
check('content:"http://x" 里的 `//` 保留',
  api.minifyCSS('a::after{content:"http://x"}'), 'a::after{content:"http://x"}');
check('整行 `// …`（预处理器风格）仍会被删掉',
  api.minifyCSS('// 说明\n.a{color:red}'), '.a{color:red}');
check('块注释仍会被删掉',
  api.minifyCSS('.a{color:red/* 说明 */}'), '.a{color:red}');

console.log('\n5) CSS 压缩：calc() 的 `+` 必须留空格（去掉就是非法 CSS）');
check('calc(100% + 20px) 原样',
  api.minifyCSS('.a{width:calc(100% + 20px)}'), '.a{width:calc(100% + 20px)}');
check('calc(100% - 20px) 原样',
  api.minifyCSS('.a{width:calc(100% - 20px)}'), '.a{width:calc(100% - 20px)}');
check('calc 里多余的空白仍被压掉',
  api.minifyCSS('.a{width:calc( 100%   +   20px )}'), '.a{width:calc( 100% + 20px )}');

console.log('\n6) CSS 压缩：常规压缩仍然生效');
check('选择器/声明周围的空白与换行被压掉',
  api.minifyCSS('.a {\n  color: red;\n  margin : 0 ;\n}\n'),
  '.a{color:red;margin:0}');
check('媒体查询压缩',
  api.minifyCSS('@media (min-width: 600px) { .a { color: red; } }'),
  '@media (min-width:600px){.a{color:red}}');
check('子代/兄弟选择器周围的空白压缩',
  api.minifyCSS('ul > li ~ li { color: red }'), 'ul>li~li{color:red}');
check('数据 URI 里的 `;` `,` 不被当结构符号',
  api.minifyCSS('.i{background:url(data:image/png;base64,AAA=)}'),
  '.i{background:url(data:image/png;base64,AAA=)}');
check('字符串里的空白不被压（content:" > "）',
  api.minifyCSS('a::after{content:" > "}'), 'a::after{content:" > "}');
check('url("…") 引号形式也保留',
  api.minifyCSS('.a{background:url("a b.png")}'), '.a{background:url("a b.png")}');

console.log('\n7) CSS 美化：伪类选择器不能被拆坏');
check('a:hover 不变成 a: hover',
  api.beautifyCSS('a:hover{color:red}'), 'a:hover {\n  color: red\n}');
check('声明冒号后有空格（color: red）',
  api.beautifyCSS('a{color:red}').includes('color: red'), true);
check('媒体查询里的冒号也加空格',
  api.beautifyCSS('@media (min-width:600px){a{color:red}}')
    .includes('@media (min-width: 600px) {'), true);
const bCSS = api.beautifyCSS('.a{color:red;margin:0}.b{padding:1px}');
check('两条规则各自缩进一致、块首格不缩进',
  bCSS.split('\n').map(l => (l.match(/^ */) || [''])[0].length), [0, 2, 2, 0, 0, 2, 0]);
check('两条规则之间换行分隔（不是并成一行）', bCSS.split('\n').length, 7);
check('数据 URI 完整保留',
  api.beautifyCSS('.i{background:url(data:image/png;base64,AAA=)}')
    .includes('url(data:image/png;base64,AAA=)'), true);
check('字符串原样保留',
  api.beautifyCSS('a::after{content:"a; b: c"}').includes('"a; b: c"'), true);
check('嵌套 @media 每层 +2 空格',
  api.beautifyCSS('@media screen{a{b{color:red}}}')
    .split('\n').map(l => (l.match(/^ */) || [''])[0].length), [0, 2, 4, 6, 4, 2, 0]);
check('calc 的 `+` 两侧空白都必须留住（少一个就是非法 CSS）',
  api.beautifyCSS('.i{width:calc(100% + 20px)}').includes('calc(100% + 20px)'), true);
check('calc 的 `-` 两侧空白同样留住',
  api.beautifyCSS('.i{width:calc(100% - 20px)}').includes('calc(100% - 20px)'), true);
check('媒体查询里的空白不被吃掉',
  api.beautifyCSS('@media (min-width:600px){a{color:red}}').includes('(min-width: 600px)'), true);

console.log('\n8) JS 压缩：运算符不能被粘成 ++ / --');
check('a + +b 保留空格', api.minifyJS('const x = a + +b;'), 'const x=a+ +b;');
check('a - -b 保留空格', api.minifyJS('const y = a - -b;'), 'const y=a- -b;');
check('i + ++j 保留空格', api.minifyJS('let z = i + ++j;'), 'let z=i+ ++j;');
check('a++ + b 保留空格', api.minifyJS('let w = a++ + b;'), 'let w=a++ +b;');
check('数字点成员访问保留空格', api.minifyJS('(1) .toString();'), '(1).toString();');
check('整数点成员访问保留空格', api.minifyJS('1 .toString();'), '1 .toString();');

console.log('\n9) JS 压缩：注释、字符串、正则');
check('行注释被删', api.minifyJS('let a = 1; // 说明'), 'let a=1;');
check('块注释被删', api.minifyJS('let a = 1; /* 说明 */ let b = 2;').includes('说明'), false);
check('字符串里的 // 不是注释',
  api.minifyJS('const u = "https://x.com/a";'), 'const u="https://x.com/a";');
check('正则字面量里的空格与转义保留（第 8 组为反斜杠斜杠）',
  api.minifyJS(String.raw`const re = /a\/b c/g;`), String.raw`const re=/a\/b c/g;`);

console.log('\n10) JS 压缩：换行与 ASI（旧实现把换行吞掉）');
const asi1 = api.minifyJS('let a = b\n(function(){ return 1 })()');
check('`a = b` 与下一行 `(…)()` 不能被粘成一次调用', asi1.includes('\n'), true);
const asi2 = api.minifyJS('function f() {\n  return\n  1;\n}');
check('return 独占一行的语义保持（换行还在）',
  asi2.split('\n').some(l => l.trim() === 'return'), true);
check('函数体缩进被去掉、换行保留',
  api.minifyJS('function f() {\n  return 1;\n}'), 'function f(){\nreturn 1;\n}');
check('同一行内的空白仍被压掉',
  api.minifyJS('let a = 1 ;  let b  =  2 ;'), 'let a=1;let b=2;');
check('关键字与标识符之间的空格保留',
  api.minifyJS('typeof  x'), 'typeof x');
check('`in` / `instanceof` 两侧空格保留',
  api.minifyJS('a  in  b'), 'a in b');

console.log('\n11) 行为等价（真跑 new Function，比对返回值）');
const corpus = [
  ['const x = a + +b; return x;', { a: 1, b: 2 }, 3],
  ['const y = a - -b; return y;', { a: 5, b: 3 }, 8],
  ['let i = 1; let j = 2; return i + ++j;', {}, 4],
  ['let o = {a:1}; o.a  +=  2 ; return o.a;', {}, 3],
  ['function f(n){ if(n>1){ return n*f(n-1); } else { return 1; } } return f(5);', {}, 120],
  ['let s = ""; for (let i = 0; i < 3; i++) { s += i; } return s;', {}, '012'],
  ['const u = "https://x.com/a"; return u.length;', {}, 15],
  ['const re = /a\\/b/; return re.test("a/b");', {}, true],
  ['let k = 10; return k / 2 / 5;', {}, 1],
  ['return [1,2,3].map(function(v){ return v * 2; }).join("-");', {}, '2-4-6'],
];
let eqOK = 0, eqTotal = 0;
corpus.forEach(([src, args, want]) => {
  eqTotal++;
  const out = api.minifyJS(src);
  let gotSrc, gotOut;
  try { gotSrc = Function(...Object.keys(args), src)(...Object.values(args)); }
  catch (e) { gotSrc = 'THREW: ' + e.message; }
  try { gotOut = Function(...Object.keys(args), out)(...Object.values(args)); }
  catch (e) { gotOut = 'THREW: ' + e.message; }
  if (JSON.stringify(gotSrc) === JSON.stringify(want) &&
      JSON.stringify(gotOut) === JSON.stringify(want)) eqOK++;
  else {
    fail++;
    console.log('  ✗ 行为不一致：' + JSON.stringify(src) +
                '\n      压缩后: ' + JSON.stringify(out) +
                '\n      原 : ' + JSON.stringify(gotSrc) + ' / 压缩后: ' + JSON.stringify(gotOut) +
                ' / 期望: ' + JSON.stringify(want));
  }
});
pass += eqOK;
console.log('  ✓ 10 段代码压缩前后行为一致（' + eqOK + '/' + eqTotal + '）');

console.log('\n12) JS 美化：缩进与字符串');
const bJS = api.beautifyJS('function f(){if(a){b()}else{c()}}');
check('花括号换行 + 每层缩进',
  bJS.split('\n').map(l => (l.match(/^ */) || [''])[0].length), [0, 2, 4, 2, 4, 2, 0]);
check('字符串里的花括号不参与换行',
  api.beautifyJS('const s = "{ }";').includes('"{ }"'), true);
check('美化结果可被解析',
  (() => { try { new Function(bJS); return true; } catch (e) { return false; } })(), true);

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
