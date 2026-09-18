/* DevToolBox — URL encoder / decoder engine + page wiring.
 * Pure client-side (URL / Intl only, no network). window.DTUrl (globalThis.DTUrl in Node).
 */
(function (root) {
  'use strict';

  var STRICT_EXTRA = "!'()*";

  function encode(text, mode) {
    if (text == null) text = '';
    switch (mode) {
      case 'uri': return encodeURI(text);
      case 'strict':
        return encodeURIComponent(text).replace(/[!'()*]/g, function (c) {
          return '%' + c.charCodeAt(0).toString(16).toUpperCase();
        });
      case 'form':
        return encodeURIComponent(text).replace(/%20/g, '+');
      case 'component':
      default:
        return encodeURIComponent(text);
    }
  }

  /* Decode a run of raw percent escapes; never throws. */
  function decodeRun(raw, formMode) {
    var src = formMode ? raw.replace(/\+/g, ' ') : raw;
    var out = '', issues = [], i = 0;
    while (i < src.length) {
      if (src.charAt(i) !== '%') { out += src.charAt(i); i++; continue; }
      var m = /^%([0-9A-Fa-f]{2})/.exec(src.slice(i));
      if (!m) {
        issues.push({ raw: src.substr(i, 3), reason: 'not a valid escape — % must be followed by two hex digits' });
        out += '%';
        i++;
        continue;
      }
      var j = i, bytes = '';
      while (j < src.length) {
        var mm = /^%([0-9A-Fa-f]{2})/.exec(src.slice(j));
        if (!mm) break;
        bytes += mm[1];
        j += 3;
      }
      var chunk = src.slice(i, j);
      try {
        out += decodeURIComponent(chunk);
      } catch (e) {
        // Not valid UTF-8: decode the parts that are, keep the rest escaped.
        var parts = [];
        for (var k = 0; k < bytes.length; k += 2) parts.push(bytes.substr(k, 2));
        var bad = '';
        for (var p = 0; p < parts.length; p++) {
          var b = parseInt(parts[p], 16);
          if (b < 0x80) { out += bad + String.fromCharCode(b); bad = ''; }
          else { bad += '%' + parts[p]; }
        }
        if (bad) {
          issues.push({ raw: bad, reason: 'not valid UTF-8 — these bytes do not form a complete character' });
          out += bad;
        }
      }
      i = j;
    }
    return { text: out, issues: issues };
  }

  function decode(text, mode) {
    if (text == null) text = '';
    if (mode === 'strict' || mode === 'component') {
      // strict: throw on malformed input, like decodeURIComponent does
      try { return { ok: true, text: mode === 'strict' ? decodeURIComponent(text) : decodeURIComponent(text), issues: [] }; }
      catch (e) { return { ok: false, text: text, issues: [{ raw: '', reason: String(e.message || 'malformed escape sequence') }] }; }
    }
    var r = decodeRun(text, mode === 'form');
    return { ok: true, text: r.text, issues: r.issues, lenient: true };
  }

  function looksDoubleEncoded(text) {
    // e.g. %2520, or %25 followed by two more hex digits
    return /%25[0-9A-Fa-f]{2}/.test(text);
  }

  function parse(input) {
    var text = String(input == null ? '' : input).trim();
    if (!text) return null;
    var out;
    try {
      var u = new URL(text);
      out = {
        absolute: true,
        protocol: u.protocol.replace(/:$/, ''),
        username: u.username,
        password: u.password,
        host: u.host,
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        origin: u.origin
      };
      // did an internationalised domain get punycoded?
      var rawHost = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(text);
      if (rawHost) {
        var hostRaw = rawHost[1].split('@').pop().split(':')[0];
        if (hostRaw && hostRaw.toLowerCase() !== u.hostname.toLowerCase() && /[^\x00-\x7F]/.test(decodeURIComponent(hostRaw.replace(/%/g, '%25')))) {
          out.punycodeFrom = hostRaw;
        }
      }
      return out;
    } catch (e) { /* fall through to relative parsing */ }

    var m = /^([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/.exec(text);
    return {
      absolute: false,
      protocol: '',
      username: '',
      password: '',
      host: '',
      hostname: '',
      port: '',
      pathname: m && m[1] ? m[1] : text,
      search: (m && m[2]) || '',
      hash: (m && m[3]) || '',
      origin: '',
      note: 'No scheme found — parsed as a relative URL / path.'
    };
  }

  function parseQuery(search, formMode) {
    var s = String(search == null ? '' : search).replace(/^[?]/, '');
    if (!s) return [];
    return s.split('&').filter(function (p) { return p !== ''; }).map(function (pair) {
      var eq = pair.indexOf('=');
      var rawKey = eq === -1 ? pair : pair.slice(0, eq);
      var rawVal = eq === -1 ? '' : pair.slice(eq + 1);
      return {
        raw: pair,
        key: decodeRun(rawKey, formMode !== false).text,
        value: decodeRun(rawVal, formMode !== false).text,
        keyRaw: rawKey,
        valueRaw: rawVal,
        hasEquals: eq !== -1
      };
    });
  }

  function buildQuery(pairs) {
    return pairs.map(function (p) {
      return encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value);
    }).join('&');
  }

  function utf8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xFFFF) i++;
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return bytes;
  }

  /* Which characters in this string are non-ASCII, and what would they become? */
  function analyzeChars(text) {
    var rows = [];
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c.charCodeAt(0) < 128) continue;
      var cp = text.codePointAt(i);
      var ch = String.fromCodePoint(cp);
      if (cp > 0xFFFF) i++;
      rows.push({
        char: ch,
        codepoint: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        bytes: utf8Bytes(ch).map(function (b) { return '%' + b.toString(16).toUpperCase().padStart(2, '0'); }).join(''),
        encoded: encodeURIComponent(ch)
      });
    }
    return rows;
  }

  /* Every percent escape already present in the text, expanded. */
  function analyzeEscapes(text) {
    var rows = [];
    var re = /(?:%[0-9A-Fa-f]{2})+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var chunk = m[0], decoded;
      try { decoded = decodeURIComponent(chunk); }
      catch (e) { decoded = null; }
      rows.push({
        raw: chunk,
        index: m.index,
        decoded: decoded,
        bytes: chunk.match(/%[0-9A-Fa-f]{2}/g).map(function (b) { return parseInt(b.slice(1), 16); }),
        valid: decoded !== null,
        codepoints: decoded ? Array.from(decoded).map(function (ch) {
          return 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
        }).join(' ') : ''
      });
    }
    return rows;
  }

  var api = {
    encode: encode,
    decode: decode,
    decodeRun: decodeRun,
    looksDoubleEncoded: looksDoubleEncoded,
    parse: parse,
    parseQuery: parseQuery,
    buildQuery: buildQuery,
    analyzeChars: analyzeChars,
    analyzeEscapes: analyzeEscapes,
    utf8Bytes: utf8Bytes
  };

  /* ───────────────────────── page wiring ───────────────────────── */

  function init() {
    var input = document.getElementById('url-in');
    if (!input) return;
    var output = document.getElementById('url-out');
    var status = document.getElementById('url-status');
    var modeSel = document.getElementById('url-mode');
    var toast = document.getElementById('dt-toast');
    var mode = 'component';

    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 1600);
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    function setStatus(html, cls) {
      if (!status) return;
      status.className = 'dt-status ' + (cls || '');
      status.innerHTML = html;
    }

    function paint(notes) {
      var text = input.value;
      var rows = parse(text);
      var qs = document.getElementById('url-parts');
      if (qs) {
        if (!rows) { qs.innerHTML = ''; }
        else {
          var pairs = [
            ['Scheme', rows.protocol + (rows.protocol ? ':' : '')],
            ['Host / authority', rows.host],
            ['Hostname', rows.hostname],
            ['Port', rows.port],
            ['Path', rows.pathname],
            ['Query string', rows.search],
            ['Fragment', rows.hash],
            ['Username', rows.username],
            ['Origin', rows.origin]
          ].filter(function (p) { return p[1] !== '' && p[1] != null; });
          qs.innerHTML = pairs.map(function (p) {
            return '<tr><th>' + p[0] + '</th><td>' + esc(p[1]) + '</td></tr>';
          }).join('') + (rows.punycodeFrom ? '<tr><th>IDN host</th><td>' + esc(rows.punycodeFrom) + ' → ' + esc(rows.hostname) + ' (punycode)</td></tr>' : '');
        }
      }
      var qbox = document.getElementById('url-query');
      if (qbox) {
        var params = rows ? parseQuery(rows.search, mode === 'form') : [];
        qbox.innerHTML = params.length
          ? '<table class="dt-kv"><tr><th>#</th><th>Parameter</th><th>Decoded value</th><th>Raw</th></tr>' + params.map(function (p, i) {
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(p.key) + '</td><td>' + esc(p.value) + (p.hasEquals ? '' : ' <span class="dt-note">(flag, no =)</span>') + '</td><td>' + esc(p.raw) + '</td></tr>';
          }).join('') + '</table>'
          : '<p class="dt-note" style="margin:0">No query parameters found in the input.</p>';
      }
      var escBox = document.getElementById('url-escapes');
      if (escBox) {
        var escs = analyzeEscapes(text);
        escBox.innerHTML = escs.length
          ? '<table class="dt-kv"><tr><th>Escape</th><th>Position</th><th>Decodes to</th><th>Code point</th></tr>' + escs.slice(0, 60).map(function (r) {
            return '<tr><td>' + esc(r.raw) + '</td><td>' + r.index + '</td><td>' + (r.valid ? esc(r.decoded) : '<span style="color:var(--red)">invalid UTF-8</span>') + '</td><td>' + esc(r.codepoints) + '</td></tr>';
          }).join('') + '</table>' + (escs.length > 60 ? '<p class="dt-note">Showing the first 60 of ' + escs.length + ' escapes.</p>' : '')
          : '<p class="dt-note" style="margin:0">No percent escapes in the input — run Encode to see them appear here.</p>';
      }
      var charsBox = document.getElementById('url-chars');
      if (charsBox) {
        var chars = analyzeChars(decode(text, mode === 'form').text);
        charsBox.innerHTML = chars.length
          ? '<table class="dt-kv"><tr><th>Character</th><th>Code point</th><th>UTF-8 bytes</th><th>Encoded</th></tr>' + chars.slice(0, 40).map(function (r) {
            return '<tr><td>' + esc(r.char) + '</td><td>' + r.codepoint + '</td><td>' + r.bytes + '</td><td>' + esc(r.encoded) + '</td></tr>';
          }).join('') + '</table>'
          : '<p class="dt-note" style="margin:0">All ASCII — nothing needs multi-byte encoding here.</p>';
      }
      if (notes && notes.length) {
        setStatus(notes.map(function (n) { return n; }).join('<br>'), 'err');
      }
    }

    function doEncode() {
      var text = input.value;
      output.value = encode(text, mode);
      var extra = [];
      if (!text) { setStatus('Type or paste something first.', ''); return; }
      if (mode === 'form') extra.push('Spaces became + (application/x-www-form-urlencoded). Use Component mode if you need %20.');
      if (mode === 'strict') extra.push('Strict RFC 3986 mode — ! \' ( ) * are escaped too, which JavaScript\'s encodeURIComponent leaves alone.');
      if (mode === 'uri') extra.push('Whole-URI mode — reserved characters like : / ? & = # are kept, everything else is escaped. Use it on a full URL, not on a single value.');
      setStatus('✓ Encoded ' + Array.from(text).length + ' characters → ' + output.value.length + ' characters.' + (extra.length ? '<br>' + extra.join('<br>') : ''), 'ok');
      paint(extra);
    }

    function doDecode() {
      var text = input.value;
      if (looksDoubleEncoded(text)) {
        // decode twice, report both
        var once = decode(text, mode === 'form' ? 'form' : 'lenient');
        var twice = decode(once.text, mode === 'form' ? 'form' : 'lenient');
        output.value = twice.text;
        setStatus('✓ Input looked double-encoded (%25…), so it was decoded twice.<br>After one pass: <code>' + esc(once.text) + '</code>', 'ok');
        paint(['Double encoding detected.']);
        return;
      }
      var r = decode(text, mode === 'form' ? 'form' : 'lenient');
      output.value = text.indexOf('%') === -1 && mode !== 'form'
        ? 'Nothing to decode — the input has no percent escapes.' : r.text;
      if (r.issues && r.issues.length) {
        setStatus('⚠ Decoded with ' + r.issues.length + ' problem' + (r.issues.length > 1 ? 's' : '') + ':<br>' +
          r.issues.slice(0, 6).map(function (i) { return '· <code>' + esc(i.raw) + '</code> ' + esc(i.reason); }).join('<br>'), 'err');
      } else {
        setStatus('✓ Decoded successfully. Escapes that were not valid UTF-8 are left untouched rather than replaced by a replacement character.', 'ok');
      }
      paint(null);
    }

    function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    on('url-encode', doEncode);
    on('url-decode', doDecode);
    on('url-swap', function () {
      var t = input.value; input.value = output.value; output.value = t;
      setStatus('↔ Swapped input and output.', '');
      paint(null);
    });
    on('url-clear', function () {
      input.value = ''; output.value = '';
      setStatus('Paste a URL, a query string or a value, then encode or decode it.', '');
      paint(null);
    });
    on('url-copy', function () {
      if (!output.value) { showToast('Nothing to copy yet'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output.value).then(function () { showToast('✓ Copied'); }, function () { showToast('Copy failed — select the text manually'); });
      } else { showToast('Copy unavailable'); }
    });
    on('url-sample', function () {
      input.value = 'https://example.com/search?q=caf\u00e9 &tea=\u4e2d\u6587&redirect=https%3A%2F%2Fexample.org%2Fa%20b#tab=2';
      doEncode();
    });

    if (modeSel) modeSel.addEventListener('change', function () { mode = modeSel.value; paint(null); });
    input.addEventListener('input', function () { if (input.value.trim()) paint(null); });

    setStatus('Paste a URL, a query string or a value, then encode or decode it.', '');
    paint(null);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  root.DTUrl = api;
})(typeof window !== 'undefined' ? window : globalThis);
