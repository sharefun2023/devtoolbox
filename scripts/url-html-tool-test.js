#!/usr/bin/env node
/* Head-less tests for the URL tool and the HTML-entity tool.
 * Run: node scripts/url-html-tool-test.js
 */
require('../public/js/url-tool.js');
require('../public/js/html-entity-tool.js');
const U = globalThis.DTUrl, H = globalThis.DTHtml;
if (!U || !H) { console.error('modules not exposed'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* ═══════════════ URL tool ═══════════════ */

ok('component encode', U.encode('a b&c=d?', 'component') === 'a%20b%26c%3Dd%3F', U.encode('a b&c=d?', 'component'));
ok('component leaves unreserved', U.encode('A-z_0.9-~', 'component') === 'A-z_0.9-~', U.encode('A-z_0.9-~', 'component'));
ok('strict escapes !\'()*', U.encode("!'()*", 'strict') === '%21%27%28%29%2A', U.encode("!'()*", 'strict'));
ok('component does not escape !\'()*', U.encode("!'()*", 'component') === "!'()*", U.encode("!'()*", 'component'));
ok('uri mode keeps reserved chars', U.encode('https://a.com/b?c=d&e=f#g', 'uri') === 'https://a.com/b?c=d&e=f#g', U.encode('https://a.com/b?c=d&e=f#g', 'uri'));
ok('uri mode escapes spaces', U.encode('/a b', 'uri') === '/a%20b', U.encode('/a b', 'uri'));
ok('form mode uses +', U.encode('a b', 'form') === 'a+b', U.encode('a b', 'form'));
ok('encode multiline', U.encode('l1\nl2', 'component') === 'l1%0Al2', U.encode('l1\nl2', 'component'));

ok('decode component', U.decode('a%20b', 'component').text === 'a b');
ok('decode unicode', U.decode('%E4%B8%AD%E6%96%87', 'component').text === '中文', U.decode('%E4%B8%AD%E6%96%87', 'component').text);
ok('decode emoji (4-byte)', U.decode('%F0%9F%98%80', 'component').text === '😀', U.decode('%F0%9F%98%80', 'component').text);
ok('decode form mode turns + into space', U.decode('a+b', 'form').text === 'a b', U.decode('a+b', 'form').text);
ok('lenient keeps plus when not form', U.decode('a+b', 'lenient').text === 'a+b');
ok('lenient reports bad escape', U.decode('abc%zzdef', 'lenient').issues.length === 1 && U.decode('abc%zzdef', 'lenient').text === 'abc%zzdef', JSON.stringify(U.decode('abc%zzdef', 'lenient')));
ok('lenient keeps incomplete utf-8', /%E4%B8/.test(U.decode('%E4%B8', 'lenient').text), U.decode('%E4%B8', 'lenient').text);
ok('lenient does not throw on trailing %', U.decode('100%', 'lenient').text === '100%');
ok('strict decode throws on malformed', U.decode('%E4%B8', 'strict').ok === false);
ok('strict decode ok when valid', U.decode('%41', 'strict').ok === true && U.decode('%41', 'strict').text === 'A');
ok('double-encoded detection', U.looksDoubleEncoded('a%2520b') === true && U.looksDoubleEncoded('a%20b') === false);
ok('round trip unicode', U.decode(U.encode('中文 & café?', 'component'), 'component').text === '中文 & café?');
ok('utf8Bytes 中', JSON.stringify(U.utf8Bytes('中')) === '[228,184,173]', JSON.stringify(U.utf8Bytes('中')));
ok('utf8Bytes emoji', U.utf8Bytes('😀').length === 4, JSON.stringify(U.utf8Bytes('😀')));

const p = U.parse('https://user:pw@example.com:8080/a/b.html?x=1&y=a%20b#frag');
ok('parse absolute', p && p.absolute === true, JSON.stringify(p));
ok('parse protocol', p.protocol === 'https', p.protocol);
ok('parse username/password', p.username === 'user' && p.password === 'pw');
ok('parse host/port', p.host === 'example.com:8080' && p.port === '8080', p.host);
ok('parse pathname', p.pathname === '/a/b.html', p.pathname);
ok('parse search/hash', p.search === '?x=1&y=a%20b' && p.hash === '#frag', p.search + ' ' + p.hash);
ok('parse origin', p.origin === 'https://example.com:8080', p.origin);

const pidn = U.parse('https://例え.jp/パス?q=1');
ok('IDN host punycoded', pidn && pidn.hostname === 'xn--r8jz45g.jp', pidn && pidn.hostname);
ok('IDN raw host kept for display', pidn && pidn.punycodeFrom === '例え.jp', pidn && pidn.punycodeFrom);
ok('IDN path percent-encoded by URL', pidn && /%E3%83%91%E3%82%B9/.test(pidn.pathname), pidn && pidn.pathname);

const prel = U.parse('/relative/path?a=1#h');
ok('relative url parsed', prel && prel.absolute === false && prel.pathname === '/relative/path' && prel.search === '?a=1', JSON.stringify(prel));
ok('empty input → null', U.parse('   ') === null);

const q = U.parseQuery('a=1&b=hello+world&flag&c=%E4%B8%AD&d=', true);
ok('parseQuery count', q.length === 5, JSON.stringify(q.map(x => x.key)));
ok('parseQuery + → space', q[1].value === 'hello world', q[1].value);
ok('parseQuery unicode', q[3].value === '中', q[3].value);
ok('parseQuery flag without =', q[2].hasEquals === false && q[2].key === 'flag');
ok('parseQuery empty value kept', q[4].hasEquals === true && q[4].value === '');
ok('parseQuery strips leading ?', U.parseQuery('?a=1').length === 1);
ok('parseQuery empty', U.parseQuery('').length === 0);
ok('buildQuery round trip', U.buildQuery(U.parseQuery('a=1&b=x%20y')) === 'a=1&b=x%20y', U.buildQuery(U.parseQuery('a=1&b=x%20y')));

const ec = U.analyzeChars('a中é');
ok('analyzeChars finds 2 non-ascii', ec.length === 2, JSON.stringify(ec));
ok('analyzeChars codepoint', ec[0].codepoint === 'U+4E2D', ec[0].codepoint);
ok('analyzeChars bytes', ec[0].bytes === '%E4%B8%AD', ec[0].bytes);
ok('analyzeChars é single byte run', ec[1].bytes === '%C3%A9', ec[1].bytes);

const ae = U.analyzeEscapes('x%20y%E4%B8%ADz');
ok('analyzeEscapes count', ae.length === 2, JSON.stringify(ae));
ok('analyzeEscapes decodes', ae[0].decoded === ' ' && ae[1].decoded === '中', JSON.stringify(ae));
ok('analyzeEscapes valid flag', ae[0].valid === true);
ok('analyzeEscapes flags invalid utf-8', U.analyzeEscapes('%E4%B8')[0].valid === false);

/* ═══════════════ HTML entity tool ═══════════════ */

ok('entity table size', H.entityCount >= 200, String(H.entityCount));
ok('minimal escapes the dangerous five',
  H.encode('<a href="x">&\'</a>', 'minimal') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
  H.encode('<a href="x">&\'</a>', 'minimal'));
ok('minimal leaves normal text alone', H.encode('Hello, world 123', 'minimal') === 'Hello, world 123');
ok('minimal leaves accents alone', H.encode('café', 'minimal') === 'café');
ok('named uses names', H.encode('café © €', 'named') === 'caf&eacute; &copy; &euro;', H.encode('café © €', 'named'));
ok('named falls back to numeric', H.encode('中文', 'named') === '&#20013;&#25991;', H.encode('中文', 'named'));
ok('dec numeric', H.encode('中', 'dec') === '&#20013;', H.encode('中', 'dec'));
ok('hex numeric', H.encode('中', 'hex') === '&#x4E2D;', H.encode('中', 'hex'));
ok('hex numeric ascii untouched', H.encode('abc', 'hex') === 'abc');
ok('all mode encodes everything', H.encode('ab', 'all') === '&#97;&#98;', H.encode('ab', 'all'));
ok('all mode keeps emoji as one entity', H.encode('😀', 'all') === '&#128512;', H.encode('😀', 'all'));
ok('emoji surrogate pair handled', H.encode('😀', 'dec') === '&#128512;', H.encode('😀', 'dec'));

ok('decode basic', H.decode('&lt;b&gt;').text === '<b>', H.decode('&lt;b&gt;').text);
ok('decode decimal+hex+literal', H.decode('&#65;&#x42;C').text === 'ABC', H.decode('&#65;&#x42;C').text);
ok('decode named', H.decode('&copy; &amp;').text === '© &', H.decode('&copy; &amp;').text);
ok('decode apos', H.decode('&apos;').text === "'");
ok('decode nbsp', H.decode('&nbsp;').text === '\u00a0');
ok('decode emoji numeric', H.decode('&#128512;').text === '😀', H.decode('&#128512;').text);
ok('decode emoji hex', H.decode('&#x1F600;').text === '😀', H.decode('&#x1F600;').text);
ok('decode double-encoded once', H.decode('&amp;lt;').text === '&lt;', H.decode('&amp;lt;').text);
ok('decode longest match (notin)', H.decode('&notin;').text === '∉', H.decode('&notin;').text);
ok('decode "not" entity name collision safe', H.decode('&notin').text === '¬in', H.decode('&notin').text);
ok('decode legacy without semicolon', H.decode('Tom &amp Jerry').text === 'Tom & Jerry', H.decode('Tom &amp Jerry').text);
ok('decode unknown left verbatim', H.decode('&foobar;').text === '&foobar;', H.decode('&foobar;').text);
ok('decode reports unknown', H.decode('&foobar;').unknown.length === 1);
ok('legacy quirk matches browsers (&notreal; → ¬real;)', H.decode('&notreal;').text === '¬real;', H.decode('&notreal;').text);
ok('legacy quirk (&copycat → ©cat)', H.decode('&copycat').text === '©cat', H.decode('&copycat').text);
ok('decode bare ampersand safe', H.decode('fish & chips').text === 'fish & chips');
ok('decode numeric without semicolon', H.decode('&#65').text === 'A', H.decode('&#65').text);
ok('decode out of range → U+FFFD', H.decode('&#1114112;').text === '\uFFFD', JSON.stringify(H.decode('&#1114112;').text));
ok('decode surrogate → U+FFFD', H.decode('&#xD800;').text === '\uFFFD', JSON.stringify(H.decode('&#xD800;').text));
ok('decode null → U+FFFD', H.decode('&#0;').text === '\uFFFD');
ok('decode flags replacement', H.decode('&#0;').found[0].replaced === true);
ok('decode found list has names', H.decode('&copy;').found[0].name === 'copy');
ok('decode records codepoint', H.decode('&copy;').found[0].codepoint === 169);

/* round trips */
ok('round trip minimal', H.decode(H.encode("a<b>&\"'", 'minimal')).text === "a<b>&\"'");
ok('round trip named latin1', H.decode(H.encode('Àéîõüÿ©®™€—…', 'named')).text === 'Àéîõüÿ©®™€—…', JSON.stringify(H.decode(H.encode('Àéîõüÿ©®™€—…', 'named')).text));
ok('round trip dec cjk+emoji', H.decode(H.encode('中文😀测试', 'dec')).text === '中文😀测试', H.decode(H.encode('中文😀测试', 'dec')).text);
ok('round trip hex cjk+emoji', H.decode(H.encode('中文😀测试', 'hex')).text === '中文😀测试');
ok('round trip all', H.decode(H.encode('Hello 世界!', 'all')).text === 'Hello 世界!', H.decode(H.encode('Hello 世界!', 'all')).text);
ok('every named entity decodes to itself', (() => {
  let bad = null;
  Object.keys(H.ENTITY_MAP).forEach(name => {
    const cp = H.ENTITY_MAP[name];
    const r = H.decode('&' + name + ';');
    if (r.found.length !== 1 || r.found[0].codepoint !== cp) bad = name + ' → ' + JSON.stringify(r.found);
  });
  return bad === null ? true : bad;
})());
ok('every named entity round trips through encode(named)', (() => {
  let bad = null;
  Object.keys(H.ENTITY_MAP).forEach(name => {
    const ch = String.fromCodePoint(H.ENTITY_MAP[name]);
    const enc = H.encode(ch, 'named');
    if (enc !== '&' + name + ';' && H.decode(enc).text !== ch) bad = name + ' → ' + enc;
  });
  return bad === null ? true : bad;
})());
ok('XSS payload neutralised', H.encode('<script>alert("xss")</script>', 'minimal') === '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
ok('attribute escaping safe', !/[<>"']/.test(H.encode('"><img src=x onerror=alert(1)>', 'minimal')), H.encode('"><img src=x onerror=alert(1)>', 'minimal'));

ok('analyze rows', H.analyze('&copy;&#65;&#x1F600;').length === 3, JSON.stringify(H.analyze('&copy;&#65;&#x1F600;')));
ok('analyze codepoint labels', H.analyze('&copy;')[0].codepoint === 'U+00A9', H.analyze('&copy;')[0].codepoint);

/* a big nasty document survives a full round trip */
const nasty = 'Café — "quoted" & <tagged> \'single\' 中文 😀 ©®™ ≤ ≥ ∑ \u00a0 → \n\t done';
ok('nasty document round trip (minimal)', H.decode(H.encode(nasty, 'minimal')).text === nasty.replace(/&/g, '&').replace(/</g, '<'));
ok('nasty document round trip (all)', H.decode(H.encode(nasty, 'all')).text === nasty, JSON.stringify(H.decode(H.encode(nasty, 'all')).text.slice(0, 40)));

console.log('\n' + (fail === 0 ? '✓ ALL PASS' : '✗ FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
