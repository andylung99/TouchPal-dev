// tools\rom\shortcut_build.js -- build / parse TouchPal's shortcut.lst.
//
//   node shortcut_build.js parse  <file>            [limit]
//   node shortcut_build.js build  <wubi.txt> <out>  [maxRecords] [maxPerCode] [maxWord]
//
// Format recovered 2026-09-26 by backing up 4 hand-made custom phrases from the device
// and reading the 72-byte result out of Backup/files.zip:
//
//   u32 count                       (little endian, no magic, no checksum)
//   count * {
//     u32 nCode;  UTF-16LE nCode    -- the trigger string, letters only, <=16
//     u32 nWord;  UTF-16LE nWord    -- what gets committed
//   }
//
// Because the "code" field is a plain letter string (not pinyin syllable ids like the
// .usr user dictionary), it can carry Wubi codes directly.
'use strict';
const fs = require('fs');

function parse(buf) {
  const count = buf.readUInt32LE(0);
  const recs = [];
  let p = 4;
  for (let i = 0; i < count; i++) {
    const nc = buf.readUInt32LE(p); p += 4;
    const code = buf.toString('utf16le', p, p + nc * 2); p += nc * 2;
    const nw = buf.readUInt32LE(p); p += 4;
    const word = buf.toString('utf16le', p, p + nw * 2); p += nw * 2;
    recs.push({ code, word });
  }
  return { count, recs, consumed: p };
}

const [, , mode] = process.argv;

if (mode === 'parse') {
  const buf = fs.readFileSync(process.argv[3]);
  const { count, recs, consumed } = parse(buf);
  const limit = process.argv[4] ? parseInt(process.argv[4], 10) : 20;
  console.log('size=' + buf.length + ' header.count=' + count + ' consumed=' + consumed +
    ' -> ' + (consumed === buf.length ? 'EXACT' : 'DRIFT ' + (buf.length - consumed)));
  recs.slice(0, limit).forEach((r, i) => console.log('  [' + i + '] ' + JSON.stringify(r.code) + ' -> ' + JSON.stringify(r.word)));
  if (recs.length > limit) console.log('  ... ' + (recs.length - limit) + ' more');
  const bad = recs.filter((r) => r.code.length === 0 || r.code.length > 16 || r.word.length === 0 || r.word.length > 16);
  console.log('records violating 1..16 char bounds = ' + bad.length);
  process.exit(0);
}

if (mode === 'find') {
  // Locate a record by code (and optionally word) and report its index.  Because the
  // dictionary is written in weight order, the index of a deep, rarely-used entry is a
  // lower bound on how much of the file the app actually imported.
  const buf = fs.readFileSync(process.argv[3]);
  const want = process.argv[4], wantWord = process.argv[5] || null;
  const { count, recs, consumed } = parse(buf);
  console.log('size=' + buf.length + ' count=' + count + ' consumed=' + consumed +
              ' -> ' + (consumed === buf.length ? 'EXACT' : 'MISMATCH'));
  let hit = 0;
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].code === want && (!wantWord || recs[i].word === wantWord)) {
      console.log('  index ' + i + '  (of ' + count + ', ' +
                  (100 * i / count).toFixed(1) + '% through the file)');
      hit++;
    }
  }
  if (!hit) console.log('  not found');
  process.exit(0);
}

if (mode === 'merge') {
  // merge <out.lst> <a.lst> <b.lst> ...   -- concatenate dictionaries, drop exact
  // (code, word) repeats, keep the first file's ordering so the sentinel stays on top.
  // argv[2] is the mode, so the output is argv[3]; reading it from argv[4] silently
  // overwrote the first input dictionary instead.
  const dst = process.argv[3];
  const files = process.argv.slice(4);
  if (!files.length || files.includes(dst)) { console.log('refusing: output must not be an input'); process.exit(1); }
  const seen = new Set(), pairs = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const r = parse(buf);
    if (r.consumed !== buf.length) { console.log(f + ' -> TRUNCATED, abort'); process.exit(1); }
    let added = 0;
    for (const x of r.recs) {
      const k = x.code + '\u0000' + x.word;
      if (seen.has(k)) continue;
      seen.add(k); pairs.push(x); added++;
    }
    console.log('  + ' + f + '  ' + added + '/' + r.recs.length + ' new');
  }
  const chunks = [];
  let total = 4;
  for (const x of pairs) {
    const cb = Buffer.alloc(4 + x.code.length * 2);
    cb.writeUInt32LE(x.code.length, 0); cb.write(x.code, 4, 'utf16le');
    const wb = Buffer.alloc(4 + x.word.length * 2);
    wb.writeUInt32LE(x.word.length, 0); wb.write(x.word, 4, 'utf16le');
    chunks.push(cb, wb); total += cb.length + wb.length;
  }
  const out = Buffer.allocUnsafe(total);
  out.writeUInt32LE(pairs.length, 0);
  let o = 4;
  for (const c of chunks) { c.copy(out, o); o += c.length; }
  fs.writeFileSync(dst, out);
  const chk = parse(fs.readFileSync(dst));
  console.log('wrote ' + dst + '  records=' + pairs.length + '  bytes=' + total +
              '  reparse=' + (chk.consumed === total ? 'EXACT' : 'MISMATCH'));
  process.exit(0);
}

if (mode === 'stats') {
  // Histogram of code lengths plus the per-code fan-out, so the size of a filtered
  // dictionary can be judged before building it (1- and 2-key codes collide hardest
  // with pinyin typing, 4-key codes are fully specified Wubi).
  const rows = fs.readFileSync(process.argv[3], 'utf8').split(/\r?\n/)
    .filter((l) => l && l[0] !== '#')
    .map((l) => l.split(/\s+/))
    .filter((f) => f.length >= 2 && /^[a-z]+$/.test(f[1]));
  const byLen = new Map(), fan = new Map();
  for (const f of rows) {
    byLen.set(f[1].length, (byLen.get(f[1].length) || 0) + 1);
    fan.set(f[1], (fan.get(f[1]) || 0) + 1);
  }
  console.log('entries=' + rows.length + '  distinctCodes=' + fan.size);
  for (const k of [...byLen.keys()].sort((a, b) => a - b)) console.log('  codeLen ' + k + ' = ' + byLen.get(k));
  let worst = [null, 0];
  for (const [c, n] of fan) if (n > worst[1]) worst = [c, n];
  console.log('  busiest code = ' + worst[0] + ' with ' + worst[1] + ' words');
  const longWords = rows.filter((f) => f[0].length > 8).length;
  console.log('  words longer than 8 chars = ' + longWords);
  // How many distinct single characters are reachable at each SHORTEST code.  The source
  // dictionary only lists 简码 for many single chars (钱 has qg/qgt but no 4-key form), so
  // a length-4-only filter silently drops them; this histogram sizes that loss.
  const minLen = new Map();
  for (const f of rows) {
    if (f[0].length !== 1) continue;
    const prev = minLen.get(f[0]);
    if (prev === undefined || f[1].length < prev) minLen.set(f[0], f[1].length);
  }
  const hist = new Map();
  for (const n of minLen.values()) hist.set(n, (hist.get(n) || 0) + 1);
  let cum = 0;
  console.log('  distinct single chars = ' + minLen.size);
  for (const k of [...hist.keys()].sort((a, b) => a - b)) {
    cum += hist.get(k);
    console.log('    shortest code len ' + k + ' = ' + hist.get(k) + '  (cumulative ' + cum + ')');
  }
  process.exit(0);
}

if (mode !== 'build') {
  console.log('usage: shortcut_build.js parse <file> [limit]');
  console.log('       shortcut_build.js find <file> <code> [word]');
  console.log('       shortcut_build.js merge <out.lst> <a.lst> <b.lst> ...');
  console.log('       shortcut_build.js stats <wubi.txt>');
  console.log('       shortcut_build.js build <wubi.txt> <out.lst> [maxRecords] [maxPerCode] [maxWord]');
  process.exit(1);
}

const [, , , src, dst, maxRecStr, maxPerCodeStr, maxWordStr] = process.argv;
const maxRec = maxRecStr ? parseInt(maxRecStr, 10) : Infinity;
const maxPerCode = maxPerCodeStr ? parseInt(maxPerCodeStr, 10) : Infinity;
const maxWord = maxWordStr ? parseInt(maxWordStr, 10) : 8;
// --len=N / --lenMin=N --lenMax=N restrict the trigger length; 4-key-only dictionaries
// are the safe choice because a full Wubi code never collides with a pinyin syllable.
const flag = (k) => { const a = process.argv.find((s) => s.startsWith(k + '=')); return a ? parseInt(a.split('=')[1], 10) : 0; };
const lenEq = flag('--len'), lenMin = lenEq || flag('--lenMin') || 1;
const lenMax = lenEq || flag('--lenMax') || 16;
// --sentCode=X --sentWord=Y put one unmistakable record at the head of the file, so a later
// UI read-back can tell whether the app's restore replaced shortcut.lst or merged into it.
// (Two flags rather than one value because PowerShell treats '|' as a pipe and the harness
//  strips the surrounding quotes.)
const argOf = (k) => { const a = process.argv.find((s) => s.startsWith(k + '=')); return a ? a.slice(k.length + 1) : ''; };
const sentCode = argOf('--sentCode'), sentWord = argOf('--sentWord');
const sentArg = sentCode && sentWord ? sentCode + '|' + sentWord : '';

// data/wubi.txt is "WORD CODE WEIGHT", one entry per line, '#' comments, sorted by weight.
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const chunks = [null];
let total = 4, recs = 0, perCode = new Map(), skipped = 0, dup = new Set();
function pushPair(code, word) {
  const cb = Buffer.alloc(4 + code.length * 2);
  cb.writeUInt32LE(code.length, 0);
  cb.write(code, 4, 'utf16le');
  const wb = Buffer.alloc(4 + word.length * 2);
  wb.writeUInt32LE(word.length, 0);
  wb.write(word, 4, 'utf16le');
  chunks.push(cb, wb);
  total += cb.length + wb.length;
  recs++;
}
if (sentArg) {
  const [sc, sw] = sentArg.split('|');
  pushPair(sc, sw);
  dup.add(sc + '\u0000' + sw);
  perCode.set(sc, 1);
}
for (const ln of lines) {
  if (!ln || ln.charCodeAt(0) === 0xfeff || ln[0] === '#') continue;
  const f = ln.split(/\s+/);
  if (f.length < 2) continue;
  const word = f[0], code = f[1];
  if (recs >= maxRec) break;
  if (!/^[a-z]+$/.test(code) || code.length < lenMin || code.length > lenMax) { skipped++; continue; }
  if (!word.length || word.length > maxWord) { skipped++; continue; }
  const key = code + '\u0000' + word;
  if (dup.has(key)) { skipped++; continue; }
  if (sentArg && code === sentArg.split('|')[0] && word === sentArg.split('|')[1]) { skipped++; continue; }
  const used = perCode.get(code) || 0;
  if (used >= maxPerCode) continue;             // file is weight-sorted, so keep the best
  dup.add(key);
  perCode.set(code, used + 1);
  pushPair(code, word);
}
const out = Buffer.allocUnsafe(total);
out.writeUInt32LE(recs, 0);
let off = 4;
for (let i = 1; i < chunks.length; i++) { chunks[i].copy(out, off); off += chunks[i].length; }
fs.writeFileSync(dst, out);
console.log('wrote ' + dst + '  records=' + recs + '  bytes=' + out.length +
  '  distinctCodes=' + perCode.size + '  skipped=' + skipped);
