#!/usr/bin/env node
/* Head-less tests for public/js/timestamp-converter.js — run: node scripts/timestamp-tool-test.js */
require('../public/js/timestamp-converter.js');
const T = globalThis.DTTime;
if (!T) { console.error('DTTime not exposed'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

/* ── unit detection ── */
ok('10 digits → seconds', T.detectUnit(10) === 's');
ok('13 digits → ms', T.detectUnit(13) === 'ms');
ok('16 digits → µs', T.detectUnit(16) === 'us');
ok('19 digits → ns', T.detectUnit(19) === 'ns');

/* ── epoch parsing ── */
const e1 = T.parseEpoch('1758213000');
ok('epoch seconds ok', e1.ok && e1.unit === 's' && e1.ms === 1758213000000, JSON.stringify(e1));
const e2 = T.parseEpoch('1758213000123');
ok('epoch ms ok', e2.ok && e2.unit === 'ms' && e2.ms === 1758213000123, JSON.stringify(e2));
const e3 = T.parseEpoch('1758213000123456');
ok('epoch µs ok', e3.ok && e3.unit === 'us' && Math.round(e3.ms) === 1758213000123, JSON.stringify(e3));
const e4 = T.parseEpoch('1758213000123456789');
ok('epoch ns ok', e4.ok && e4.unit === 'ns' && Math.round(e4.ms) === 1758213000123, JSON.stringify(e4));
ok('forced unit ms', T.parseEpoch('1758213000', 'ms').ms === 1758213000);
ok('fractional seconds', T.parseEpoch('1758213000.5').ms === 1758213000500, JSON.stringify(T.parseEpoch('1758213000.5')));
ok('epoch zero', T.parseEpoch('0').ms === 0);
ok('negative epoch (pre-1970)', T.parseEpoch('-86400').ms === -86400000, JSON.stringify(T.parseEpoch('-86400')));
ok('negative flag', T.parseEpoch('-86400').negative === true);
ok('epoch rejects letters', T.parseEpoch('abc').ok === false);
ok('epoch rejects mixed', T.parseEpoch('1758abc').ok === false);
ok('epoch rejects empty', T.parseEpoch('  ').ok === false && /Enter/.test(T.parseEpoch('').error));
ok('epoch out of range', T.parseEpoch('99999999999999999999999999').ok === false);

/* ── ISO / RFC formatting ── */
ok('isoUtc(0)', T.isoUtc(0) === '1970-01-01T00:00:00.000Z', T.isoUtc(0));
ok('isoUtc negative ms', T.isoUtc(-1) === '1969-12-31T23:59:59.999Z', T.isoUtc(-1));
ok('rfc2822(0)', T.rfc2822(0) === 'Thu, 01 Jan 1970 00:00:00 +0000', T.rfc2822(0));
ok('rfc2822 modern', T.rfc2822(Date.UTC(2026, 8, 18, 12, 30, 5)) === 'Fri, 18 Sep 2026 12:30:05 +0000', T.rfc2822(Date.UTC(2026, 8, 18, 12, 30, 5)));
ok('dayOfYear 2026-09-18', T.dayOfYear(Date.UTC(2026, 8, 18)) === 261, String(T.dayOfYear(Date.UTC(2026, 8, 18))));
ok('dayOfYear Jan 1', T.dayOfYear(Date.UTC(2026, 0, 1)) === 1);
ok('isoWeek Jan 1 2026 (Thu)', T.isoWeek(Date.UTC(2026, 0, 1)) === 1, String(T.isoWeek(Date.UTC(2026, 0, 1))));
ok('isoWeek Dec 31 2026', T.isoWeek(Date.UTC(2026, 11, 31)) === 53, String(T.isoWeek(Date.UTC(2026, 11, 31))));

/* ── timezones (dependency-free, via Intl) ── */
ok('UTC offset 0', T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'UTC') === 0);
ok('Shanghai +08:00', T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'Asia/Shanghai') === 480, String(T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'Asia/Shanghai')));
ok('New York EDT -240 in Sep', T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'America/New_York') === -240, String(T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'America/New_York')));
ok('New York EST -300 in Jan', T.zoneOffsetMinutes(Date.UTC(2026, 0, 18), 'America/New_York') === -300, String(T.zoneOffsetMinutes(Date.UTC(2026, 0, 18), 'America/New_York')));
ok('Kolkata +05:30', T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'Asia/Kolkata') === 330, String(T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'Asia/Kolkata')));
ok('Sydney +10:00', T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'Australia/Sydney') === 600, String(T.zoneOffsetMinutes(Date.UTC(2026, 8, 18), 'Australia/Sydney')));
ok('offsetString', T.offsetString(-240) === 'UTC-04:00' && T.offsetString(330) === 'UTC+05:30', T.offsetString(-240) + ' ' + T.offsetString(330));
ok('formatInZone Shanghai 08:00', T.formatInZone(0, 'Asia/Shanghai').includes('08:00:00'), T.formatInZone(0, 'Asia/Shanghai'));
ok('zoneRows covers 17 zones', T.zoneRows(0).length === 17);
ok('zoneRows row shape', (() => { const r = T.zoneRows(0)[0]; return r.id && r.time && r.offset; })());

/* ── relative time ── */
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
ok('relative now', T.relative(NOW, NOW) === 'just now');
ok('relative +90s', T.relative(NOW + 90000, NOW) === 'in 1 minute 30 seconds', T.relative(NOW + 90000, NOW));
ok('relative -2s', T.relative(NOW - 2000, NOW) === '2 seconds ago', T.relative(NOW - 2000, NOW));
ok('relative -1 day', T.relative(NOW - 86400000, NOW) === '1 day ago', T.relative(NOW - 86400000, NOW));
ok('relative +3 weeks', T.relative(NOW + 3 * 604800000, NOW) === 'in 3 weeks', T.relative(NOW + 3 * 604800000, NOW));
ok('relative -1 year', T.relative(NOW - 31557600000, NOW) === '1 year ago', T.relative(NOW - 31557600000, NOW));

/* ── date input parsing ── */
const d1 = T.parseDateInput('2026-09-18');
ok('date-only parsed as local midnight', d1.ok && d1.ms === new Date(2026, 8, 18).getTime(), JSON.stringify(d1));
ok('date-only flagged local', d1.assumedZone === 'local');
const d2 = T.parseDateInput('2026-09-18 20:30');
ok('naive datetime parsed as local', d2.ok && d2.ms === new Date(2026, 8, 18, 20, 30).getTime(), JSON.stringify(d2));
const d3 = T.parseDateInput('2026-09-18T20:30:00Z');
ok('ISO with Z honored', d3.ok && d3.ms === Date.UTC(2026, 8, 18, 20, 30, 0), JSON.stringify(d3));
ok('ISO with Z flagged explicit', d3.assumedZone === 'explicit');
const d4 = T.parseDateInput('2026-09-18T20:30:00+08:00');
ok('ISO with offset honored', d4.ok && d4.ms === Date.UTC(2026, 8, 18, 12, 30, 0), JSON.stringify(d4));
ok('impossible date rejected', T.parseDateInput('2026-02-30').ok === false);
ok('month 13 rejected', T.parseDateInput('2026-13-01').ok === false);
ok('garbage rejected', T.parseDateInput('not a date').ok === false);
ok('empty rejected', T.parseDateInput('').ok === false);
const dn = T.parseDateInput('now');
ok('"now" works', dn.ok && Math.abs(dn.ms - Date.now()) < 2000);
ok('date+seconds parse', T.parseDateInput('2026-09-18 20:30:45').ms === new Date(2026, 8, 18, 20, 30, 45).getTime());

/* ── describe ── */
const desc = T.describe(1758213000000, 'Asia/Shanghai', NOW);
ok('describe seconds', desc && desc.seconds === 1758213000, JSON.stringify(desc && desc.seconds));
ok('describe millis/micros/nanos', desc.millis === 1758213000000 && desc.micros === 1758213000000000 && desc.nanos === 1.758213e18, JSON.stringify([desc.millis, desc.micros, desc.nanos]));
ok('describe iso', desc.iso === '2025-09-18T16:30:00.000Z', desc.iso);
ok('describe zone label includes offset', /UTC\+08:00$/.test(desc.zone), desc.zone);
ok('describe weekday', desc.weekday === 'Thursday (UTC)', desc.weekday);
ok('describe invalid ms', T.describe(NaN) === null);

/* ── arithmetic ── */
ok('add 1 day', T.applyDelta(0, 1, 'days') === 86400000);
ok('subtract 1 day', T.applyDelta(0, -1, 'days') === -86400000);
ok('add 90 minutes', T.applyDelta(0, 90, 'minutes') === 5400000);
ok('add 2 weeks', T.applyDelta(0, 2, 'weeks') === 2 * 604800000);
ok('zero delta is identity', T.applyDelta(12345, 0, 'days') === 12345);
ok('bad unit is identity', T.applyDelta(12345, 5, 'fortnights') === 12345);
ok('non-numeric delta safe', T.applyDelta(12345, 'x', 'days') === 12345);

/* ── round trip: epoch → ISO → date parser, and epoch → ISO UTC shape ── */
let rtOk = true;
[0, 1, -1, 86399, 86400, 1758213000, 2147483647, 2147483648, 4102444800].forEach(s => {
  const ms = T.parseEpoch(String(s)).ms;
  if (Math.floor(ms / 1000) !== s) { rtOk = false; console.log('   round-trip failed for ' + s); }
  const back = T.parseDateInput(T.isoUtc(ms));
  if (!back.ok || back.ms !== s * 1000) { rtOk = false; console.log('   iso→back failed for ' + s + ' → ' + JSON.stringify(back)); }
});
ok('epoch ⇄ ISO round-trip', rtOk);
ok('year 2038 boundary ok', T.isoUtc(2147483648000) === '2038-01-19T03:14:08.000Z', T.isoUtc(2147483648000));

console.log('\n' + (fail === 0 ? '✓ ALL PASS' : '✗ FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
