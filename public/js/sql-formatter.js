/* DevToolBox — SQL formatter / beautifier / minifier engine + page wiring.
 * Pure client-side. window.DTSql (globalThis.DTSql in Node for tests).
 *
 * The formatter is token based, not regex based: strings, quoted identifiers,
 * comments, dollar-quoted bodies and numbers are lexed first and never touched
 * again, so nothing inside a literal can be reformatted or uppercased.
 */
(function (root) {
  'use strict';

  /* ───────────────────────────── keywords ───────────────────────────── */

  var KEYWORDS = ('ABORT ABSOLUTE ACCESS ACTION ADD AFTER ALL ALTER ANALYZE AND ANY ARRAY AS ASC ASSERTION AT ' +
    'AUTHORIZATION AUTO_INCREMENT BEFORE BEGIN BETWEEN BIGINT BINARY BIT BOOLEAN BOTH BY CASCADE CASE CAST CHAR ' +
    'CHARACTER CHECK COLLATE COLLATION COLUMN COMMENT COMMIT CONCURRENTLY CONFLICT CONSTRAINT CONVERT CREATE CROSS ' +
    'CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATE DAY DEALLOCATE DEC ' +
    'DECIMAL DECLARE DEFAULT DEFERRABLE DEFERRED DELETE DESC DESCRIBE DETACH DISABLE DISTINCT DO DOMAIN DOUBLE ' +
    'DROP EACH ELSE ENABLE END ENGINE ESCAPE EXCEPT EXCLUDE EXCLUDING EXECUTE EXISTS EXPLAIN EXTENSION EXTRACT ' +
    'FALSE FETCH FILTER FIRST FLOAT FOLLOWING FOR FOREIGN FREEZE FROM FULL FUNCTION GRANT GROUP GROUPING HAVING ' +
    'IF ILIKE IMMEDIATE IN INCLUDE INCLUDING INDEX INHERITS INNER INOUT INSERT INT INTEGER INTERSECT INTERVAL ' +
    'INTO IS ISNULL JOIN KEY LANGUAGE LAST LATERAL LEADING LEFT LIKE LIMIT LOCAL LOCK LOGGED LONG LOOP ' +
    'MATERIALIZED MERGE MINUS MODE MONTH NATURAL NEXT NO NOCACHE NOCYCLE NOLOGGING NONE NOT NOTHING NOTNULL NULL ' +
    'NULLS NUMERIC OF OFF OFFSET ON ONLY OPEN OPTION OR ORDER OUT OUTER OVER OVERLAPS OWNER PARTIAL PARTITION ' +
    'PLACING POSITION PRECEDING PRECISION PREPARE PRESERVE PRIMARY PRIOR PRIVILEGES PROCEDURE PUBLICATION RANGE ' +
    'READ REAL RECURSIVE REFERENCES REFRESH REGEXP REINDEX RELEASE RENAME REPEATABLE REPLACE REPLICA RESET ' +
    'RESTRICT RETURNING RETURNS REVOKE RIGHT ROLLBACK ROLLUP ROW ROWS RULE SAVEPOINT SCHEMA SECOND SECURITY ' +
    'SELECT SEQUENCE SERIALIZABLE SESSION SET SETS SHARE SHOW SIMILAR SMALLINT SOME SQL STABLE START STATEMENT ' +
    'STORED STRICT SUBSTRING SYMMETRIC SYSTEM TABLE TABLES TABLESAMPLE TEMP TEMPORARY THEN TIES TIME TIMESTAMP ' +
    'TO TRAILING TRANSACTION TRIGGER TRIM TRUE TRUNCATE TYPE UNBOUNDED UNCOMMITTED UNION UNIQUE UNKNOWN UNLISTEN ' +
    'UNLOGGED UPDATE USER USING VACUUM VALID VALIDATE VALUE VALUES VARCHAR VARIADIC VARYING VERBOSE VIEW VOLATILE ' +
    'WHEN WHERE WINDOW WITH WITHIN WITHOUT WORK WRITE YEAR ZONE')
    .split(' ').reduce(function (acc, w) { acc[w] = 1; return acc; }, {});

  /* Multi-word units glued before formatting, longest first. */
  var MULTI = [
    'FULL OUTER JOIN', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN',
    'INSERT INTO', 'DELETE FROM', 'GROUP BY', 'ORDER BY', 'UNION ALL', 'UNION DISTINCT',
    'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'INNER JOIN', 'CROSS JOIN', 'NATURAL JOIN',
    'IS NOT DISTINCT FROM', 'IS DISTINCT FROM', 'IS NOT NULL', 'IS NULL', 'NOT NULL', 'NOT IN',
    'NOT LIKE', 'NOT ILIKE', 'NOT BETWEEN', 'PRIMARY KEY', 'FOREIGN KEY', 'ON CONFLICT',
    'ON DUPLICATE KEY UPDATE', 'PARTITION BY', 'WITH TIES', 'CREATE TABLE', 'CREATE INDEX',
    'CREATE VIEW', 'CREATE UNIQUE INDEX', 'ALTER TABLE', 'DROP TABLE', 'DROP INDEX', 'DROP VIEW',
    'IF NOT EXISTS', 'IF EXISTS', 'WITH RECURSIVE', 'FOR UPDATE', 'FOR SHARE', 'BEGIN TRANSACTION',
    'START TRANSACTION', 'CREATE OR REPLACE', 'CREATE TEMPORARY TABLE', 'CREATE SCHEMA', 'DROP SCHEMA',
    'SET TRANSACTION', 'NULLS FIRST', 'NULLS LAST', 'ORDER SIBLINGS BY'
  ];

  var CLAUSE = {
    'SELECT': 1, 'FROM': 1, 'WHERE': 1, 'GROUP BY': 1, 'HAVING': 1, 'ORDER BY': 1, 'LIMIT': 1,
    'OFFSET': 1, 'FETCH': 1, 'WINDOW': 1, 'RETURNING': 1, 'VALUES': 1, 'SET': 1, 'UPDATE': 1,
    'INSERT INTO': 1, 'DELETE FROM': 1, 'UNION': 1, 'UNION ALL': 1, 'UNION DISTINCT': 1,
    'INTERSECT': 1, 'EXCEPT': 1, 'MINUS': 1, 'WITH': 1, 'WITH RECURSIVE': 1, 'CREATE TABLE': 1,
    'CREATE TEMPORARY TABLE': 1, 'CREATE INDEX': 1, 'CREATE UNIQUE INDEX': 1, 'CREATE VIEW': 1,
    'CREATE OR REPLACE': 1, 'CREATE SCHEMA': 1, 'ALTER TABLE': 1, 'DROP TABLE': 1, 'DROP INDEX': 1,
    'DROP VIEW': 1, 'DROP SCHEMA': 1, 'START TRANSACTION': 1, 'BEGIN TRANSACTION': 1,
    'ON CONFLICT': 1, 'ON DUPLICATE KEY UPDATE': 1, 'RETURNING INTO': 1
  };

  var JOIN_LIKE = /(?:^|\s)JOIN$/;

  /* ───────────────────────────── tokenizer ───────────────────────────── */

  function tokenize(sql) {
    var src = String(sql == null ? '' : sql);
    var out = [], i = 0, n = src.length;

    var tokStart = 0;

    function push(type, value, extra) {
      var t = { t: type, v: value, start: tokStart };
      if (extra) for (var k in extra) t[k] = extra[k];
      out.push(t);
    }

    while (i < n) {
      var c = src[i];
      tokStart = i;

      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        var ws = '';
        while (i < n && /\s/.test(src[i])) ws += src[i++];
        push('ws', ws);
        continue;
      }

      // line comments: -- ... , # ... (MySQL)
      if ((c === '-' && src[i + 1] === '-') || c === '#') {
        var lineStart = i;
        while (i < n && src[i] !== '\n') i++;
        push('lineComment', src.slice(lineStart, i));
        continue;
      }
      // block comments /* ... */ (unterminated is reported by validate())
      if (c === '/' && src[i + 1] === '*') {
        var bs = i;
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i = i < n ? i + 2 : n;
        push('blockComment', src.slice(bs, i));
        continue;
      }
      // dollar-quoted string / function body: $tag$ ... $tag$
      if (c === '$') {
        var tagM = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
        if (tagM) {
          var tag = tagM[0], ds = i;
          var close = src.indexOf(tag, i + tag.length);
          if (close === -1) { i = n; push('string', src.slice(ds), { quote: 'dollar', unterminated: true }); continue; }
          i = close + tag.length;
          push('string', src.slice(ds, i), { quote: 'dollar' });
          continue;
        }
      }
      // quoted literals: '...' "..." `...` [ ... ]
      if (c === "'" || c === '"' || c === '`' || c === '[') {
        var closeCh = c === '[' ? ']' : c;
        var qs = i, unterminated = false;
        i++;
        while (i < n) {
          if (src[i] === '\\' && c === "'") { i += 2; continue; }          // MySQL escaped quote
          if (src[i] === closeCh) {
            if (src[i + 1] === closeCh) { i += 2; continue; }              // doubled quote = literal
            i++;
            break;
          }
          i++;
        }
        if (i > n) i = n;
        if (src[i - 1] !== closeCh) unterminated = true;
        push(c === "'" ? 'string' : 'ident', src.slice(qs, i), { quote: c === '[' ? '[' : c, unterminated: unterminated });
        continue;
      }
      // numbers
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var numM = /^(?:0x[0-9A-Fa-f]+|0b[01]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
        var nv = numM ? numM[0] : c;
        i += nv.length;
        push('number', nv);
        continue;
      }
      // identifiers / keywords / variables / parameters
      if (/[A-Za-z_\u0080-\uffff]/.test(c) || ((c === '@' || c === ':' || c === '$') && /[A-Za-z_@0-9]/.test(src[i + 1] || ''))) {
        var start = i;
        while (i < n && /[A-Za-z0-9_$\u0080-\uffff]/.test(src[i])) i++;
        // SQL Server style [already handled], @var, @@var, :param
        if (c === '@' || c === ':') { i = start + 1; while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++; }
        var word = src.slice(start, i);
        push('word', word);
        continue;
      }
      // multi-character operators
      var op3 = src.substr(i, 3);
      if (op3 === '<=>' || op3 === '||/' || op3 === '!~*') { i += 3; push('op', op3); continue; }
      var op2 = src.substr(i, 2);
      if (['<=', '>=', '<>', '!=', '||', '::', '->', '->>', '#>', '&&', '!~', '~*', ':='].indexOf(op2) !== -1) {
        i += 2; push('op', op2); continue;
      }
      push('punct', c);
      i++;
    }
    return out;
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  function significant(tokens) {
    return tokens.filter(function (t) { return t.t !== 'ws'; });
  }

  function upper(v) { return v.toUpperCase(); }

  /** Glue multi-word units (GROUP BY, LEFT JOIN, …) with their whitespace. */
  function glue(tokens) {
    var out = [], i = 0;
    while (i < tokens.length) {
      var t = tokens[i];
      if (t.t === 'word') {
        var matched = null;
        for (var m = 0; m < MULTI.length; m++) {
          var parts = MULTI[m].split(' ');
          var j = i, ok = true, consumed = 0;
          for (var p = 0; p < parts.length; p++) {
            while (j < tokens.length && (tokens[j].t === 'ws' || isCommentTok(tokens[j]))) j++;
            if (!tokens[j] || tokens[j].t !== 'word' || upper(tokens[j].v) !== parts[p]) { ok = false; break; }
            consumed = j - i + 1;
            j++;
          }
          if (ok) { matched = { parts: parts, end: i + consumed }; break; }
        }
        if (matched) {
          out.push({ t: 'word', v: matched.parts.join(' '), multi: true });
          i = matched.end;
          continue;
        }
      }
      out.push(t);
      i++;
    }
    return out;
  }

  function isCommentTok(t) { return t.t === 'lineComment' || t.t === 'blockComment'; }

  function isWordToken(t, w) { return !!t && t.t === 'word' && upper(t.v) === w; }

  /** Two passes: first decide which parens span multiple lines, then tag every
   *  token with its nesting depth so the formatter never has to guess. */
  function markParens(tokens) {
    var frames = [], unmatchedClose = 0, i, t;

    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (t.t === 'punct' && t.v === '(') {
        frames.push({ tok: t, subquery: isSubqueryAt(tokens, i), hasConj: false, multiline: false, hasComma: false });
      } else if (t.t === 'punct' && t.v === ')') {
        var frame = frames.pop();
        if (!frame) { unmatchedClose++; continue; }
        frame.tok.subquery = frame.subquery;
        frame.tok.multiline = !frame.subquery && frame.hasConj;
        if (frame.subquery || frame.tok.multiline) {
          var parent = frames[frames.length - 1];
          if (parent) parent.multiline = true;
        }
      } else if (t.t === 'word' && (upper(t.v) === 'AND' || upper(t.v) === 'OR')) {
        var top = frames[frames.length - 1];
        if (top) top.hasConj = true;
      } else if (t.t === 'punct' && t.v === ',') {
        var top2 = frames[frames.length - 1];
        if (top2) top2.hasComma = true;
      }
    }

    var depth = 0, subDepth = 0, multiDepth = 0, stack = [];
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (t.t === 'punct' && t.v === '(') {
        t.depth = depth;
        t.inSub = subDepth;
        t.inMulti = multiDepth;
        if (t.multiline && !t.subquery) multiDepth++;
        if (t.subquery) subDepth++;
        stack.push(t);
        depth++;
      } else if (t.t === 'punct' && t.v === ')') {
        var open = stack.pop();
        if (open) {
          if (open.multiline && !open.subquery) multiDepth = Math.max(0, multiDepth - 1);
          if (open.subquery) subDepth = Math.max(0, subDepth - 1);
          depth = Math.max(0, depth - 1);
          t.subquery = open.subquery;
          t.multiline = open.multiline;
        }
        t.depth = depth;
        t.inSub = subDepth;
        t.inMulti = multiDepth;
      } else {
        t.depth = depth;
        t.inSub = subDepth;
        t.inMulti = multiDepth;
      }
    }
    return { unmatchedOpen: depth, unmatchedClose: unmatchedClose, openStack: stack };
  }

  function isSubqueryAt(tokens, idx) {
    for (var j = idx + 1; j < tokens.length; j++) {
      var u = tokens[j];
      if (u.t === 'ws' || isCommentTok(u)) continue;
      var up = upper(u.v);
      return up === 'SELECT' || up === 'WITH' || up === 'INSERT INTO' || up === 'UPDATE' || up === 'DELETE FROM';
    }
    return false;
  }

  function normalizeWord(word, keywordCase, opts) {
    if (keywordCase === 'preserve') return word;
    var up = upper(word);
    if (KEYWORDS[up] || CLAUSE[up] || MULTI.indexOf(up) !== -1) {
      return keywordCase === 'lower' ? word.toLowerCase() : up;
    }
    if (opts && opts.uppercaseTypes && /^(int|integer|varchar|text|char|boolean|date|timestamp|numeric|decimal|serial|bigint|jsonb?|uuid|float|double)$/.test(word.toLowerCase())) {
      return word.toUpperCase();
    }
    return word;
  }

  /* ───────────────────────────── formatter ───────────────────────────── */

  var DEFAULT_OPTS = {
    keywordCase: 'upper',     // 'upper' | 'lower' | 'preserve'
    indent: 2,                // spaces per level, or 'tab'
    breakCommas: true,        // one column per line inside SELECT lists
    breakAndOr: true,         // AND / OR on their own line
    breakJoins: true,         // each JOIN on its own line
    keepComments: true,
    blankLinesBetweenStatements: true
  };

  function indentUnit(opts) {
    if (opts.indent === 'tab' || opts.indent === '\t') return '\t';
    var n = parseInt(opts.indent, 10);
    if (!n || n < 0) n = 2;
    if (n > 10) n = 10;
    return new Array(n + 1).join(' ');
  }

  function format(sql, options) {
    var opts = {};
    for (var k in DEFAULT_OPTS) opts[k] = DEFAULT_OPTS[k];
    for (var k2 in (options || {})) if (options[k2] !== undefined) opts[k2] = options[k2];

    var raw = tokenize(sql);
    var toks = glue(raw);
    var info = markParens(toks);
    var unit = indentUnit(opts);
    var lines = [];
    var line = '';
    var level = 0;
    var lineLevel = 0;
    var caseStack = [];
    var betweenPending = false;
    var statementCount = 0;
    var upperCased = 0;
    var last = null;   // previous significant token
    var parenLevels = [];
    var indentAtDepth = { 0: 0 };   // paren depth → indent level of the line that opened it

    function ind(l) { return new Array(Math.max(0, l) + 1).join(unit); }
    function lvl(t) { var v = indentAtDepth[t.depth || 0]; return v === undefined ? (t.depth || 0) : v; }
    function flush() {
      var t = line.replace(/[ \t]+$/, '');
      if (t !== '') lines.push(t);
      line = '';
    }
    function newline(l, keepBlank) {
      if (l < 0) l = 0;
      if (line.trim() !== '') flush();
      else if (keepBlank && lines.length && lines[lines.length - 1] !== '') lines.push('');
      level = l;
      lineLevel = l;
      line = ind(l);
    }
    function write(text, noSpaceBefore) {
      if (/^[ \t]*$/.test(line)) { line = ind(level) + text; return; }
      var needSpace = !noSpaceBefore && !/[ \t(.[]$/.test(line) && !/^[,;.)\]}]/.test(text);
      line += (needSpace ? ' ' : '') + text;
    }
    function writeRaw(text) { line += text; }

    function isClauseWord(t) { return t.t === 'word' && CLAUSE[upper(t.v)] === 1; }
    function isJoinWord(t) { return t.t === 'word' && JOIN_LIKE.test(' ' + upper(t.v)); }
    function isWord(t, w) { return t.t === 'word' && upper(t.v) === w; }
    function kw(v) { return normalizeWord(v, opts.keywordCase, opts); }
    function isKeywordWord(t) {
      if (!t || t.t !== 'word') return false;
      var up = upper(t.v);
      return !!(KEYWORDS[up] || CLAUSE[up] || MULTI.indexOf(up) !== -1);
    }

    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === 'ws') continue;
      var prevTok = last;
      if (!isCommentTok(t)) last = t;

      if (isCommentTok(t)) {
        if (!opts.keepComments) continue;
        if (t.t === 'lineComment') {
          if (line.trim() !== '') { write(t.v); flush(); line = ind(level); }
          else { newline(level); write(t.v); flush(); line = ind(level); }
        } else {
          var body = t.v.replace(/\s+/g, ' ');
          if (line.trim() !== '') write(body);
          else line = ind(level) + body;
        }
        continue;
      }

      /* clause keywords start a new line at their nesting level */
      if (isClauseWord(t)) {
        var v = t.multi ? t.v.split(' ').map(function (w) { return kw(w); }).join(' ') : kw(t.v);
        if (upper(v) !== upper(t.v)) upperCased++;
        var inlineClause = (t.depth || 0) > 0 && (t.inSub || 0) === 0 && (t.inMulti || 0) === 0;
        if (inlineClause) {
          write(v);            // FILTER (WHERE …), OVER (ORDER BY …) stay on one line
        } else {
          newline(lvl(t));
          writeRaw(v);
        }
        betweenPending = false;
        continue;
      }

      /* JOIN ... ON stays on one line with the join */
      if (isJoinWord(t)) {
        newline(lvl(t));
        if (upper(kw(t.v)) !== upper(t.v)) upperCased++;
        write(kw(t.v));
        continue;
      }
      if (isWord(t, 'ON')) { write(kw(t.v)); continue; }

      /* CASE / WHEN / THEN / ELSE / END */
      if (isWord(t, 'CASE')) {
        caseStack.push(lineLevel);
        write(kw(t.v));
        continue;
      }
      if (isWord(t, 'WHEN') || isWord(t, 'ELSE')) {
        var base = caseStack.length ? caseStack[caseStack.length - 1] : (t.depth || 0);
        newline(base + 1);
        write(kw(t.v));
        continue;
      }
      if (isWord(t, 'THEN')) { write(kw(t.v)); continue; }
      if (isWord(t, 'END')) {
        var openLevel = caseStack.length ? caseStack.pop() : (t.depth || 0);
        newline(openLevel);
        write(kw(t.v));
        continue;
      }
      if (isWord(t, 'BETWEEN')) {
        write(kw(t.v));
        betweenPending = true;
        continue;
      }

      /* AND / OR on their own line — except the AND that belongs to BETWEEN */
      if ((isWord(t, 'AND') || isWord(t, 'OR')) && opts.breakAndOr) {
        var wasBetween = betweenPending;
        betweenPending = false;
        if (!wasBetween) newline(lvl(t) + 1);
        write(kw(t.v));
        continue;
      }

      /* punctuation and operators */
      if (t.t === 'punct' && t.v === ',') {
        writeRaw(',');
        var breakHere = opts.breakCommas && ((t.depth || 0) === 0 || (t.inSub || 0) > 0 || (t.inMulti || 0) > 0);
        if (breakHere) newline(lvl(t) + 1);
        else writeRaw(' ');
        continue;
      }
      if (t.t === 'punct' && t.v === ';') {
        writeRaw(';');
        flush();
        statementCount++;
        level = 0; lineLevel = 0; caseStack = []; betweenPending = false;
        if (opts.blankLinesBetweenStatements) lines.push('');
        line = '';
        continue;
      }
      if (t.t === 'punct' && t.v === '(') {
        var spaced = isKeywordWord(prevTok);   // "EXISTS (" but "COUNT("
        parenLevels.push(lineLevel);
        indentAtDepth[(t.depth || 0) + 1] = lineLevel + (t.subquery ? 1 : 0);
        if (t.subquery) {
          if (spaced) write('('); else writeRaw('(');
          newline(lineLevel + 1);
        } else if (t.multiline) {
          if (spaced) write('('); else writeRaw('(');
        } else if (spaced) {
          write('(');
        } else {
          writeRaw('(');
        }
        continue;
      }
      if (t.t === 'punct' && t.v === ')') {
        var openLevel2 = parenLevels.length ? parenLevels.pop() : (t.depth || 0);
        if (t.subquery || t.multiline) {
          newline(openLevel2);
          writeRaw(')');
        } else {
          writeRaw(')');
        }
        continue;
      }
      if (t.t === 'punct' && (t.v === '.' || t.v === '::')) {
        writeRaw(t.v);
        continue;
      }
      if (t.t === 'op' || t.t === 'punct') {
        write(t.v);
        continue;
      }

      /* words, numbers, strings, identifiers */
      if (t.t === 'word') {
        var nv2 = kw(t.v);
        if (nv2 !== t.v) upperCased++;
        write(nv2);
        continue;
      }
      write(t.v);
    }
    if (line.trim() !== '') flush();

    // tidy: collapse repeated blank lines, drop leading blanks
    var tidy = [];
    lines.forEach(function (l) {
      if (l === '' && (tidy.length === 0 || tidy[tidy.length - 1] === '')) return;
      tidy.push(l.replace(/[ \t]+$/, ''));
    });
    while (tidy.length && tidy[tidy.length - 1] === '') tidy.pop();

    return {
      ok: true,
      output: tidy.join('\n'),
      statements: Math.max(1, statementCount || (tidy.length ? 1 : 0)),
      keywordsNormalised: upperCased,
      unmatchedParens: info.unmatchedOpen,
      tokens: significant(toks).length
    };
  }

  /* ───────────────────────────── minifier ───────────────────────────── */

  function minify(sql, options) {
    var opts = { keepComments: false, keywordCase: 'upper' };
    for (var k in (options || {})) opts[k] = options[k];
    var toks = glue(tokenize(sql));
    var out = '', prev = null;

    function isKeywordToken(t) {
      if (!t || t.t !== 'word') return false;
      var up = upper(t.v);
      return !!(KEYWORDS[up] || CLAUSE[up] || MULTI.indexOf(up) !== -1);
    }

    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t === 'ws') continue;
      if (isCommentTok(t)) {
        if (!opts.keepComments) continue;
        // a line comment swallows everything after it on the same line, so it must be
        // followed by a real newline — otherwise minifying changes the statement
        out += (out && !/\n$/.test(out) ? ' ' : '') + t.v.replace(/\s+/g, ' ') + (t.t === 'lineComment' ? '\n' : ' ');
        prev = t;
        continue;
      }
      var value = t.t === 'word' ? normalizeWord(t.v, opts.keywordCase, opts) : t.v;
      var noSpaceBefore = /^[,;.)\]]$/.test(value) || value === '.' || value === '::' ||
        (value === '(' && !isKeywordToken(prev) && !(prev && prev.v === ',')) ||
        (value === '[' && /[A-Za-z0-9_$\u0080-\uffff)\]]$/.test(out));   // arr[1], int[]
      // no space directly after a dot, a "::" or an opening paren — but a ")" is a
      // normal token boundary (") > 3" must keep its space)
      var prevChar = out.charAt(out.length - 1);
      var afterDotOrParen = prevChar === '.' || prevChar === '(';
      if (out !== '' && !noSpaceBefore && !afterDotOrParen) {
        var needsSpace = /[A-Za-z0-9_$\u0080-\uffff"'`)\]]$/.test(out) || /^[A-Za-z0-9_$@:'"`(\u0080-\uffff]/.test(value);
        if (needsSpace) out += ' ';
      }
      out += value;
      prev = t;
    }
    return { ok: true, output: out.trim(), tokens: significant(toks).length };
  }

  /* ───────────────────────────── validation ───────────────────────────── */

  function lineColOf(text, offset) {
    if (offset == null) return { line: null, column: null };
    var line = 1, column = 1;
    for (var i = 0; i < offset && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) { line++; column = 1; } else { column++; }
    }
    return { line: line, column: column };
  }

  function validate(sql) {
    var text = String(sql == null ? '' : sql);
    var issues = [];
    function add(severity, message, offset) {
      var lc = lineColOf(text, offset);
      issues.push({ severity: severity, message: message, position: offset == null ? null : offset, line: lc.line, column: lc.column });
    }
    var toks = tokenize(text);
    var info = markParens(toks);
    var depth = 0, maxDepth = 0, firstUnmatched = null;

    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.unterminated) {
        add('error', t.quote === 'dollar' ? 'Unterminated dollar-quoted string (' + String(t.v).slice(0, 12) + '…) — the closing tag is missing.'
          : 'Unterminated ' + (t.quote === '[' ? '[bracketed identifier]' : (t.quote === '"' ? 'double-quoted identifier' : 'string literal')) + ' — no closing ' + (t.quote === '[' ? ']' : t.quote) + ' found.', t.start);
      }
      if (t.t === 'punct' && t.v === '(') { depth++; maxDepth = Math.max(maxDepth, depth); }
      if (t.t === 'punct' && t.v === ')') { depth--; if (depth < 0) { add('error', 'Unbalanced parentheses — a ")" appears without a matching "(".', t.start); depth = 0; } }
      if (t.t === 'blockComment' && !/\*\/\s*$/.test(t.v)) {
        add('error', 'Unterminated block comment — /* is never closed with */.', t.start);
      }
      // trailing comma before FROM / ) / end
      if (t.t === 'punct' && t.v === ',' && !(t.flags && t.flags.trailing)) {
        for (var j = i + 1; j < toks.length; j++) {
          var u = toks[j];
          if (u.t === 'ws' || isCommentTok(u)) continue;
          if (u.t === 'punct' && (u.v === ')' || u.v === ';')) {
            add('error', 'Trailing comma before "' + u.v + '" — that is not valid in any SQL dialect.', t.start);
          } else if (isWordToken(u, 'FROM') || isWordToken(u, 'WHERE') || isWordToken(u, 'GROUP BY') || isWordToken(u, 'ORDER BY')) {
            add('error', 'Trailing comma before ' + upper(u.v) + ' — remove the comma before the next clause.', t.start);
          }
          break;
        }
      }
    }
    if (depth > 0) {
      add('error', depth + ' unclosed "(" — add the matching closing parenthesis.', info.openStack && info.openStack.length ? info.openStack[0].start : null);
      firstUnmatched = depth;
    }
    var statements = text.split(';').filter(function (s) { return s.trim() !== ''; }).length;
    return {
      ok: issues.length === 0,
      issues: issues,
      maxDepth: maxDepth,
      statements: statements,
      tokens: significant(toks).length,
      statementsText: upper(text).match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|EXPLAIN|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/g) || []
    };
  }

  /* ───────────────────────────── history ───────────────────────────── */

  var HISTORY_KEY = 'dt-sql-history';

  function historyLoad() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function historySave(sql, formatted) {
    var list = historyLoad();
    list.unshift({ sql: sql.slice(0, 20000), formatted: formatted.slice(0, 20000), at: Date.now() });
    var seen = {};
    list = list.filter(function (h) {
      var key = h.sql;
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    }).slice(0, 5);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* quota / disabled */ }
    return list;
  }
  function historyClear() { try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ } }

  var api = {
    tokenize: tokenize,
    glue: glue,
    markParens: markParens,
    format: format,
    minify: minify,
    validate: validate,
    KEYWORDS: KEYWORDS,
    MULTI: MULTI,
    CLAUSE: CLAUSE,
    historyLoad: historyLoad,
    historySave: historySave,
    historyClear: historyClear
  };

  /* ───────────────────────────── page wiring ───────────────────────────── */

  function init() {
    var input = document.getElementById('sql-in');
    if (!input) return;
    var output = document.getElementById('sql-out');
    var status = document.getElementById('sql-status');
    var kwSel = document.getElementById('sql-keyword-case');
    var indentSel = document.getElementById('sql-indent');
    var commaChk = document.getElementById('sql-break-commas');
    var andChk = document.getElementById('sql-break-and-or');
    var joinChk = document.getElementById('sql-break-joins');
    var toast = document.getElementById('dt-toast');
    var histBox = document.getElementById('sql-history');

    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 1600);
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function setStatus(html, cls) { if (!status) return; status.className = 'dt-status ' + (cls || ''); status.innerHTML = html; }

    function opts() {
      return {
        keywordCase: kwSel ? kwSel.value : 'upper',
        indent: indentSel ? indentSel.value : '2',
        breakCommas: commaChk ? commaChk.checked : true,
        breakAndOr: andChk ? andChk.checked : true,
        breakJoins: joinChk ? joinChk.checked : true
      };
    }

    function run(mode) {
      var text = input.value;
      if (!text.trim()) { setStatus('Paste a SQL query, then format it.', ''); output.value = ''; return; }
      var res = mode === 'minify' ? minify(text, opts()) : format(text, opts());
      output.value = res.output;
      var check = validate(text);
      var msg = '✓ ' + (mode === 'minify' ? 'Minified' : 'Formatted') + ' ' + check.statements + ' statement' + (check.statements === 1 ? '' : 's') + ' · ' + check.tokens + ' tokens';
      if (mode !== 'minify') msg += ' · ' + res.keywordsNormalised + ' keywords normalised';
      if (check.issues.length) {
        setStatus(msg + '<br>⚠ ' + check.issues.length + ' possible problem' + (check.issues.length > 1 ? 's' : '') + ':<br>' +
          check.issues.slice(0, 6).map(function (x) {
            return '· ' + (x.line ? '<b>line ' + x.line + '</b> — ' : '') + esc(x.message);
          }).join('<br>'), 'err');
      } else {
        setStatus(msg + '<br>Structure check: balanced parentheses, terminated strings and comments, no trailing commas.', 'ok');
      }
      if (mode !== 'minify') historySave(text, res.output);
      renderHistory();
    }

    function renderHistory() {
      if (!histBox) return;
      var list = historyLoad();
      if (!list.length) { histBox.innerHTML = '<p class="dt-note" style="margin:0">No queries formatted yet on this device.</p>'; return; }
      histBox.innerHTML = '<table class="dt-kv"><tr><th>When</th><th>Query</th><th></th></tr>' +
        list.map(function (h, i) {
          var when = new Date(h.at).toLocaleString();
          return '<tr><td>' + esc(when) + '</td><td>' + esc(h.sql.replace(/\s+/g, ' ').slice(0, 90)) + '…</td>' +
            '<td><button class="dt-btn" data-hist="' + i + '">load</button></td></tr>';
        }).join('') + '</table>';
      Array.prototype.forEach.call(histBox.querySelectorAll('button[data-hist]'), function (b) {
        b.addEventListener('click', function () {
          var h = historyLoad()[Number(b.getAttribute('data-hist'))];
          if (h) { input.value = h.sql; output.value = h.formatted; setStatus('Loaded a query from local history.', ''); }
        });
      });
    }

    function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    on('sql-format', function () { run('format'); });
    on('sql-minify', function () { run('minify'); });
    on('sql-swap', function () { var t = input.value; input.value = output.value; output.value = t; setStatus('↔ Swapped input and output.', ''); });
    on('sql-clear', function () { input.value = ''; output.value = ''; setStatus('Paste a SQL query, then format it.', ''); run('format'); });
    on('sql-copy', function () {
      if (!output.value) { showToast('Nothing to copy yet'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output.value).then(function () { showToast('✓ Copied'); }, function () { showToast('Copy failed — select the text manually'); });
      } else { showToast('Copy unavailable'); }
    });
    on('sql-history-clear', function () { historyClear(); renderHistory(); showToast('Local history cleared'); });
    on('sql-sample', function () {
      input.value = "select u.id, u.name, count(o.id) as orders, case when u.vip then 'gold' else 'standard' end as tier from users u left join orders o on o.user_id = u.id and o.status = 'paid' where u.created_at between '2026-01-01' and '2026-09-30' and (u.country = 'DE' or u.country = 'AT') and exists (select 1 from logins l where l.user_id = u.id) group by u.id, u.name, u.vip having count(o.id) > 3 order by orders desc limit 25;";
      run('format');
    });

    [kwSel, indentSel].forEach(function (el) { if (el) el.addEventListener('change', function () { run('format'); }); });
    [commaChk, andChk, joinChk].forEach(function (el) { if (el) el.addEventListener('change', function () { run('format'); }); });
    input.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); run('format'); }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        var s = input.selectionStart, e = input.selectionEnd;
        input.value = input.value.slice(0, s) + '  ' + input.value.slice(e);
        input.selectionStart = input.selectionEnd = s + 2;
      }
    });

    setStatus('Paste a SQL query, then format it.', '');
    renderHistory();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  root.DTSql = api;
})(typeof window !== 'undefined' ? window : globalThis);
