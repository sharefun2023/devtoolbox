#!/usr/bin/env node
/* Head-less tests for public/js/sql-formatter.js — run: node scripts/sql-tool-test.js
 * The strongest guarantee tested here: formatting never changes the token stream.
 * Whatever the formatter does with whitespace, the SQL it hands back must contain
 * exactly the same tokens (keywords re-cased, nothing added or lost).
 */
require('../public/js/sql-formatter.js');
const S = globalThis.DTSql;
if (!S) { console.error('DTSql not exposed'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* ── token-stream equality helper ── */
function sig(sql, opts) {
  return S.tokenize(sql)
    .filter(t => t.t !== 'ws')
    .filter(t => !(opts && opts.dropComments && (t.t === 'lineComment' || t.t === 'blockComment')))
    .map(t => t.t + ':' + (t.t === 'string' || t.t === 'ident' ? t.v : t.v.toUpperCase()))
    .join('|');
}

const QUERIES = [
  "select 1",
  "select u.id, u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id group by u.id, u.name having count(o.id) > 3 order by orders desc limit 25;",
  "insert into t (a,b) values (1,2),(3,4) returning id;",
  "update users set name = 'x', updated_at = now() where id in (select id from t where flag = 1) and active = true;",
  "delete from logs where created_at < '2026-01-01' and level <> 'info';",
  "WITH RECURSIVE cte AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM cte WHERE n < 10) SELECT n FROM cte;",
  "create table users (id serial primary key, email varchar(255) not null unique, created_at timestamp default now());",
  "select case when a > 1 then 'big' when a = 1 then 'one' else 'small' end as label from t;",
  "select sum(b) filter (where c > 1) as s, row_number() over (partition by a order by b desc) as rn from t;",
  "select * from a left outer join b on a.id = b.aid and b.kind = 'x' inner join c on c.id = a.cid;",
  // tricky literal contents that must survive byte for byte
  "select 'a, b) from x' as s, $$dollar, quoted)$$ as d, \"weird ) ident\" as i, `mysql, ident` as m, [tsql, ] ident] as t2 from t where x = 'it''s; ok';",
  "select 'multi\nline\nstring' as s from t;",
  "select a from t -- trailing comment\nwhere b = 1;",
  "select /* inline */ a from t;",
  "-- leading comment\nselect 1;",
  "select x from t where d between 1 and 10 and e between 20 and 30 and f = 1;",
  "select a from t where (x = 1 or y = 2) and (z = 3);",
  "select * from (select a, b from t1 where x = 1 union all select a, b from t2 where y = 2) u where u.a > 0;",
  "select 1; select 2; select 3;",
  "select null, true, false, 0x1F, 1.5e3, -42, .5, 1e-9 from t;",
  "select count(*) filter (where x) from t group by rollup(a, b) order by 1;",
  "with x as (select 1 as a), y as (select 2 as b) select * from x cross join y;",
  "select jsonb_build_object('a', 1)::text, arr[1], schema.table.column from schema.table;"
];

let invariantFails = [];
QUERIES.forEach((q, i) => {
  const before = sig(q);
  const f = S.format(q).output;
  const after = sig(f);
  if (before !== after) invariantFails.push('format #' + i + '\n      in : ' + before + '\n      out: ' + after + '\n      text:\n' + f);
  const m = S.minify(q, { keepComments: true }).output;
  const afterM = sig(m);
  if (before !== afterM) invariantFails.push('minify #' + i + '\n      in : ' + before + '\n      out: ' + afterM);
});
ok('token stream preserved through format+minify for ' + QUERIES.length + ' queries', invariantFails.length === 0, invariantFails.slice(0, 3).join('\n'));

/* strings and quoted identifiers must never be touched */
const lit = "select 'a, b) from x' as s, \"weird ) ident\" as i from t where x = 'it''s; ok';";
const litOut = S.format(lit).output;
ok('single-quoted literal preserved', litOut.includes("'a, b) from x'"), litOut);
ok('doubled quote escape preserved', litOut.includes("'it''s; ok'"), litOut);
ok('double-quoted identifier preserved', litOut.includes('"weird ) ident"'), litOut);
ok('keywords inside literals not uppercased', !/from X'/.test(S.format("select 'from x' as a").output), S.format("select 'from x' as a").output);
ok('comment text preserved', S.format('select 1 -- keep me').output.includes('-- keep me'));
ok('block comment preserved', S.format('select /* c */ 1').output.includes('/* c */'));

/* ── expected shapes ── */
const out1 = S.format("select u.id, u.name from users u left join orders o on o.user_id = u.id where u.x = 1 and u.y = 2 group by u.id, u.name order by u.id desc limit 10;").output;
ok('canonical layout', out1 === [
  'SELECT u.id,',
  '  u.name',
  'FROM users u',
  'LEFT JOIN orders o ON o.user_id = u.id',
  'WHERE u.x = 1',
  '  AND u.y = 2',
  'GROUP BY u.id,',
  '  u.name',
  'ORDER BY u.id DESC',
  'LIMIT 10;'
].join('\n'), JSON.stringify(out1));

const outCase = S.format("select case when a then 1 else 2 end as c from t;").output;
ok('CASE layout', outCase === ['SELECT CASE', '  WHEN a THEN 1', '  ELSE 2', 'END AS c', 'FROM t;'].join('\n'), JSON.stringify(outCase));

const outSub = S.format('select * from (select a from t where x = 1) s join q on q.a = s.a;').output;
ok('subquery indented', outSub === ['SELECT *', 'FROM (', '  SELECT a', '  FROM t', '  WHERE x = 1', ') s', 'JOIN q ON q.a = s.a;'].join('\n'), JSON.stringify(outSub));

const outBetween = S.format('select 1 from t where a between 1 and 10 and b = 2;').output;
ok('BETWEEN … AND … stays inline', outBetween.includes('WHERE a BETWEEN 1 AND 10'), JSON.stringify(outBetween));
ok('the conjunction after BETWEEN still breaks', /BETWEEN 1 AND 10\n  AND b = 2/.test(outBetween), JSON.stringify(outBetween));

ok('IN list stays inline', S.format('select a from t where x in (1,2,3);').output.includes('x IN (1, 2, 3)'), S.format('select a from t where x in (1,2,3);').output);
ok('column list stays inline', S.format('insert into t (a,b,c) values (1,2,3);').output.includes('INSERT INTO t(a, b, c)'), S.format('insert into t (a,b,c) values (1,2,3);').output);
ok('FILTER clause inline', S.format('select sum(b) filter (where c > 1) from t;').output.includes('FILTER (WHERE c > 1)'), S.format('select sum(b) filter (where c > 1) from t;').output);
ok('OVER clause inline', S.format('select row_number() over (partition by a order by b) from t;').output.includes('OVER (PARTITION BY a ORDER BY b)'), S.format('select row_number() over (partition by a order by b) from t;').output);

/* ── keyword casing options ── */
ok('upper default', S.format('select a from t').output.startsWith('SELECT a'));
ok('lower mode', S.format('SELECT a FROM t', { keywordCase: 'lower' }).output === 'select a\nfrom t', JSON.stringify(S.format('SELECT a FROM t', { keywordCase: 'lower' }).output));
ok('preserve mode', S.format('SeLeCt a FROM t', { keywordCase: 'preserve' }).output.split('\n')[0] === 'SeLeCt a');
ok('identifiers never re-cased', S.format('select MyCol from MyTable where OtherCol = 1').output.includes('MyCol') && S.format('select MyCol from MyTable where OtherCol = 1').output.includes('MyTable'));

/* ── indent options ── */
ok('indent 4', S.format('select a, b from t', { indent: 4 }).output === 'SELECT a,\n    b\nFROM t', JSON.stringify(S.format('select a, b from t', { indent: 4 }).output));
ok('tab indent', S.format('select a, b from t', { indent: 'tab' }).output === 'SELECT a,\n\tb\nFROM t', JSON.stringify(S.format('select a, b from t', { indent: 'tab' }).output));

/* ── break options ── */
ok('breakCommas off keeps one line', S.format('select a, b, c from t', { breakCommas: false }).output === 'SELECT a, b, c\nFROM t', JSON.stringify(S.format('select a, b, c from t', { breakCommas: false }).output));
ok('breakAndOr off', S.format('select 1 from t where a = 1 and b = 2', { breakAndOr: false }).output.includes('WHERE a = 1 AND b = 2'), S.format('select 1 from t where a = 1 and b = 2', { breakAndOr: false }).output);

/* ── minify ── */
ok('minify collapses whitespace', S.minify('select   a ,  b\nfrom   t where x = 1;').output === 'SELECT a, b FROM t WHERE x = 1;', S.minify('select   a ,  b\nfrom   t where x = 1;').output);
ok('minify keeps literals', S.minify("select 'a  b' from t").output === "SELECT 'a  b' FROM t", S.minify("select 'a  b' from t").output);
ok('minify drops comments by default', !S.minify('select 1 -- gone').output.includes('gone'));
ok('minify can keep comments', S.minify('select 1 -- kept', { keepComments: true }).output.includes('-- kept'));
ok('minify replaces a multi-part statement safely', S.minify('a.b, fn(x, y)').output === 'a.b, fn(x, y)', S.minify('a.b, fn(x, y)').output);

/* ── validation ── */
ok('valid query passes', S.validate('select 1 from t;').ok === true);
ok('empty input still parses as nothing', S.validate('').ok === true);
ok('unbalanced open paren', S.validate('select (1 from t').issues.some(i => /unclosed/.test(i.message)));
ok('unbalanced close paren', S.validate('select 1) from t').issues.some(i => /without a matching/.test(i.message)));
ok('unterminated string', S.validate("select 'abc from t").issues.some(i => /Unterminated string/.test(i.message)));
ok('unterminated block comment', S.validate('select 1 /* nope').issues.some(i => /Unterminated block comment/.test(i.message)));
ok('trailing comma before FROM', S.validate('select a, from t').issues.some(i => /Trailing comma before FROM/.test(i.message)));
ok('trailing comma before )', S.validate('select coalesce(a,) from t').issues.some(i => /Trailing comma before/.test(i.message)));
ok('statement counter', S.validate('select 1; select 2;').statements === 2);
ok('max depth reported', S.validate('select fn(fn(fn(x)))').maxDepth === 3);

/* ── robustness ── */
['', '   ', ';', ';;;', 'select', '((((', '))))', "'''", 'select 1;;;select 2', '\u0000', 'select \u00e9\u4e2d from t'].forEach((q, i) => {
  let threw = null;
  try { S.format(q); S.minify(q); S.validate(q); } catch (e) { threw = e.message; }
  ok('robustness case ' + i + ' (' + JSON.stringify(q).slice(0, 20) + ')', threw === null, threw);
});
ok('deep nesting does not crash', (() => {
  const deep = 'select ' + 'fn('.repeat(60) + '1' + ')'.repeat(60) + ';';
  try { S.format(deep); return true; } catch (e) { return false; }
})());

const bigQ = 'select a1, a2, a3, a4 from t1 join t2 on t1.id = t2.id where t1.x in (' +
  Array.from({ length: 500 }, (_, i) => i).join(',') + ') and t2.y > 3;';
const t0 = Date.now();
const bigOut = S.format(bigQ).output;
const dt = Date.now() - t0;
ok('500-item query formats fast', bigOut.length > 100 && dt < 2000, dt + 'ms');
ok('500-item query keeps all tokens', sig(bigQ) === sig(bigOut));

const huge = Array.from({ length: 300 }, (_, i) => "select col" + i + " from tbl" + i + " where id = " + i + ";").join('\n');
const t1 = Date.now();
const hugeOut = S.format(huge).output;
const dt2 = Date.now() - t1;
ok('300 statements format under 3s', dt2 < 3000, dt2 + 'ms');
ok('300 statements all preserved', sig(huge) === sig(hugeOut));

console.log('\n' + (fail === 0 ? '✓ ALL PASS' : '✗ FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
