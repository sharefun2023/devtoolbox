/* DevToolBox — JSON formatter / validator / beautifier engine + page wiring.
 * Zero dependencies, 100% client-side. Exposed as window.DTJson (and globalThis.DTJson
 * under Node so scripts/json-tool-test.js can exercise the engine head-less).
 *
 * The validator is a hand-written recursive-descent scanner rather than a bare
 * JSON.parse() wrapper: it reports the exact position of the first problem and a
 * plain-English explanation (trailing comma, single quotes, comments, unquoted key,
 * leading zero, smart quotes, ...) instead of V8's terse "Unexpected token" text.
 */
(function (root) {
  'use strict';

  var MAX_DEPTH = 512;

  /* ────────────────────────────── helpers ────────────────────────────── */

  function makeError(message, position, hint) {
    return { message: message, position: position, hint: hint || null };
  }

  function lineColAt(text, pos) {
    var line = 1, col = 1, i;
    if (pos == null) return { line: null, column: null };
    if (pos > text.length) pos = text.length;
    for (i = 0; i < pos; i++) {
      if (text.charCodeAt(i) === 10) { line++; col = 1; } else { col++; }
    }
    return { line: line, column: col };
  }

  function posFromLineCol(text, line, col) {
    var l = 1, c = 1, i;
    for (i = 0; i < text.length; i++) {
      if (l === line && c === col) return i;
      if (text.charCodeAt(i) === 10) { l++; c = 1; } else { c++; }
    }
    return text.length;
  }

  function lineTextAt(text, line) {
    if (!line) return null;
    var lines = text.split(/\r\n|\r|\n/);
    return lines[line - 1] == null ? null : lines[line - 1];
  }

  var SMART = {
    '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'",
    '\u00ab': '"', '\u00bb': '"', '\uff02': '"'
  };

  /* ────────────────────────────── scanner ────────────────────────────── */

  function scan(text) {
    var i = 0, n = text.length, warnings = [], objects = 0, arrays = 0;

    // strip a UTF-8 BOM if the user pasted one
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); n = text.length; }

    function fail(message, position, hint) { throw makeError(message, position, hint); }

    function ws() {
      while (i < n) {
        var c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        break;
      }
    }

    function describeChar(c) {
      var code = c.charCodeAt(0);
      if (code < 32) return 'control character U+' + code.toString(16).toUpperCase().padStart(4, '0');
      return "'" + c + "'";
    }

    function commentGuard() {
      if (text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
        fail('Comments are not allowed in JSON.', i,
          'Remove the comment — JSON has no comment syntax (JSONC / JSON5 files must be cleaned before parsing).');
      }
    }

    function parseString() {
      var start = i;           // points at the opening quote
      i++;                     // consume quote
      var out = '';
      while (true) {
        if (i >= n) fail('Unclosed string — the value starting at position ' + start + ' never ends.',
          start, 'Add the missing closing double quote.');
        var c = text[i];
        if (c === '"') { i++; return out; }
        if (c === '\\') {
          var esc = text[i + 1];
          if (esc === undefined) fail('Unclosed string — the escape sequence at the end of the input is incomplete.', i, 'Add the missing closing double quote.');
          if (esc === '"' || esc === '\\' || esc === '/') { out += esc; i += 2; continue; }
          if (esc === 'b') { out += '\b'; i += 2; continue; }
          if (esc === 'f') { out += '\f'; i += 2; continue; }
          if (esc === 'n') { out += '\n'; i += 2; continue; }
          if (esc === 'r') { out += '\r'; i += 2; continue; }
          if (esc === 't') { out += '\t'; i += 2; continue; }
          if (esc === 'u') {
            var hex = text.substr(i + 2, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              fail("Invalid Unicode escape \\u" + hex + " — \\u must be followed by exactly 4 hex digits.",
                i, 'Example: \\u00e9 for é.');
            }
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          if (esc === "'") fail("Invalid escape \\' — JSON strings are delimited by double quotes, so a single quote needs no escaping.", i, "Inside a JSON string write ' directly.");
          fail("Invalid escape sequence \\" + esc + '.', i, 'Valid escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX.');
        }
        if (c.charCodeAt(0) < 32) {
          fail('Unescaped ' + describeChar(c) + ' inside a string.', i,
            'Control characters must be escaped: \\n, \\t, \\r, or \\uXXXX. Raw line breaks inside strings are the usual cause.');
        }
        if (SMART[c] !== undefined) {
          fail('Curly / typographic quote ' + describeChar(c) + ' inside a string.', i,
            'Text pasted from Word, Google Docs or Notion turns straight quotes into curly ones. Replace with a plain " or rename the character.');
        }
        out += c;
        i++;
      }
    }

    function parseNumber() {
      var start = i;
      if (text[i] === '+') {
        fail("A number cannot start with '+'.", i, 'Write 42 instead of +42.');
      }
      if (text[i] === '-') i++;
      if (text.startsWith('0x', i) || text.startsWith('0X', i)) {
        fail('Hexadecimal numbers (0x…) are not valid JSON.', start, 'Convert the value to decimal, or send it as a string.');
      }
      if (text[i] === '0' && /[0-9]/.test(text[i + 1] || '')) {
        fail('Numbers cannot have leading zeros.', start, 'Write 7 instead of 007.');
      }
      var digits = 0;
      while (i < n && /[0-9]/.test(text[i])) { i++; digits++; }
      if (digits === 0) {
        fail('A number must contain at least one digit.', start, null);
      }
      if (text[i] === '.') {
        i++;
        var frac = 0;
        while (i < n && /[0-9]/.test(text[i])) { i++; frac++; }
        if (frac === 0) fail('A decimal point must be followed by at least one digit.', i - 1, 'Write 1.0 instead of 1.');
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        var exp = 0;
        while (i < n && /[0-9]/.test(text[i])) { i++; exp++; }
        if (exp === 0) fail('An exponent must be followed by at least one digit.', i - 1, 'Write 1e5 instead of 1e.');
      }
      if (/[A-Za-z_$]/.test(text[i] || '')) {
        fail("Invalid number — unexpected '" + text[i] + "' right after the digits.", i, 'Numbers cannot be followed directly by letters.');
      }
      return Number(text.slice(start, i));
    }

    function parseArray(depth) {
      arrays++;
      var start = i;
      i++; // [
      var out = [];
      ws();
      if (text[i] === ']') { i++; return out; }
      while (true) {
        out.push(parseValue(depth + 1));
        ws();
        if (i >= n) fail("Unclosed array — no ']' found for the '[' at position " + start + '.', start, 'Add the missing ].');
        var c = text[i];
        if (c === ',') {
          i++;
          ws();
          if (text[i] === ']') fail('Trailing comma before ] — JSON does not allow a comma after the last array element.', i, 'Delete the comma (or the empty element).');
          continue;
        }
        if (c === ']') { i++; return out; }
        if (c === '}' || c === ')') fail("Mismatched bracket: found '" + c + "' where ']' was expected.", i, "This array opened with '[' at position " + start + '.');
        fail("Expected ',' or ']' after the array element.", i, 'Most likely a missing comma between two elements.');
      }
    }

    function parseObject(depth) {
      objects++;
      var start = i;
      i++; // {
      var out = {}, seen = {};
      ws();
      if (text[i] === '}') { i++; return out; }
      while (true) {
        ws();
        commentGuard();
        if (i >= n) fail("Unclosed object — no '}' found for the '{' at position " + start + '.', start, 'Add the missing }.');
        if (text[i] !== '"') {
          var c = text[i];
          if (SMART[c] !== undefined) {
            fail('Curly / typographic quote ' + describeChar(c) + ' used as a property name — JSON only accepts straight double quotes.', i,
              'Text pasted from Word, Google Docs or Notion turns " into “ ”. Replace it with a plain "');
          }
          if (c === "'") fail('Object keys must use double quotes — single-quoted keys are not valid JSON.', i, 'Change \'key\' to "key".');
          if (/[A-Za-z_$0-9]/.test(c)) {
            var m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
            fail('Unquoted key "' + (m ? m[0] : c) + '" — JSON object keys must be wrapped in double quotes.', i, 'Change key: to "key":');
          }
          if (c === '}') fail('Trailing comma before } — JSON does not allow a comma after the last property.', i, 'Delete the comma (or the empty property).');
          fail("Expected a double-quoted property name but found " + describeChar(c) + '.', i, null);
        }
        var keyStart = i;
        var key = parseString();
        if (Object.prototype.hasOwnProperty.call(seen, key)) {
          warnings.push({ message: 'Duplicate key "' + key + '" (line ' + lineColAt(text, keyStart).line + ') — JSON parsers keep the last value.', position: keyStart });
        }
        seen[key] = true;
        ws();
        if (text[i] !== ':') {
          fail("Expected ':' after the property name \"" + key + '".', i, 'Every key must be followed by a colon.');
        }
        i++;
        out[key] = parseValue(depth + 1);
        ws();
        if (i >= n) fail("Unclosed object — no '}' found for the '{' at position " + start + '.', start, 'Add the missing }.');
        var c2 = text[i];
        if (c2 === ',') {
          i++;
          ws();
          if (text[i] === '}') fail('Trailing comma before } — JSON does not allow a comma after the last property.', i, 'Delete the comma (or the empty property).');
          continue;
        }
        if (c2 === '}') { i++; return out; }
        if (c2 === ']' || c2 === ')') fail("Mismatched bracket: found '" + c2 + "' where '}' was expected.", i, "This object opened with '{' at position " + start + '.');
        fail("Expected ',' or '}' after the property value.", i, 'Most likely a missing comma between two properties.');
      }
    }

    function parseValue(depth) {
      if (depth > MAX_DEPTH) fail('JSON nested more than ' + MAX_DEPTH + ' levels deep.', i, null);
      ws();
      if (i >= n) {
        fail('Unexpected end of input — a value was expected.', i, 'The JSON is truncated or a bracket is unclosed.');
      }
      var c = text[i];
      if (c === '{') return parseObject(depth);
      if (c === '[') return parseArray(depth);
      if (c === '"') return parseString();
      if (c === '+') fail("A number cannot start with '+'.", i, 'Write 42 instead of +42.');
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      commentGuard();
      if (text.startsWith('true', i) && !/[A-Za-z0-9_$]/.test(text[i + 4] || '')) { i += 4; return true; }
      if (text.startsWith('false', i) && !/[A-Za-z0-9_$]/.test(text[i + 5] || '')) { i += 5; return false; }
      if (text.startsWith('null', i) && !/[A-Za-z0-9_$]/.test(text[i + 4] || '')) { i += 4; return null; }
      if (text.startsWith('NaN', i)) fail('NaN is not a valid JSON value.', i, 'Use null instead of NaN (JSON has no NaN).');
      if (text.startsWith('Infinity', i)) fail('Infinity is not a valid JSON value.', i, 'Use a number or null.');
      if (text.startsWith('undefined', i)) fail('undefined is not a valid JSON value.', i, 'Use null instead of undefined.');
      if (c === "'") fail('Single-quoted strings are not valid JSON.', i, 'Change \'value\' to "value".');
      if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('Comments are not allowed in JSON.', i, 'Remove the comment (JSONC / JSON5 files must be cleaned before parsing).');
      if (SMART[c] !== undefined) fail('Curly / typographic quote ' + describeChar(c) + ' — JSON only accepts straight double quotes.', i, 'Replace it with ".');
      if (c === '(' || c === ')') fail("Unexpected '" + c + "' — JSON has no parentheses.", i, null);
      if (c === '=') fail("Unexpected '='.", i, null);
      fail('Unexpected character ' + describeChar(c) + ' — a JSON value was expected here.', i, null);
    }

    var value = parseValue(0);
    ws();
    if (i < n) {
      var trailing = text.slice(i).trim();
      if (trailing) {
        var c = text[i];
        if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
          fail('Comments are not allowed in JSON.', i,
            'Remove the comment — JSON has no comment syntax (JSONC / JSON5 files must be cleaned before parsing).');
        }
        if (c === '{' || c === '[' || c === '"' || /[0-9-]/.test(c) || /[A-Za-z]/.test(c)) {
          fail('Unexpected data after the end of the JSON document.', i,
            'JSON allows exactly one top-level value. Two objects/arrays in a row (NDJSON / JSON Lines) need one document per line — format them separately.');
        }
        fail('Unexpected ' + describeChar(c) + ' after the end of the JSON document.', i, null);
      }
    }
    return { data: value, warnings: warnings, objects: objects, arrays: arrays };
  }

  /* ────────────────────────────── public logic ────────────────────────────── */

  function validate(text) {
    if (text == null) text = '';
    if (typeof text !== 'string') text = String(text);
    if (text.trim() === '') {
      return { ok: false, empty: true, error: makeError('Nothing to validate — paste some JSON first.', null, null), warnings: [] };
    }
    try {
      var res = scan(text);
      return { ok: true, data: res.data, warnings: res.warnings, objects: res.objects, arrays: res.arrays };
    } catch (err) {
      if (err && err.message && err.position !== undefined) {
        var lc = lineColAt(text, err.position);
        return {
          ok: false,
          warnings: [],
          error: {
            message: err.message,
            hint: err.hint,
            position: err.position,
            line: lc.line,
            column: lc.column,
            lineText: lineTextAt(text, lc.line)
          }
        };
      }
      // Anything the scanner missed (stack overflow, engine oddity): fall back to JSON.parse.
      try {
        JSON.parse(text);
        return { ok: true, data: JSON.parse(text), warnings: [] };
      } catch (e2) {
        var msg = String((e2 && e2.message) || e2);
        var pm = /position\s+(\d+)/i.exec(msg);
        var lm = /line\s+(\d+)\s+column\s+(\d+)/i.exec(msg);
        var pos = pm ? parseInt(pm[1], 10) : (lm ? posFromLineCol(text, parseInt(lm[1], 10), parseInt(lm[2], 10)) : null);
        var lc2 = lineColAt(text, pos);
        return {
          ok: false,
          warnings: [],
          error: {
            message: msg.replace(/\s*at position \d+.*$/i, '').replace(/\s*\(line \d+ column \d+\)$/, ''),
            hint: null,
            position: pos,
            line: lc2.line,
            column: lc2.column,
            lineText: lineTextAt(text, lc2.line)
          }
        };
      }
    }
  }

  function sortDeep(v) {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).sort().forEach(function (k) { out[k] = sortDeep(v[k]); });
      return out;
    }
    return v;
  }

  function normalizeIndent(indent) {
    if (indent === 'tab' || indent === '\t') return '\t';
    var n = parseInt(indent, 10);
    if (!n || n < 0) n = 2;
    if (n > 8) n = 8;
    return n;
  }

  function format(text, opts) {
    opts = opts || {};
    var v = validate(text);
    if (!v.ok) return { ok: false, error: v.error };
    var data = opts.sort ? sortDeep(v.data) : v.data;
    var output;
    try {
      output = JSON.stringify(data, null, normalizeIndent(opts.indent));
    } catch (e) {
      return { ok: false, error: makeError('Unable to serialize this JSON: ' + (e && e.message ? e.message : e), null, null) };
    }
    return { ok: true, output: output, indent: normalizeIndent(opts.indent), warnings: v.warnings };
  }

  function minify(text, opts) {
    opts = opts || {};
    var v = validate(text);
    if (!v.ok) return { ok: false, error: v.error };
    var data = opts.sort ? sortDeep(v.data) : v.data;
    return { ok: true, output: JSON.stringify(data), warnings: v.warnings };
  }

  function stats(data) {
    var s = { bytes: 0, lines: 0, keys: 0, objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, depth: 0 };
    function walk(v, d) {
      if (d > s.depth) s.depth = d;
      if (v === null) { s.nulls++; return; }
      if (Array.isArray(v)) {
        s.arrays++;
        v.forEach(function (x) { walk(x, d + 1); });
        return;
      }
      if (typeof v === 'object') {
        s.objects++;
        Object.keys(v).forEach(function (k) { s.keys++; walk(v[k], d + 1); });
        return;
      }
      if (typeof v === 'string') s.strings++;
      else if (typeof v === 'number') s.numbers++;
      else if (typeof v === 'boolean') s.booleans++;
    }
    walk(data, 1);
    return s;
  }

  function byteLength(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return unescape(encodeURIComponent(str)).length;
  }

  function flatten(v, path, out) {
    out = out || new Map();
    if (Array.isArray(v)) {
      if (v.length === 0) out.set(path || '$', '[]');
      v.forEach(function (x, idx) { flatten(x, path + '[' + idx + ']', out); });
      return out;
    }
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      if (keys.length === 0) out.set(path || '$', '{}');
      keys.forEach(function (k) { flatten(v[k], path ? path + '.' + k : k, out); });
      return out;
    }
    out.set(path || '$', JSON.stringify(v));
    return out;
  }

  function diff(a, b) {
    var fa = flatten(a), fb = flatten(b), rows = [];
    fa.forEach(function (v, p) {
      if (!fb.has(p)) rows.push({ type: 'removed', path: p, from: v, to: null });
      else if (fb.get(p) !== v) rows.push({ type: 'changed', path: p, from: v, to: fb.get(p) });
    });
    fb.forEach(function (v, p) {
      if (!fa.has(p)) rows.push({ type: 'added', path: p, from: null, to: v });
    });
    rows.sort(function (x, y) { return x.path < y.path ? -1 : x.path > y.path ? 1 : 0; });
    return rows;
  }

  function loadSample() {
    return '{"users":[{"id":1,"name":"Alice","email":"alice@example.com","roles":["admin",' +
      '"editor"],"metadata":{"lastLogin":"2026-06-15T10:30:00Z","loginCount":42}},{"id":2,' +
      '"name":"Bob","email":"bob@example.com","roles":["viewer"],"active":true}],' +
      '"pagination":{"page":1,"perPage":20,"total":2,"hasMore":null}}';
  }

  var api = {
    validate: validate,
    format: format,
    minify: minify,
    sortDeep: sortDeep,
    stats: stats,
    byteLength: byteLength,
    diff: diff,
    lineColAt: lineColAt,
    loadSample: loadSample
  };

  /* ────────────────────────────── UI wiring ────────────────────────────── */

  function init() {
    var input = document.getElementById('jf-in');
    if (!input) return;
    var output = document.getElementById('jf-out');
    var status = document.getElementById('jf-status');
    var indentSel = document.getElementById('jf-indent');
    var treeBox = document.getElementById('jf-tree');
    var statsBox = document.getElementById('jf-stats');
    var sortBtn = document.getElementById('jf-sort');
    var treeBtn = document.getElementById('jf-tree-btn');
    var toast = document.getElementById('dt-toast');
    var sortOn = false, treeOn = false, lastData = null, lastOk = false;

    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 1600);
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function renderStatus(res) {
      if (!status) return;
      status.className = 'dt-status';
      if (res.empty) { status.textContent = 'Paste JSON above, then hit Format, Validate or Minify. Everything runs in your browser.'; return; }
      if (res.ok) {
        status.classList.add('ok');
        var warns = (res.warnings || []).length;
        status.innerHTML = '✓ Valid JSON' + (warns ? ' — <b>' + warns + ' warning' + (warns > 1 ? 's' : '') + '</b>' : '') +
          (warns ? ':<br>' + res.warnings.map(function (w) { return '· ' + esc(w.message); }).join('<br>') : '');
        return;
      }
      var e = res.error;
      status.classList.add('err');
      var html = '<b>✗ ' + esc(e.message) + '</b>';
      if (e.line != null) {
        html += '<br>Line <b>' + e.line + '</b>, column <b>' + e.column + '</b> (character ' + e.position + ')';
        if (e.lineText != null) {
          var caret = new Array(Math.max(0, e.column - 1) + 1).join(' ') + '^';
          html += '<br><code style="white-space:pre;color:var(--text)">' + esc(e.lineText.slice(0, 400)) + '</code>' +
            '<br><code style="white-space:pre;color:var(--red)">' + esc(caret) + '</code>';
        }
      }
      if (e.hint) html += '<br>💡 ' + esc(e.hint);
      status.innerHTML = html;
    }

    function renderStats(data, text) {
      if (!statsBox) return;
      var st = stats(data);
      var pairs = [
        ['bytes', byteLength(text)],
        ['lines', text.split(/\r\n|\r|\n/).length],
        ['keys', st.keys],
        ['depth', st.depth],
        ['objects', st.objects],
        ['arrays', st.arrays]
      ];
      statsBox.innerHTML = pairs.map(function (p) {
        return '<span class="dt-chip">' + p[0] + ' <b>' + p[1] + '</b></span>';
      }).join('');
    }

    function renderTree(data) {
      if (!treeBox) return;
      treeBox.innerHTML = '';
      treeBox.appendChild(node(data, null));
      function node(v, key) {
        var li = document.createElement('li');
        var isObj = v && typeof v === 'object';
        var label = document.createElement('span');
        if (isObj) {
          var collapsed = false;
          var caret = document.createElement('span');
          caret.className = 'caret';
          caret.textContent = '▾';
          label.appendChild(caret);
          var k = document.createElement('span');
          k.className = 'k';
          k.textContent = key == null ? (Array.isArray(v) ? 'root' : 'root') : key;
          label.appendChild(k);
          var cnt = document.createElement('span');
          cnt.className = 'cnt';
          cnt.textContent = Array.isArray(v) ? '[ ' + v.length + ' items ]' : '{ ' + Object.keys(v).length + ' keys }';
          label.appendChild(cnt);
          li.appendChild(label);
          var ul = document.createElement('ul');
          var keys = Array.isArray(v) ? v.map(function (_, idx) { return idx; }) : Object.keys(v);
          keys.forEach(function (kk) { ul.appendChild(node(v[kk], String(kk))); });
          li.appendChild(ul);
          var toggle = function (ev) {
            ev.stopPropagation();
            collapsed = !collapsed;
            li.classList.toggle('collapsed', collapsed);
            caret.textContent = collapsed ? '▸' : '▾';
          };
          caret.addEventListener('click', toggle);
          k.addEventListener('click', toggle);
        } else {
          var key2 = document.createElement('span');
          key2.className = 'k';
          key2.textContent = (key == null ? 'root' : key) + ': ';
          label.appendChild(key2);
          var val = document.createElement('span');
          val.className = 'v-' + (v === null ? 'null' : typeof v === 'string' ? 'str' : typeof v === 'number' ? 'num' : 'bool');
          val.textContent = JSON.stringify(v);
          label.appendChild(val);
          li.appendChild(label);
        }
        return li;
      }
      var ul = document.createElement('ul');
      ul.appendChild(treeBox.firstChild);
      treeBox.appendChild(ul);
    }

    function run(kind) {
      var text = input.value;
      var res = kind === 'minify' ? minify(text, { sort: sortOn }) : format(text, { indent: indentSel ? indentSel.value : 2, sort: sortOn });
      renderStatus(res.ok ? { ok: true, warnings: res.warnings } : (res.error && res.error.message === 'Nothing to validate — paste some JSON first.' ? { empty: true } : res));
      lastOk = !!res.ok;
      if (res.ok) {
        output.value = res.output;
        var v = validate(text);
        lastData = v.data;
        renderStats(v.data, text);
        if (treeOn) renderTree(v.data);
      } else {
        output.value = '';
        if (statsBox) statsBox.innerHTML = '';
        if (treeBox) treeBox.innerHTML = '';
        lastData = null;
        // highlight the offending character in the editor
        if (res.error && res.error.position != null && document.activeElement !== input) {
          try { input.focus(); input.setSelectionRange(res.error.position, res.error.position + 1); } catch (e) { /* ignore */ }
        }
      }
      return lastOk;
    }

    function on(id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    }

    on('jf-format', function () { run('format'); });
    on('jf-minify', function () { run('minify'); });
    on('jf-validate', function () { run('validate'); });
    on('jf-sample', function () { input.value = loadSample(); run('format'); });
    on('jf-clear', function () {
      input.value = ''; output.value = ''; lastData = null; lastOk = false;
      if (statsBox) statsBox.innerHTML = '';
      if (treeBox) { treeBox.innerHTML = ''; treeBox.classList.remove('show'); }
      treeOn = false;
      if (treeBtn) treeBtn.classList.remove('on');
      renderStatus({ empty: true });
    });
    on('jf-copy', function () {
      var val = output.value || input.value;
      copyText(val, function (ok) { showToast(ok ? '✓ Copied to clipboard' : 'Copy failed — select the text manually'); });
    });
    on('jf-download', function () {
      var blob = new Blob([output.value || input.value], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'formatted.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('✓ Downloaded formatted.json');
    });

    if (sortBtn) sortBtn.addEventListener('click', function () {
      sortOn = !sortOn;
      sortBtn.classList.toggle('on', sortOn);
      if (input.value.trim()) run('format');
    });
    if (treeBtn) treeBtn.addEventListener('click', function () {
      treeOn = !treeOn;
      treeBtn.classList.toggle('on', treeOn);
      if (treeBox) treeBox.classList.toggle('show', treeOn);
      if (treeOn) {
        if (!lastOk && input.value.trim()) run('format');
        if (!lastData) { renderStatus({ empty: true }); return; }
        renderTree(lastData);
      }
    });
    if (indentSel) indentSel.addEventListener('change', function () { if (input.value.trim()) run('format'); });
    input.addEventListener('input', function () {
      if (!input.value.trim()) { renderStatus({ empty: true }); if (statsBox) statsBox.innerHTML = ''; return; }
      if (lastOk) run('format');
    });
    input.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); run('format'); }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        var s = input.selectionStart, e = input.selectionEnd;
        input.value = input.value.slice(0, s) + '  ' + input.value.slice(e);
        input.selectionStart = input.selectionEnd = s + 2;
      }
    });

    /* diff panel */
    var a = document.getElementById('jf-diff-a');
    var b = document.getElementById('jf-diff-b');
    var dout = document.getElementById('jf-diff-out');
    on('jf-diff-run', function () {
      if (!a || !b || !dout) return;
      var ra = validate(a.value), rb = validate(b.value);
      if (!ra.ok) { dout.innerHTML = '<span class="ln rem">Left side is not valid JSON: ' + esc(ra.error.message) + '</span>'; return; }
      if (!rb.ok) { dout.innerHTML = '<span class="ln rem">Right side is not valid JSON: ' + esc(rb.error.message) + '</span>'; return; }
      var rows = diff(ra.data, rb.data);
      if (!rows.length) { dout.innerHTML = '<span class="ln add">✓ The two documents are identical.</span>'; return; }
      dout.innerHTML = rows.map(function (r) {
        var cls = r.type === 'added' ? 'add' : r.type === 'removed' ? 'rem' : 'chg';
        var sign = r.type === 'added' ? '+ ' : r.type === 'removed' ? '- ' : '~ ';
        var detail = r.type === 'changed' ? r.from + ' → ' + r.to : (r.to != null ? r.to : r.from);
        return '<span class="ln ' + cls + '">' + sign + '<span class="path">' + esc(r.path) + '</span>  ' + esc(detail) + '</span>';
      }).join('');
    });

    function copyText(text, cb) {
      if (!text) { cb(false); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { cb(true); }, function () { cb(fallback()); });
      } else {
        cb(fallback());
      }
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        } catch (e) { return false; }
      }
    }

    renderStatus({ empty: true });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  root.DTJson = api;
})(typeof window !== 'undefined' ? window : globalThis);
