#!/usr/bin/env node
/* Head-less test suite for public/js/json-formatter.js (DevToolBox JSON tool).
 * Run: node scripts/json-tool-test.js
 */
require('../public/js/json-formatter.js');
const J = globalThis.DTJson;
if (!J) { console.error('DTJson not exposed'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function err(name, text, mustInclude) {
  const r = J.validate(text);
  const msg = r.ok ? '(accepted!)' : r.error.message;
  ok(name, !r.ok && (!mustInclude || msg.toLowerCase().includes(mustInclude.toLowerCase())), msg);
  return r;
}

/* ── 1. valid inputs accepted ── */
const validSamples = [
  '{}', '[]', 'null', 'true', 'false', '0', '-0', '1.5', '-2.25e+10', '"hello"',
  '{"a":1,"b":[1,2,3],"c":{"d":null,"e":true}}',
  '{"unicode":"caf\\u00e9 \\u4e2d\\u6587","emoji":"\\ud83d\\ude00"}',
  '[{"id":1},{"id":2}]',
  '{"esc":"quote:\\" backslash:\\\\ slash:\\/ tab:\\t"}',
  '\ufeff{"bom":true}',                       // BOM is stripped
  '{"deep":[[' + '1,'.repeat(400) + '1]]}',   // 400-deep arrays still fine
  '[1e5,1E5,1e-5,1.0,0.5,12345678901234567890]'
];
validSamples.forEach((s, i) => {
  const r = J.validate(s);
  ok('valid #' + i + ' accepted', r.ok, r.ok ? '' : r.error.message + ' @' + r.error.position);
  let parsed = null;
  try { parsed = JSON.parse(s.replace(/^\ufeff/, '')); } catch (e) { parsed = 'THROWS'; }
  ok('valid #' + i + ' cross-checks with JSON.parse', r.ok ? parsed !== 'THROWS' : true);
});

/* ── 2. invalid inputs rejected with the right message ── */
err('trailing comma in object', '{"a":1,}', 'trailing comma');
err('trailing comma in array', '[1,2,]', 'trailing comma');
err('single quotes', "{'a':1}", 'single-quoted');
err('single-quoted value', '{"a":\'x\'}', 'single-quoted');
err('unquoted key', '{a:1}', 'unquoted key');
err('comment //', '{"a":1} // note', 'comment');
err('comment /* */', '{/* c */"a":1}', 'comment');
err('missing comma between props', '{"a":1 "b":2}', "expected ',' or '}'");
err('missing comma between elements', '[1 2]', "expected ',' or ']'");
err('unclosed object', '{"a":1', "unclosed object");
err('unclosed array', '[1,2', "unclosed array");
err('unclosed string', '{"a":"abc}', 'unclosed string');
err('leading zero', '{"a":007}', 'leading zeros');
err('plus sign', '{"a":+1}', "cannot start with '+'");
err('hex number', '{"a":0x1f}', 'hexadecimal');
err('decimal without digits', '{"a":1.}', 'followed by at least one digit');
err('exponent without digits', '{"a":1e}', 'exponent must be followed');
err('NaN', '{"a":NaN}', 'nan is not a valid json value');
err('undefined', '{"a":undefined}', 'undefined is not a valid');
err('Infinity', '{"a":Infinity}', 'infinity is not');
err('curly double quotes', '{\u201ca\u201d:1}', 'curly');
err('curly quote inside string', '{"a":"don\u2019t"}', 'curly');
err('two documents (NDJSON)', '{"a":1}{"b":2}', 'after the end of the json document');
err('trailing garbage', '{"a":1} xyz', 'after the end');
err('unbare value', '[tru]', 'unexpected character');
err('raw newline in string', '{"a":"line1\nline2"}', 'unescaped');
err('bad unicode escape', '{"a":"\\uZZ11"}', 'invalid unicode escape');
err('bad escape', '{"a":"\\q"}', 'invalid escape');
err('mismatched bracket', '{"a":1]', "where '}' was expected");
err('empty input', '   ', 'paste some json first');
err('parenthesis', '(1)', 'parentheses');
err('apostrophe escape', '{"a":"\\\'"}', 'invalid escape');

/* ── 3. position accuracy ── */
const pos = J.validate('{\n  "a": 1,\n  "b": 2,\n}');
ok('error line is 4', !pos.ok && pos.error.line === 4, JSON.stringify(pos.error));
ok('error column is 1', !pos.ok && pos.error.column === 1, JSON.stringify(pos.error));
ok('error lineText captured', !pos.ok && pos.error.lineText === '}', JSON.stringify(pos.error.lineText));
ok('lineColAt basic', JSON.stringify(J.lineColAt('ab\ncd', 4)) === '{"line":2,"column":2}');

/* ── 4. warnings ── */
const dup = J.validate('{"a":1,"a":2}');
ok('duplicate key warns', dup.ok && dup.warnings.length === 1, JSON.stringify(dup.warnings));

/* ── 5. format / minify ── */
const f = J.format('{"b":1,"a":[1,{"z":null}]}', { indent: 2 });
ok('format ok', f.ok);
ok('format 2-space', f.output === '{\n  "b": 1,\n  "a": [\n    1,\n    {\n      "z": null\n    }\n  ]\n}', JSON.stringify(f.output));
const ft = J.format('{"a":1}', { indent: 'tab' });
ok('tab indent', ft.output === '{\n\t"a": 1\n}', JSON.stringify(ft.output));
const f4 = J.format('{"a":1}', { indent: 4 });
ok('4-space indent', f4.output === '{\n    "a": 1\n}', JSON.stringify(f4.output));
const fs = J.format('{"b":1,"a":{"d":1,"c":2}}', { indent: 2, sort: true });
ok('sort keys', fs.output === '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}', JSON.stringify(fs.output));
ok('sort does not mutate arrays', JSON.stringify(J.sortDeep([3, 1, { b: 1, a: 2 }])) === '[3,1,{"a":2,"b":1}]');
const m = J.minify('{\n  "a": 1,\n  "b": [1, 2]\n}');
ok('minify', m.output === '{"a":1,"b":[1,2]}', JSON.stringify(m.output));
ok('format rejects invalid', !J.format('{oops}').ok);
ok('roundtrip minify→format keeps data', JSON.stringify(JSON.parse(J.minify(J.format('[1,{"a":"x y"}]', { indent: 3 }).output).output)) === '[1,{"a":"x y"}]');

/* ── 6. stats ── */
const st = J.stats(JSON.parse('{"a":1,"b":[true,null,"s"],"c":{"d":{}}}'));
ok('stats keys=4', st.keys === 4, JSON.stringify(st));
ok('stats depth=3', st.depth === 3, JSON.stringify(st));
ok('stats arrays=1', st.arrays === 1, JSON.stringify(st));
ok('stats objects=3', st.objects === 3, JSON.stringify(st));
ok('byteLength utf8', J.byteLength('中') === 3, String(J.byteLength('中')));

/* ── 7. diff ── */
const d = J.diff(JSON.parse('{"a":1,"b":2,"c":{"d":3}}'), JSON.parse('{"a":1,"b":9,"e":true,"c":{"d":3}}'));
const byType = t => d.filter(r => r.type === t).map(r => r.path).sort();
ok('diff removed b? no', byType('removed').length === 0, JSON.stringify(d));
ok('diff changed = b', JSON.stringify(byType('changed')) === '["b"]', JSON.stringify(d));
ok('diff added = e', JSON.stringify(byType('added')) === '["e"]', JSON.stringify(d));
ok('diff identical', J.diff(JSON.parse('[1,2]'), JSON.parse('[1,2]')).length === 0);
ok('diff array length change', J.diff(JSON.parse('[1]'), JSON.parse('[1,2]')).filter(r => r.type === 'added').length === 1);

/* ── 8. fuzz: never accept what JSON.parse rejects ── */
let mismatches = 0, examples = [];
const alphabet = '{}[]",:0123456789truefalsn-+e. \n\'/*\\x';
let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
for (let i = 0; i < 4000; i++) {
  let len = 1 + Math.floor(rnd() * 24), s = '';
  for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  const mine = J.validate(s).ok;
  let native = true;
  try { JSON.parse(s); } catch (e) { native = false; }
  if (mine && !native) { mismatches++; if (examples.length < 5) examples.push(JSON.stringify(s)); }
}
ok('fuzz: scanner never accepts JSON.parse-rejected input', mismatches === 0, mismatches + ' cases e.g. ' + examples.join(' '));

/* ── 9. fuzz the other way: valid random JSON is always accepted ── */
let rejected = 0, rex = [];
function genJson(depth) {
  const r = rnd();
  if (depth > 3 || r < 0.35) {
    const t = Math.floor(rnd() * 5);
    return t === 0 ? Math.floor(rnd() * 1e6) - 5e5
      : t === 1 ? 'str"' + Math.floor(rnd() * 1e6) + '"\\\n\t'
      : t === 2 ? (rnd() < 0.5)
      : t === 3 ? null : rnd() * 1e6;
  }
  if (r < 0.7) {
    const n = Math.floor(rnd() * 4), arr = [];
    for (let i = 0; i < n; i++) arr.push(genJson(depth + 1));
    return arr;
  }
  const n = Math.floor(rnd() * 4), o = {};
  for (let i = 0; i < n; i++) o['k' + i + '_' + Math.floor(rnd() * 100)] = genJson(depth + 1);
  return o;
}
for (let i = 0; i < 2000; i++) {
  const s = JSON.stringify(genJson(0));
  if (!J.validate(s).ok) { rejected++; if (rex.length < 5) rex.push(s.slice(0, 80)); }
}
ok('fuzz: every JSON.stringify output re-validates', rejected === 0, rejected + ' cases e.g. ' + rex.join(' | '));

/* ── 10. big input performance ── */
const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ i, name: 'row' + i, tags: ['a', 'b'] })));
const t0 = Date.now();
const bigRes = J.validate(big);
const dtMs = Date.now() - t0;
ok('20k-row array validates', bigRes.ok && bigRes.data.length === 20000);
ok('20k-row array under 2s', dtMs < 2000, dtMs + 'ms');
const t1 = Date.now();
const bigFmt = J.format(big, { indent: 2 });
ok('20k-row format under 3s', bigFmt.ok && Date.now() - t1 < 3000, (Date.now() - t1) + 'ms');

console.log('\n' + (fail === 0 ? '✓ ALL PASS' : '✗ FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
