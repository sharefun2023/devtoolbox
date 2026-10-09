/**
 * cidr-tool-test.js — assertions against the page's OWN inline script.
 * Run: node scripts/cidr-tool-test.js [--old]
 * --old installs the pre-fix behaviour (for reverse-proving the tests bind to fixes).
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/tools/cidr-calculator.html'), 'utf8');
const m = html.match(/<script>\n\(function\(\) \{[\s\S]*?\}\)\(\);\n<\/script>/);
if (!m) { console.error('could not extract inline tool script'); process.exit(2); }
let script = m[0].replace(/<\/?script>/g, '');

const OLD = process.argv.includes('--old');
if (OLD) {
  // install the pre-fix behaviour: IPv6 total/usable via 128-bit two's-complement
  // arithmetic on top of 2^128 (= 0 mod 2^128, all overflow truncated).
  script = script.replace(
    /const totalUsable = prefix >= 127\n\s*\? \(prefix === 128 \? 0n : \(128 - prefix === 1 \? 0n : BigInt\(128 - prefix\)\)\)\n\s*: \(\(1n << BigInt\(128 - prefix\)\) - 2n\);/,
    `const totalUsable = prefix >= 127
      ? (prefix === 128 ? 0n : ((1n << BigInt(128 - prefix)) - 1n))
      : ((1n << BigInt(128 - prefix)) - 2n);`
  ).replace(
    /totalIps: prefix === 128 \? '1' : \(\(1n << BigInt\(128 - prefix\)\)\.toLocaleString\(\)\),/,
    `totalIps: prefix === 128 ? '1' : ((1n << BigInt(128 - prefix)).toLocaleString()),`
  );
}

// In a browser `window.calculate = fn` also makes bare `calculate` resolvable.
script = 'var calculate=function(){return window.calculate.apply(null,arguments);};' + script;

const dom = {};
const mk = () => ({ value: '', textContent: '', innerHTML: '', style: {}, addEventListener() {}, removeEventListener() {} });
dom.cidrInput = mk(); dom.errorMsg = mk(); dom.results = mk();
const win = globalThis;
new Function('window', 'document', script)(win, {
  getElementById: id => dom[id],
  createElement: () => ({}),
  addEventListener: () => {}
});
const calc = win.calculate;

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name); }
}

check('calculate defined', typeof calc === 'function');
check('default 10.0.0.0/24 auto-calc on load', dom.results.innerHTML.includes('>254<'));

// ---- IPv4 ----
dom.cidrInput.value = '192.168.1.5/30'; calc();
check('192.168.1.5/30 network = 192.168.1.4', dom.results.innerHTML.includes('192.168.1.4'));
check('192.168.1.5/30 usable = 2', dom.results.innerHTML.includes('>2<'));
check('192.168.1.5/30 total = 4', dom.results.innerHTML.includes('>4<'));
dom.cidrInput.value = '255.255.255.255/32'; calc();
check('/32 total shows single host', dom.results.innerHTML.includes('1 (single host)'));
dom.cidrInput.value = '0.0.0.0/0'; calc();
check('0/0 total = 4,294,967,296', dom.results.innerHTML.includes('4,294,967,296'));
check('0/0 usable = 4,294,967,294', dom.results.innerHTML.includes('4,294,967,294'));
dom.cidrInput.value = '10.0.0.0/31'; calc();
check('/31 usable range N/A (point-to-point)', dom.results.innerHTML.includes('N/A'));
dom.cidrInput.value = '10.0.0.0/33'; calc();
check('IPv4 prefix 33 rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '10.0.0.256/24'; calc();
check('octet 256 rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '1.2.3/24'; calc();
check('3-octet address rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '10.0.0.0'; calc();
check('missing slash rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '172.16.5.0/24'; calc();
check('172.16.5.0/24 first usable 172.16.5.1', dom.results.innerHTML.includes('172.16.5.1'));
check('172.16.5.0/24 last usable 172.16.5.254', dom.results.innerHTML.includes('172.16.5.254'));

// ---- IPv6 ----
dom.cidrInput.value = '2001:db8::/32'; calc();
check('v6 /32 network 2001:db8::', dom.results.innerHTML.includes('2001:db8::'));
check('v6 /32 last 2001:db8:ffff:', dom.results.innerHTML.includes('2001:db8:ffff:'));
if (OLD) {
  // old (buggy) behaviour: 128-bit arithmetic overflows to 0-based totals
  check('OLD v6 /32 total wrong (2)', dom.results.innerHTML.includes('>2<') || !dom.results.innerHTML.includes('79,228,162,514,264,337,593,543,950,336'));
} else {
  check('v6 /32 total = 79,228,162,514,264,337,593,543,950,336', dom.results.innerHTML.includes('79,228,162,514,264,337,593,543,950,336'));
  check('v6 /32 usable = ...334', dom.results.innerHTML.includes('79,228,162,514,264,337,593,543,950,334'));
}
dom.cidrInput.value = '2001:db8::/127'; calc();
check('v6 /127 point-to-point', dom.results.innerHTML.includes('point-to-point'));
dom.cidrInput.value = '2001:db8::/128'; calc();
check('v6 /128 single address', dom.results.innerHTML.includes('>1<'));
dom.cidrInput.value = '2001:db8::/129'; calc();
check('v6 prefix 129 rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '2001:db8::12345::/48'; calc();
check('double :: rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '2001:db8::gggg/48'; calc();
check('non-hex group rejected', dom.errorMsg.textContent.length > 0);
dom.cidrInput.value = '2001:db8:0:0:0:0:0:0/128'; calc();
check('expanded v6 compresses to 2001:db8::', dom.results.innerHTML.includes('2001:db8::'));
dom.cidrInput.value = '::1/128'; calc();
check('::1/128 loops back', dom.results.innerHTML.includes('::1'));
dom.cidrInput.value = 'fe80::/10'; calc();
check('link-local fe80::/10', dom.results.innerHTML.includes('fe80::'));
dom.cidrInput.value = 'fe80::/11'; calc();
check('fe80 prefix 11 network 0::', dom.results.innerHTML.includes('>0::<') || dom.results.innerHTML.includes('0:'));

console.log(`\n${passed} passed, ${failed} failed${OLD ? '  (--old: expected failures prove the fix)' : ''}`);
process.exit(failed > 0 ? 1 : 0);
