// Dump a ZIP central directory: name, method, sizes, offset. Reveals the true
// separator ('/' per spec) that 7z's console listing hides behind '\'.
'use strict';
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
const filt = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;

// locate End Of Central Directory (0x06054b50) scanning backwards
let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.log('EOCD not found — not a ZIP?'); process.exit(1); }
const count = buf.readUInt16LE(eocd + 10);
let off = buf.readUInt32LE(eocd + 16);
console.log('file=' + process.argv[2] + '  eocd=0x' + eocd.toString(16) + '  entries=' + count);

let p = off;
const rows = [];
for (let n = 0; n < count; n++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) { console.log('bad CDH @0x' + p.toString(16)); break; }
  const method = buf.readUInt16LE(p + 10);
  const csize = buf.readUInt32LE(p + 20);
  const usize = buf.readUInt32LE(p + 24);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const cmtLen = buf.readUInt16LE(p + 32);
  const extOff = buf.readUInt32LE(p + 44);
  const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
  rows.push({ name, method, csize, usize, extOff });
  p += 46 + nameLen + extraLen + cmtLen;
}
let shown = 0;
for (const r of rows) {
  if (filt && !filt.test(r.name)) continue;
  const tag = r.method === 0 ? 'STORED ' : 'DEFLATE';
  console.log('  ' + tag + '  ' + String(r.usize).padStart(9) + ' -> ' + String(r.csize).padStart(9) +
              '  local=0x' + r.extOff.toString(16) + '  ' + r.name);
  shown++;
}
console.log('  (shown ' + shown + ' of ' + rows.length + ')');
