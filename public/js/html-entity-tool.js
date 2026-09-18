/* DevToolBox — HTML entity encoder / decoder engine + page wiring.
 * Pure client-side. window.DTHtml (globalThis.DTHtml in Node for tests).
 *
 * Named entities cover the HTML 4.01 set plus the common HTML5 additions;
 * anything outside that set is written as a numeric entity, which every browser
 * understands, instead of guessing at a name that may not exist.
 */
(function (root) {
  'use strict';

  var NAMED = ('quot=34 amp=38 apos=39 lt=60 gt=62 nbsp=160 iexcl=161 cent=162 pound=163 curren=164 yen=165 ' +
    'brvbar=166 sect=167 uml=168 copy=169 ordf=170 laquo=171 not=172 shy=173 reg=174 macr=175 deg=176 ' +
    'plusmn=177 sup2=178 sup3=179 acute=180 micro=181 para=182 middot=183 cedil=184 sup1=185 ordm=186 ' +
    'raquo=187 frac14=188 frac12=189 frac34=190 iquest=191 Agrave=192 Aacute=193 Acirc=194 Atilde=195 ' +
    'Auml=196 Aring=197 AElig=198 Ccedil=199 Egrave=200 Eacute=201 Ecirc=202 Euml=203 Igrave=204 Iacute=205 ' +
    'Icirc=206 Iuml=207 ETH=208 Ntilde=209 Ograve=210 Oacute=211 Ocirc=212 Otilde=213 Ouml=214 times=215 ' +
    'Oslash=216 Ugrave=217 Uacute=218 Ucirc=219 Uuml=220 Yacute=221 THORN=222 szlig=223 agrave=224 aacute=225 ' +
    'acirc=226 atilde=227 auml=228 aring=229 aelig=230 ccedil=231 egrave=232 eacute=233 ecirc=234 euml=235 ' +
    'igrave=236 iacute=237 icirc=238 iuml=239 eth=240 ntilde=241 ograve=242 oacute=243 ocirc=244 otilde=245 ' +
    'ouml=246 divide=247 oslash=248 ugrave=249 uacute=250 ucirc=251 uuml=252 yacute=253 thorn=254 yuml=255 ' +
    'OElig=338 oelig=339 Scaron=352 scaron=353 Yuml=376 fnof=402 circ=710 tilde=732 ' +
    'Alpha=913 Beta=914 Gamma=915 Delta=916 Epsilon=917 Zeta=918 Eta=919 Theta=920 Iota=921 Kappa=922 ' +
    'Lambda=923 Mu=924 Nu=925 Xi=926 Omicron=927 Pi=928 Rho=929 Sigma=931 Tau=932 Upsilon=933 Phi=934 ' +
    'Chi=935 Psi=936 Omega=937 alpha=945 beta=946 gamma=947 delta=948 epsilon=949 zeta=950 eta=951 ' +
    'theta=952 iota=953 kappa=954 lambda=955 mu=956 nu=957 xi=958 omicron=959 pi=960 rho=961 sigmaf=962 ' +
    'sigma=963 tau=964 upsilon=965 phi=966 chi=967 psi=968 omega=969 thetasym=977 upsih=978 piv=982 ' +
    'ensp=8194 emsp=8195 thinsp=8201 zwnj=8204 zwj=8205 lrm=8206 rlm=8207 ndash=8211 mdash=8212 ' +
    'lsquo=8216 rsquo=8217 sbquo=8218 ldquo=8220 rdquo=8221 bdquo=8222 dagger=8224 Dagger=8225 bull=8226 ' +
    'hellip=8230 permil=8240 prime=8242 Prime=8243 lsaquo=8249 rsaquo=8250 oline=8254 frasl=8260 euro=8364 ' +
    'trade=8482 larr=8592 uarr=8593 rarr=8594 darr=8595 harr=8596 crarr=8629 lArr=8656 uArr=8657 rArr=8658 ' +
    'dArr=8659 hArr=8660 forall=8704 part=8706 exist=8707 empty=8709 nabla=8711 isin=8712 notin=8713 ' +
    'ni=8715 prod=8719 sum=8721 minus=8722 lowast=8727 radic=8730 prop=8733 infin=8734 ang=8736 and=8743 ' +
    'or=8744 cap=8745 cup=8746 int=8747 there4=8756 sim=8764 cong=8773 asymp=8776 ne=8800 equiv=8801 ' +
    'le=8804 ge=8805 sub=8834 sup=8835 nsub=8836 sube=8838 supe=8839 oplus=8853 otimes=8855 perp=8869 ' +
    'sdot=8901 lceil=8968 rceil=8969 lfloor=8970 rfloor=8971 lang=9001 rang=9002 loz=9674 spades=9824 ' +
    'clubs=9827 hearts=9829 diams=9830');

  var ENTITY = {};       // name → codepoint
  var BY_CODEPOINT = {}; // codepoint → name (first name wins)
  NAMED.split(/\s+/).forEach(function (pair) {
    var kv = pair.split('=');
    var name = kv[0], cp = Number(kv[1]);
    if (!name || !cp) return;
    ENTITY[name] = cp;
    if (BY_CODEPOINT[cp] === undefined) BY_CODEPOINT[cp] = name;
  });

  /* Legacy entities that browsers also accept without the trailing semicolon
   * (the HTML 4.01 core set — this is why "&amp" and "&copy" work but "&notin"
   * parses as "¬in" instead: `not` is legacy, `notin` is not). */
  var NO_SEMI = ('AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT ' +
    'Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc ' +
    'Ugrave Uuml Yacute aacute acirc acute aelig agrave amp and ang aring atilde auml brvbar cap ccedil cedil ' +
    'cent copy curren cup deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl ' +
    'igrave int iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve or ordf ordm oslash ' +
    'otilde ouml para plusmn pound quot raquo reg sect shy sim sup1 sup2 sup3 szlig thorn times uacute ucirc ' +
    'ugrave uml uuml yacute yen yuml')
    .split(/\s+/).reduce(function (acc, n) { acc[n] = 1; return acc; }, {});

  var CORE = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' };

  function cpToEntityText(cp, style) {
    if (style === 'hex') return '&#x' + cp.toString(16).toUpperCase() + ';';
    return '&#' + cp + ';';
  }

  /**
   * encode(text, mode)
   *  mode 'minimal' — only & < > " ' (safe for HTML text and attributes)
   *  mode 'named'   — the minimal set plus named entities for every known character
   *  mode 'dec'     — the minimal set plus decimal numeric entities for non-ASCII
   *  mode 'hex'     — same as 'dec' but hexadecimal
   *  mode 'all'     — every single character as a numeric entity
   */
  function encode(text, mode, opts) {
    if (text == null) text = '';
    text = String(text);
    mode = mode || 'minimal';
    opts = opts || {};
    var numericStyle = mode === 'hex' ? 'hex' : 'dec';
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var cp = text.codePointAt(i);
      if (cp > 0xFFFF) { ch = String.fromCodePoint(cp); }
      var extra = ch.length > 1 ? 1 : 0;

      if (CORE[ch] !== undefined && mode !== 'all') {
        out += (ch === "'" && opts.aposNamed) ? '&apos;' : '&' + CORE[ch] + ';';
      } else if (mode === 'all') {
        out += cpToEntityText(cp, numericStyle);
      } else if (mode === 'named') {
        out += BY_CODEPOINT[cp] !== undefined ? '&' + BY_CODEPOINT[cp] + ';' : (cp < 128 ? ch : cpToEntityText(cp, 'dec'));
      } else if (mode === 'dec' || mode === 'hex') {
        out += cp < 128 ? ch : cpToEntityText(cp, numericStyle);
      } else {
        out += ch;
      }
      i += extra;
    }
    return out;
  }

  function fromCodePointSafe(cp) {
    if (!isFinite(cp) || cp < 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) || cp === 0) return null;
    try { return String.fromCodePoint(cp); } catch (e) { return null; }
  }

  /**
   * decode(text) → { text, found: [{raw, decoded, codepoint, name}], unknown: [{raw, name}] }
   * Named lookups use longest-match, so &notin; resolves to ∉ and not to ¬ + "in;".
   */
  function decode(text) {
    if (text == null) text = '';
    text = String(text);
    var out = '', found = [], unknown = [], i = 0;

    while (i < text.length) {
      var amp = text.indexOf('&', i);
      if (amp === -1) { out += text.slice(i); break; }
      out += text.slice(i, amp);

      // numeric: &#123; / &#x1F600;  (semicolon optional when unambiguous)
      var num = /^&#(?:[xX]([0-9A-Fa-f]+)|([0-9]+))(;?)/.exec(text.slice(amp));
      if (num) {
        var hex = num[1], dec = num[2];
        var cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
        var semi = num[3] === ';';
        var nextCh = text.charAt(amp + num[0].length);
        if (semi || !/[0-9A-Za-z]/.test(nextCh)) {
          var raw = text.substr(amp, num[0].length);
          var ch = fromCodePointSafe(cp);
          if (ch === null) {
            var repl = '\uFFFD';
            found.push({ raw: raw, decoded: repl, codepoint: cp, name: null, replaced: true });
            out += repl;
          } else {
            found.push({ raw: raw, decoded: ch, codepoint: cp, name: null });
            out += ch;
          }
          i = amp + num[0].length;
          continue;
        }
      }

      // named: longest match first, with or without semicolon
      var slice = text.slice(amp + 1, amp + 33);
      var matched = null;
      for (var len = Math.min(32, slice.length); len >= 2; len--) {
        var cand = slice.slice(0, len);
        var semiAt = cand.charAt(cand.length - 1) === ';';
        var name = semiAt ? cand.slice(0, -1) : cand;
        if (ENTITY[name] !== undefined && (semiAt || NO_SEMI[name])) {
          matched = { name: name, raw: '&' + cand, withSemi: semiAt };
          break;
        }
      }
      if (matched) {
        var decoded = String.fromCodePoint(ENTITY[matched.name]);
        found.push({ raw: matched.raw, decoded: decoded, codepoint: ENTITY[matched.name], name: matched.name });
        out += decoded;
        i = amp + matched.raw.length;
        continue;
      }

      // "&" followed by something we do not know — keep it verbatim
      var bogus = /^&([A-Za-z][A-Za-z0-9]{0,31});?/.exec(text.slice(amp));
      if (bogus) {
        unknown.push({ raw: bogus[0], name: bogus[1] });
        out += bogus[0];
        i = amp + bogus[0].length;
      } else {
        out += '&';
        i = amp + 1;
      }
    }
    return { text: out, found: found, unknown: unknown };
  }

  function analyze(text) {
    return decode(text).found.map(function (f) {
      return {
        raw: f.raw,
        decoded: f.decoded,
        codepoint: 'U+' + (f.codepoint || 0).toString(16).toUpperCase().padStart(4, '0'),
        name: f.name
      };
    });
  }

  function escapeAttribute(text) {
    return encode(text, 'minimal');
  }

  var api = {
    encode: encode,
    decode: decode,
    analyze: analyze,
    escapeAttribute: escapeAttribute,
    ENTITY_MAP: ENTITY,
    entityCount: Object.keys(ENTITY).length
  };

  /* ───────────────────────── page wiring ───────────────────────── */

  function init() {
    var input = document.getElementById('he-in');
    if (!input) return;
    var output = document.getElementById('he-out');
    var status = document.getElementById('he-status');
    var modeSel = document.getElementById('he-mode');
    var mode = 'minimal';
    var toast = document.getElementById('dt-toast');

    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 1600);
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function setStatus(html, cls) { if (!status) return; status.className = 'dt-status ' + (cls || ''); status.innerHTML = html; }

    function renderFound() {
      var box = document.getElementById('he-entities');
      if (!box) return;
      var rows = analyze(input.value);
      if (!rows.length) { box.innerHTML = '<p class="dt-note" style="margin:0">No HTML entities found in the input.</p>'; return; }
      box.innerHTML = '<table class="dt-kv"><tr><th>Entity</th><th>Character</th><th>Code point</th><th>Name</th></tr>' +
        rows.slice(0, 50).map(function (r) {
          return '<tr><td>' + esc(r.raw) + '</td><td>' + esc(r.decoded) + '</td><td>' + r.codepoint + '</td><td>' + (r.name ? esc(r.name) : '<span class="dt-note">numeric</span>') + '</td></tr>';
        }).join('') + '</table>' + (rows.length > 50 ? '<p class="dt-note">Showing the first 50 of ' + rows.length + ' entities.</p>' : '');
    }

    function doEncode() {
      var text = input.value;
      output.value = encode(text, mode);
      var notes = [];
      if (mode === 'minimal') notes.push('Escaped &amp; &lt; &gt; &quot; and \' — the characters that can break out of HTML text or an attribute value.');
      if (mode === 'named') notes.push('Named entities are used where one exists (caf&eacute;, &copy;); everything else falls back to a decimal numeric entity that works in every browser.');
      if (mode === 'dec' || mode === 'hex') notes.push('Every non-ASCII character became a numeric entity — safest when your page encoding is uncertain.');
      if (mode === 'all') notes.push('Every character was replaced. Useful for testing or obfuscation, unreadable for humans.');
      setStatus('✓ Escaped ' + Array.from(text).length + ' characters → ' + output.value.length + ' characters of HTML.<br>' + notes.join('<br>'), 'ok');
      renderFound();
    }

    function doDecode() {
      var raw = input.value;
      var first = decode(raw);
      var text = first.text;
      var twice = false;
      if (looksStillEncoded(text)) {
        var second = decode(text);
        text = second.text;
        twice = true;
        first.found = first.found.concat(second.found);
        first.unknown = first.unknown.concat(second.unknown);
      }
      output.value = text;
      var msg = '✓ Decoded ' + first.found.length + ' entit' + (first.found.length === 1 ? 'y' : 'ies') + '.';
      if (twice) msg += ' The input was double-encoded (&amp;amp;…), so it was decoded twice.';
      if (first.found.some(function (f) { return f.replaced; })) msg += '<br>⚠ Null, surrogate and out-of-range code points were replaced with U+FFFD as the HTML parser does.';
      if (first.unknown.length) {
        setStatus(msg + '<br>⚠ Left untouched (not a known entity): ' + first.unknown.slice(0, 6).map(function (u) { return '<code>' + esc(u.raw) + '</code>'; }).join(' '), 'err');
      } else {
        setStatus(msg, 'ok');
      }
      renderFound();
    }

    function looksStillEncoded(text) {
      var r = decode(text);
      return r.found.length > 0;
    }

    function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    on('he-encode', doEncode);
    on('he-decode', doDecode);
    on('he-swap', function () { var t = input.value; input.value = output.value; output.value = t; setStatus('↔ Swapped input and output.', ''); renderFound(); });
    on('he-clear', function () {
      input.value = ''; output.value = '';
      setStatus('Type or paste HTML / text, then escape or unescape it.', '');
      renderFound();
    });
    on('he-copy', function () {
      if (!output.value) { showToast('Nothing to copy yet'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output.value).then(function () { showToast('✓ Copied'); }, function () { showToast('Copy failed — select the text manually'); });
      } else { showToast('Copy unavailable'); }
    });
    on('he-sample', function () {
      input.value = '<a href="/search?q=tea & coffee" title="Tom\u2019s \u201cBest\u201d">Caf\u00e9 \u2014 \u00a99.99</a>';
      doEncode();
    });

    if (modeSel) modeSel.addEventListener('change', function () { mode = modeSel.value; });
    input.addEventListener('input', renderFound);

    setStatus('Type or paste HTML / text, then escape or unescape it.', '');
    renderFound();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  root.DTHtml = api;
})(typeof window !== 'undefined' ? window : globalThis);
