// Extract entries from a ZIP by regex, writing raw bytes. Self-contained so we
// never depend on 7z's path-separator behaviour again.
//   node ziptake.js <zip> <regex> <outdir>
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [,, zipPath, re, outDir] = process.argv;
const buf = fs.readFileSync(zipPath);

let eocd = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) { console.log('EOCD not found'); process.exit(1); }
const count = buf.readUInt16LE(eocd + 10);
let p = buf.readUInt32LE(eocd + 16);
const rx = new RegExp(re, 'i');
fs.mkdirSync(outDir, { recursive: true });
let hit = 0;
for (let n = 0; n < count; n++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) { console.log('bad CDH'); break; }
  const method = buf.readUInt16LE(p + 10);
  const csize = buf.readUInt32LE(p + 20);
  const nameLen = buf.readUInt16LE(p + 28);
  const extraLen = buf.readUInt16LE(p + 30);
  const cmtLen = buf.readUInt16LE(p + 32);
  const lho = buf.readUInt32LE(p + 42);
  const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
  p += 46 + nameLen + extraLen + cmtLen;
  if (!rx.test(name)) continue;
  // local header: sig(4) ver(2) flags(2) method(2) time(2) date(2) crc(4) csize(4) usize(4) nlen(2) elen(2)
  const lnLen = buf.readUInt16LE(lho + 26);
  const leLen = buf.readUInt16LE(lho + 28);
  const start = lho + 30 + lnLen + leLen;
  let data = buf.slice(start, start + csize);
  if (method === 8) data = zlib.inflateRawSync(data);
  else if (method !== 0) { console.log('skip (method ' + method + ') ' + name); continue; }
  const out = path.join(outDir, name.replace(/^.*[\\/]/, ''));
  fs.writeFileSync(out, data);
  console.log('wrote ' + String(data.length).padStart(9) + '  ' + name + '  -> ' + path.basename(out));
  hit++;
}
console.log('(' + hit + ' extracted)');
