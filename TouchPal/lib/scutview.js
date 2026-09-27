// tools\rom\scutview.js -- dump a candidate shortcut.lst in every encoding that matters.
//   node scutview.js <file> [byteLimit=512]
// shortcut.lst is produced by native Storage code whose strings are std::u16string
// (getShortcutList builds a String[] of UTF-16 items), so a plain ASCII view is often
// empty while the UTF-16LE view is legible.  Print both, plus a separator histogram, so
// the record grammar can be read off directly instead of guessed.
'use strict';
const fs = require('fs');
const [, , file, limStr] = process.argv;
if (!file) { console.log('usage: scutview.js <file> [byteLimit]'); process.exit(1); }
const b = fs.readFileSync(file);
const lim = limStr ? parseInt(limStr, 10) : 512;
console.log('size = ' + b.length + ' bytes (0x' + b.length.toString(16) + ')');

function rows(buf, n, decoder) {
  const out = [];
  for (let off = 0; off < Math.min(n, buf.length); off += 16) {
    const hex = [];
    for (let k = 0; k < 16 && off + k < buf.length; k++) hex.push(buf[off + k].toString(16).padStart(2, '0'));
    out.push('0x' + off.toString(16).padStart(6, '0') + '  ' + hex.join(' ').padEnd(48) + '  |' + decoder(buf, off, 16) + '|');
  }
  return out.join('\n');
}
const ascii = (buf, off, w) => {
  let s = '';
  for (let k = 0; k < w && off + k < buf.length; k++) s += buf[off + k] >= 0x20 && buf[off + k] < 0x7f ? String.fromCharCode(buf[off + k]) : '.';
  return s;
};
const utf16 = (buf, off, w) => {
  let s = '';
  for (let k = 0; k + 1 < w && off + k + 1 < buf.length; k += 2) {
    const c = buf.readUInt16LE(off + k);
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : (c === 0 ? '~' : '');
  }
  return s;
};
console.log('--- hex / ascii / utf16le ---');
console.log(rows(b, lim, ascii) .split('\n')
  .map((r, i) => r.padEnd(110) + ' |' + utf16(b, i * 16, 16) + '|').join('\n'));

console.log('--- leading u32 words ---');
for (let off = 0; off + 4 <= Math.min(64, b.length); off += 4) {
  console.log('  0x' + off.toString(16).padStart(2, '0') + '  ' + b.readUInt32LE(off) + '  (0x' + b.readUInt32LE(off).toString(16) + ')');
}
console.log('--- whole file decoded utf16le (first 400 chars, escapes shown) ---');
console.log(JSON.stringify(b.toString('utf16le').slice(0, 400)));
console.log('--- whole file decoded latin1 (first 400 chars, escapes shown) ---');
console.log(JSON.stringify(b.toString('latin1').slice(0, 400)));
