/* DevToolBox — Unix timestamp converter engine + page wiring.
 * Pure client-side. Exposed as window.DTTime (globalThis.DTTime under Node for tests).
 *
 * Supports second / millisecond / microsecond / nanosecond epochs, ISO 8601 dates,
 * RFC 2822 dates, naive "YYYY-MM-DD HH:mm:ss" input, IANA timezone rendering via
 * Intl.DateTimeFormat, and date arithmetic (add / subtract days, hours, minutes...).
 */
(function (root) {
  'use strict';

  var DAY = 86400000;

  var ZONES = [
    { id: 'UTC', label: 'UTC' },
    { id: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
    { id: 'America/Denver', label: 'Denver (MT)' },
    { id: 'America/Chicago', label: 'Chicago (CT)' },
    { id: 'America/New_York', label: 'New York (ET)' },
    { id: 'America/Sao_Paulo', label: 'São Paulo' },
    { id: 'Europe/London', label: 'London' },
    { id: 'Europe/Berlin', label: 'Berlin / Paris' },
    { id: 'Europe/Moscow', label: 'Moscow' },
    { id: 'Asia/Dubai', label: 'Dubai' },
    { id: 'Asia/Kolkata', label: 'India (IST)' },
    { id: 'Asia/Shanghai', label: 'Beijing / Shanghai' },
    { id: 'Asia/Singapore', label: 'Singapore' },
    { id: 'Asia/Tokyo', label: 'Tokyo' },
    { id: 'Asia/Seoul', label: 'Seoul' },
    { id: 'Australia/Sydney', label: 'Sydney' },
    { id: 'Pacific/Auckland', label: 'Auckland' }
  ];

  /* ───────────────────────── unit detection / parsing ───────────────────────── */

  function detectUnit(digits) {
    if (digits <= 11) return 's';
    if (digits <= 14) return 'ms';
    if (digits <= 17) return 'us';
    return 'ns';
  }

  var PER_MS = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 };

  function unitToMs(value, unit) {
    switch (unit) {
      case 's': return value * 1000;
      case 'ms': return value;
      case 'us': return value / 1000;
      case 'ns': return value / 1e6;
      default: return value * 1000;
    }
  }

  function msToUnit(ms, unit) {
    switch (unit) {
      case 's': return Math.round(ms / 1000);
      case 'ms': return Math.round(ms);
      case 'us': return Math.round(ms * 1000);
      case 'ns': return Math.round(ms * 1e6);
      default: return Math.round(ms / 1000);
    }
  }

  /* Parse a raw epoch value. Returns {ok, ms, unit, negative, digits} or {ok:false, error}. */
  function parseEpoch(raw, forcedUnit) {
    if (raw == null) return { ok: false, error: 'Enter a Unix timestamp.' };
    var text = String(raw).trim();
    if (!text) return { ok: false, error: 'Enter a Unix timestamp.' };
    if (text.indexOf('.') !== -1) {
      // fractional epoch, e.g. 1758213000.123 — always seconds
      if (!/^-?\d+\.\d+$/.test(text)) return { ok: false, error: 'That is not a valid numeric timestamp: "' + text + '".' };
      var fms = parseFloat(text) * 1000;
      return { ok: true, ms: fms, unit: 's', digits: text.replace(/[-.]/g, '').length, fractional: true };
    }
    if (!/^-?\d+$/.test(text)) {
      return { ok: false, error: 'Timestamps are digits only — "' + text + '" contains other characters. Did you mean to paste a date instead?' };
    }
    var negative = text.charAt(0) === '-';
    var digits = text.replace('-', '').length;
    var unit = forcedUnit && forcedUnit !== 'auto' ? forcedUnit : detectUnit(digits);
    var value = Number(text);
    var ms = unitToMs(value, unit);
    if (!isFinite(ms)) return { ok: false, error: 'That value is out of range.' };
    if (Math.abs(ms) > 8.64e15) {
      return { ok: false, error: 'Out of range — JavaScript dates stop at ±8,640,000,000,000,000 ms (year ±275760).' };
    }
    return { ok: true, ms: ms, unit: unit, digits: digits, negative: negative, fractional: false };
  }

  /* Parse a human date. Returns {ok, ms, assumedZone} or {ok:false, error}. */
  function parseDateInput(raw) {
    if (raw == null) return { ok: false, error: 'Enter a date.' };
    var text = String(raw).trim();
    if (!text) return { ok: false, error: 'Enter a date.' };

    if (/^(now|today)$/i.test(text)) return { ok: true, ms: Date.now(), assumedZone: 'local', keyword: text.toLowerCase() };

    // naive "2026-09-18 20:30[:15]" or "2026/09/18 20:30" → local time, like a clock on the wall
    var naive = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/.exec(text);
    if (naive) {
      var d = new Date(
        Number(naive[1]), Number(naive[2]) - 1, Number(naive[3]),
        Number(naive[4] || 0), Number(naive[5] || 0), Number(naive[6] || 0), Number((naive[7] || '0').padEnd(3, '0'))
      );
      if (isNaN(d.getTime())) return { ok: false, error: 'That date does not exist: "' + text + '".' };
      var rolled = d.getFullYear() !== Number(naive[1]) || d.getMonth() !== Number(naive[2]) - 1 || d.getDate() !== Number(naive[3]) ||
        d.getHours() !== Number(naive[4] || 0) || d.getMinutes() !== Number(naive[5] || 0) || d.getSeconds() !== Number(naive[6] || 0);
      if (rolled) {
        return { ok: false, error: 'That date does not exist: "' + text + '" (the day is out of range for that month).' };
      }
      return { ok: true, ms: d.getTime(), assumedZone: 'local' };
    }

    // ISO with an explicit offset / Z, or RFC 2822 — let the engine decide
    var ms = Date.parse(text.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/(\d{2}:\d{2})\s+/, '$1'));
    if (!isNaN(ms)) {
      var hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text.trim()) || /(?:Z|[+-]\d{2}:?\d{2})$/.test(text.trim()) || /\b(?:GMT|UTC)\b/i.test(text);
      return { ok: true, ms: ms, assumedZone: hasOffset ? 'explicit' : 'local' };
    }
    return { ok: false, error: 'Unrecognised date format: "' + text + '". Try 2026-09-18, 2026-09-18 20:30, 2026-09-18T20:30:00Z or an RFC 2822 date.' };
  }

  /* ───────────────────────── formatting ───────────────────────── */

  function pad(n, w) { var s = String(Math.abs(n)); while (s.length < (w || 2)) s = '0' + s; return (n < 0 ? '-' : '') + s; }

  function isoUtc(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return 'Invalid date';
    return pad(d.getUTCFullYear(), 4) + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '.' + pad(d.getUTCMilliseconds(), 3) + 'Z';
  }

  function zoneOffsetMinutes(ms, tz) {
    // Compute the offset of `tz` at instant `ms` by re-formatting and diffing.
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var parts = {};
    dtf.formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    var asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour === '24' ? '00' : parts.hour), Number(parts.minute), Number(parts.second)
    );
    return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / 60000);
  }

  function offsetString(minutes) {
    var sign = minutes < 0 ? '-' : '+';
    var abs = Math.abs(minutes);
    return 'UTC' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  function formatInZone(ms, tz) {
    if (isNaN(ms)) return 'Invalid date';
    var dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false,
      weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    return dtf.format(new Date(ms));
  }

  function rfc2822(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return 'Invalid date';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getUTCDay()] + ', ' + pad(d.getUTCDate()) + ' ' + mon[d.getUTCMonth()] + ' ' + pad(d.getUTCFullYear(), 4) +
      ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' +0000';
  }

  function dayOfYear(ms) {
    var d = new Date(ms);
    var start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / DAY) + 1;
  }

  function isoWeek(ms) {
    var d = new Date(ms);
    var target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNr = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNr + 3);
    var firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    var diff = target - firstThursday;
    return 1 + Math.round((diff / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  }

  function relative(ms, now) {
    if (isNaN(ms)) return '—';
    now = now == null ? Date.now() : now;
    var delta = ms - now;
    var future = delta > 0;
    var abs = Math.abs(delta);
    var units = [
      ['year', 31557600000], ['month', 2629800000], ['week', 604800000],
      ['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000]
    ];
    if (abs < 1000) return 'just now';
    for (var i = 0; i < units.length; i++) {
      var name = units[i][0], size = units[i][1];
      if (abs >= size) {
        var n = Math.floor(abs / size);
        var rest = abs - n * size;
        var text = n + ' ' + name + (n === 1 ? '' : 's');
        var next = units[i + 1];
        if (next && n < 3 && Math.floor(rest / next[1]) > 0) {
          text += ' ' + Math.floor(rest / next[1]) + ' ' + next[0] + (Math.floor(rest / next[1]) === 1 ? '' : 's');
        }
        return future ? 'in ' + text : text + ' ago';
      }
    }
    return 'just now';
  }

  function describe(ms, tz, now) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return {
      iso: isoUtc(ms),
      isoLocal: pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3) +
        offsetString(-d.getTimezoneOffset()),
      utc: formatInZone(ms, 'UTC') + ' UTC',
      local: formatInZone(ms, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
      zone: tz ? formatInZone(ms, tz) + ' ' + offsetString(zoneOffsetMinutes(ms, tz)) : null,
      rfc2822: rfc2822(ms),
      relative: relative(ms, now),
      weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()] + ' (UTC)',
      dayOfYear: dayOfYear(ms),
      isoWeek: isoWeek(ms),
      seconds: Math.floor(ms / 1000),
      millis: Math.round(ms),
      micros: Math.round(ms * 1000),
      nanos: Math.round(ms * 1e6)
    };
  }

  function applyDelta(ms, amount, unit) {
    var n = Number(amount);
    if (!isFinite(n) || n === 0) return ms;
    var table = { seconds: 1000, minutes: 60000, hours: 3600000, days: DAY, weeks: 604800000 };
    var step = table[unit];
    if (!step) return ms;
    var d = new Date(ms);
    if (unit === 'days' || unit === 'weeks') {
      // calendar-correct for days/weeks (handles DST in local time)
      d.setTime(ms + n * step);
      return d.getTime();
    }
    return ms + n * step;
  }

  function zoneRows(ms) {
    return ZONES.map(function (z) {
      return { id: z.id, label: z.label, time: formatInZone(ms, z.id), offset: offsetString(zoneOffsetMinutes(ms, z.id)) };
    });
  }

  function localZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
  }

  var api = {
    ZONES: ZONES,
    detectUnit: detectUnit,
    parseEpoch: parseEpoch,
    parseDateInput: parseDateInput,
    isoUtc: isoUtc,
    rfc2822: rfc2822,
    relative: relative,
    describe: describe,
    applyDelta: applyDelta,
    zoneRows: zoneRows,
    zoneOffsetMinutes: zoneOffsetMinutes,
    offsetString: offsetString,
    formatInZone: formatInZone,
    dayOfYear: dayOfYear,
    isoWeek: isoWeek,
    msToUnit: msToUnit,
    localZone: localZone
  };

  /* ───────────────────────── page wiring ───────────────────────── */

  function init() {
    var tsIn = document.getElementById('ts-in');
    if (!tsIn) return;

    var unitSel = document.getElementById('ts-unit');
    var tzSel = document.getElementById('ts-tz');
    var status = document.getElementById('ts-status');
    var table = document.getElementById('ts-table');
    var zonesBody = document.getElementById('ts-zones');
    var dateIn = document.getElementById('ts-date-in');
    var dateOut = document.getElementById('ts-date-out');
    var dtLocal = document.getElementById('ts-datetime');
    var deltaAmount = document.getElementById('ts-delta-amount');
    var deltaUnit = document.getElementById('ts-delta-unit');
    var deltaOut = document.getElementById('ts-delta-out');
    var toast = document.getElementById('dt-toast');
    var live = document.getElementById('ts-live');
    var current = null;

    if (tzSel) {
      tzSel.innerHTML = ZONES.map(function (z) {
        return '<option value="' + z.id + '"' + (z.id === localZone() ? ' selected' : '') + '>' + z.label + ' (' + z.id + ')</option>';
      }).join('');
    }

    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 1600);
    }

    function copy(text) {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { showToast('✓ Copied'); }, function () { showToast('Copy failed — select the text manually'); });
        return;
      }
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('✓ Copied');
      } catch (e) { showToast('Copy failed'); }
    }

    function setStatus(ok, html) {
      if (!status) return;
      status.className = 'dt-status ' + (ok ? 'ok' : 'err');
      status.innerHTML = html;
    }

    function paint(ms, sourceLabel) {
      current = ms;
      var d = describe(ms, tzSel ? tzSel.value : null);
      if (!d) { setStatus(false, 'That value is outside the range of representable dates.'); if (table) table.innerHTML = ''; return; }
      var rows = [
        ['Unix seconds', d.seconds + '  (10-digit)'],
        ['Unix milliseconds', d.millis + '  (13-digit)'],
        ['Unix microseconds', d.micros],
        ['Unix nanoseconds', d.nanos],
        ['ISO 8601 (UTC)', d.iso],
        ['RFC 2822', d.rfc2822],
        ['UTC', d.utc],
        ['Your local time', d.local],
        ['Selected timezone', d.zone],
        ['Relative', d.relative],
        ['Weekday', d.weekday],
        ['Day of year', d.dayOfYear + '   ·   ISO week ' + d.isoWeek]
      ];
      if (table) {
        table.innerHTML = rows.map(function (r) {
          return '<tr><th>' + r[0] + '</th><td>' + String(r[1]).replace(/&/g, '&amp;').replace(/</g, '&lt;') +
            '</td><td style="width:64px"><button class="dt-btn" data-copy="' + String(r[1]).split('  ')[0].replace(/"/g, '&quot;') + '">copy</button></td></tr>';
        }).join('');
        Array.prototype.forEach.call(table.querySelectorAll('button[data-copy]'), function (b) {
          b.addEventListener('click', function () { copy(b.getAttribute('data-copy')); });
        });
      }
      if (zonesBody) {
        zonesBody.innerHTML = zoneRows(ms).map(function (z) {
          return '<tr><td>' + z.label + '</td><td>' + z.time + '</td><td>' + z.offset + '</td></tr>';
        }).join('');
      }
      setStatus(true, '✓ ' + sourceLabel + ' — <b>' + d.iso + '</b> (' + d.relative + ')');
      if (dateOut) {
        dateOut.value = d.iso + '\n' + d.rfc2822 + '\nUnix: ' + d.seconds + ' s  ·  ' + d.millis + ' ms';
      }
      if (deltaOut) deltaOut.dataset.base = String(ms);
    }

    function convertTs() {
      var res = parseEpoch(tsIn.value, unitSel ? unitSel.value : 'auto');
      if (!res.ok) { setStatus(false, '✗ ' + res.error); if (table) table.innerHTML = ''; return; }
      var unitNote = res.fractional ? 'fractional seconds' : res.unit === 's' ? 'seconds' : res.unit === 'ms' ? 'milliseconds' : res.unit === 'us' ? 'microseconds' : 'nanoseconds';
      paint(res.ms, 'Read as ' + unitNote + (res.negative ? ' (before 1970)' : ''));
    }

    function setNow(explicit) {
      var ms = Date.now();
      tsIn.value = String(Math.floor(ms / 1000));
      // only pin the unit when the user asked for "now" — on first paint the
      // selector must stay on "Auto-detect", otherwise every later paste is
      // force-read as seconds
      if (explicit && unitSel) unitSel.value = 's';
      if (dtLocal) dtLocal.value = new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      paint(ms, 'Current time');
    }

    function fromDate() {
      var res = parseDateInput(dateIn ? dateIn.value : '');
      if (!res.ok) { setStatus(false, '✗ ' + res.error); return; }
      var zoneNote = res.assumedZone === 'explicit' ? 'timezone from the input' : 'your local timezone (' + localZone() + ')';
      tsIn.value = String(Math.floor(res.ms / 1000));
      if (unitSel) unitSel.value = 's';
      paint(res.ms, 'Parsed as ' + zoneNote);
    }

    function fromPicker() {
      if (!dtLocal || !dtLocal.value) return;
      var d = new Date(dtLocal.value);
      if (isNaN(d.getTime())) { setStatus(false, '✗ Pick a valid date and time.'); return; }
      tsIn.value = String(Math.floor(d.getTime() / 1000));
      if (unitSel) unitSel.value = 's';
      paint(d.getTime(), 'From the date picker (local time)');
    }

    function applyShift() {
      var base = current == null ? Date.now() : current;
      var ms = applyDelta(base, deltaAmount ? deltaAmount.value : 0, deltaUnit ? deltaUnit.value : 'days');
      tsIn.value = String(Math.floor(ms / 1000));
      paint(ms, 'Shifted by ' + (deltaAmount ? deltaAmount.value : 0) + ' ' + (deltaUnit ? deltaUnit.value : 'days'));
      if (dateIn) dateIn.value = isoUtc(ms).slice(0, 19).replace('T', ' ');
    }

    function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    on('ts-now', function () { setNow(true); });
    on('ts-convert', convertTs);
    on('ts-date-go', fromDate);
    on('ts-picker-go', fromPicker);
    on('ts-delta-go', applyShift);
    on('ts-copy-iso', function () { copy(current == null ? '' : isoUtc(current)); });
    on('ts-copy-seconds', function () { copy(current == null ? '' : String(Math.floor(current / 1000))); });

    if (unitSel) unitSel.addEventListener('change', function () { if (tsIn.value.trim()) convertTs(); });
    if (tzSel) tzSel.addEventListener('change', function () { if (current != null) paint(current, 'Selected timezone changed'); });
    tsIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); convertTs(); } });
    if (dateIn) dateIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); fromDate(); } });
    if (dtLocal) dtLocal.addEventListener('change', fromPicker);

    // live clock in the hero of the tool panel
    if (live) {
      var tick = function () {
        var ms = Date.now();
        live.innerHTML = '<b>' + Math.floor(ms / 1000) + '</b> s &nbsp;·&nbsp; <b>' + ms + '</b> ms &nbsp;·&nbsp; ' + isoUtc(ms);
      };
      tick();
      setInterval(tick, 1000);
    }

    setNow();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  root.DTTime = api;
})(typeof window !== 'undefined' ? window : globalThis);
