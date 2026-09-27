// Byte-faithful ZIP rebuilder.
//
// Why this exists: .NET's CompressionLevel.NoCompression still emits ZIP method 8
// (deflate with stored blocks), and 7z rewrites entry paths unpredictably on
// Windows. TouchPal's engine mmaps rom images straight out of the tprc archive
// (base.apk -> assets.zip -> tprc -> *.rom.png) and every rom entry is ZIP method
// 0, so only an explicit writer can keep method 0 with an exact entry name.
//
// Untouched entries are copied as one opaque block spanning [local header .. start
// of the next local header]. That sidesteps data descriptors entirely: whatever the
// producer wrote after the compressed bytes travels along unmodified.
//
// usage: node ziprebuild.js spec.json
// spec = {
//   src: "in.zip", dst: "out.zip",
//   add: [ { name, file, method } ],   // method 0 = stored, 8 = deflate
//   del: [ "entry/name" ],
//   verbose: true
// }
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const src = fs.readFileSync(spec.src);

let eocd = -1;
for (let i = src.length - 22; i >= Math.max(0, src.length - 65557); i--) {
  if (src.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
}
if (eocd < 0) throw new Error('EOCD not found: ' + spec.src);
if (src.readUInt16LE(eocd + 8) !== src.readUInt16LE(eocd + 10)) throw new Error('zip64/multi-disk not supported');
const total = src.readUInt16LE(eocd + 10);
const cdStart = src.readUInt32LE(eocd + 16);

const entries = [];
let p = cdStart;
for (let n = 0; n < total; n++) {
  if (src.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header @0x' + p.toString(16));
  const e = {
    version: src.readUInt16LE(p + 4),
    flags: src.readUInt16LE(p + 6),
    method: src.readUInt16LE(p + 10),
    time: src.readUInt16LE(p + 12),
    date: src.readUInt16LE(p + 14),
    crc: src.readUInt32LE(p + 16),
    csize: src.readUInt32LE(p + 20),
    usize: src.readUInt32LE(p + 24),
    nameLen: src.readUInt16LE(p + 28),
    extraLen: src.readUInt16LE(p + 30),
    cmtLen: src.readUInt16LE(p + 32),
    diskStart: src.readUInt16LE(p + 34),
    intAttr: src.readUInt16LE(p + 36),
    extAttr: src.readUInt32LE(p + 38),
    localOff: src.readUInt32LE(p + 42),
  };
  if (e.flags & 0x40) throw new Error('zip64 extension on ' + e.name);
  e.nameBuf = Buffer.from(src.slice(p + 46, p + 46 + e.nameLen));
  e.name = e.nameBuf.toString('utf8');
  entries.push(e);
  p += 46 + e.nameLen + e.extraLen + e.cmtLen;
}
if (p !== eocd) throw new Error('central directory did not end at EOCD');

// Block boundaries: walk the local headers in file order. A v2 signing block, if
// any, sits between the final entry and the central directory; drop it rather than
// folding it into the last entry's payload.
let lastDataEnd = cdStart;
const MAGIC = Buffer.from('APK Sig Block 42', 'ascii');
if (cdStart > 24 && src.slice(cdStart - 24, cdStart - 8).compare(MAGIC) === 0) {
  const blockSize = Number(src.readBigUInt64LE(cdStart - 32));
  const blockStart = cdStart - 8 - blockSize;
  if (blockStart > 0) { lastDataEnd = blockStart; console.log('  (dropped APK signing block at 0x' + blockStart.toString(16) + ')'); }
}
const byOff = entries.slice().sort((a, b) => a.localOff - b.localOff);
for (let i = 0; i < byOff.length; i++) {
  const e = byOff[i];
  if (src.readUInt32LE(e.localOff) !== 0x04034b50) throw new Error('bad local header for ' + e.name);
  const ln = src.readUInt16LE(e.localOff + 26);
  const le = src.readUInt16LE(e.localOff + 28);
  const dataStart = e.localOff + 30 + ln + le;
  const end = (i + 1 < byOff.length) ? byOff[i + 1].localOff : lastDataEnd;
  if (dataStart + e.csize > end) throw new Error('entry overruns its block: ' + e.name);
  e.block = src.slice(e.localOff, end);
}

const del = new Set(spec.del || []);
const add = spec.add || [];
const addNames = new Set(add.map(a => a.name));
if (spec.verbose) {
  for (const e of entries) if (del.has(e.name)) console.log('  del  ' + e.name);
  for (const n of addNames) if (!entries.some(e => e.name === n)) console.log('  new  ' + n);
}

const out = [];
let cursor = 0;
const writeOrder = [];

for (const e of entries) {
  if (del.has(e.name) || addNames.has(e.name)) continue;
  e.offset = cursor;
  out.push(e.block);
  cursor += e.block.length;
  writeOrder.push(e);
}

function dosNow() {
  const d = new Date();
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

for (const a of add) {
  const raw = fs.readFileSync(a.file);
  const method = a.method === 0 ? 0 : 8;
  const payload = method === 8
    ? zlib.deflateRawSync(raw, { level: a.level === undefined ? 6 : a.level })
    : raw;
  const nb = Buffer.from(a.name, 'utf8');
  const t = dosNow();
  const head = Buffer.alloc(30 + nb.length);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0, 6);            // no data descriptor on our own entries
  head.writeUInt16LE(method, 8);
  head.writeUInt16LE(t.time, 10);
  head.writeUInt16LE(t.date, 12);
  head.writeUInt32LE(crc32(raw), 14);
  head.writeUInt32LE(payload.length, 18);
  head.writeUInt32LE(raw.length, 22);
  head.writeUInt16LE(nb.length, 26);
  head.writeUInt16LE(0, 28);
  nb.copy(head, 30);
  const e = { version: 20, flags: 0, method, time: t.time, date: t.date, crc: crc32(raw),
              csize: payload.length, usize: raw.length, nameLen: nb.length, cmtLen: 0,
              diskStart: 0, intAttr: 0, extAttr: 0, nameBuf: nb, name: a.name, offset: cursor };
  out.push(head, payload);
  cursor += head.length + payload.length;
  writeOrder.push(e);
}

const newCdStart = cursor;
for (const e of writeOrder) {
  const cd = Buffer.alloc(46 + e.nameLen);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(e.version, 4);
  cd.writeUInt16LE(e.version, 6);
  cd.writeUInt16LE(e.flags, 8);
  cd.writeUInt16LE(e.method, 10);
  cd.writeUInt16LE(e.time, 12);
  cd.writeUInt16LE(e.date, 14);
  cd.writeUInt32LE(e.crc, 16);
  cd.writeUInt32LE(e.csize, 20);
  cd.writeUInt32LE(e.usize, 24);
  cd.writeUInt16LE(e.nameLen, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(e.diskStart, 34);
  cd.writeUInt16LE(e.intAttr, 36);
  cd.writeUInt32LE(e.extAttr, 38);
  cd.writeUInt32LE(e.offset, 42);
  e.nameBuf.copy(cd, 46);
  out.push(cd);
  cursor += cd.length;
}

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(writeOrder.length, 8);
end.writeUInt16LE(writeOrder.length, 10);
end.writeUInt32LE(cursor - newCdStart, 12);
end.writeUInt32LE(newCdStart, 16);
out.push(end);

fs.writeFileSync(spec.dst, Buffer.concat(out));
console.log('  -> ' + spec.dst + '  entries=' + writeOrder.length + '  bytes=' + cursor);
