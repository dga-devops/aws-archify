/*
 * GIF / PNG / loop tests. Run via test/run.mjs.
 *
 * The encoder is hand-written, so it is checked against an independent
 * decoder written here from the GIF89a spec, not against itself.
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { normalize } from '../skills/aws-archify/lib/spec.mjs';
import { buildHtml } from '../skills/aws-archify/lib/build.mjs';
import { lzwEncode, buildPalette, createGifEncoder } from '../skills/aws-archify/lib/gif.mjs';
import { decodePng } from '../skills/aws-archify/lib/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, '..', 'skills', 'aws-archify', 'examples');
const CLI = join(HERE, '..', 'skills', 'aws-archify', 'bin', 'aws-archify.mjs');

// ---------- an independent GIF reader ----------

function lzwDecode(data, minCodeSize, expected) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = null; dict[eoi] = null;
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let bitPos = 0, prev = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[(bitPos + i) >> 3];
      if (byte === undefined) return -1;
      v |= ((byte >> ((bitPos + i) & 7)) & 1) << i;
    }
    bitPos += codeSize;
    return v;
  };
  for (;;) {
    const code = read();
    if (code < 0) throw new Error('LZW stream ended without an end-of-information code');
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat([prev[0]]);
    else throw new Error(`bad LZW code ${code} (table ${dict.length})`);
    out.push(...entry);
    if (prev && dict.length < 4096) {
      dict.push(prev.concat([entry[0]]));
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  if (expected !== undefined && out.length !== expected) throw new Error(`decoded ${out.length} indices, expected ${expected}`);
  return out;
}

function readGif(buf) {
  const u16 = (o) => buf[o] | (buf[o + 1] << 8);
  if (buf.toString('latin1', 0, 6) !== 'GIF89a') throw new Error('not GIF89a');
  const width = u16(6), height = u16(8), packed = buf[10];
  let off = 13;
  if (packed & 0x80) off += 3 * (1 << ((packed & 7) + 1));
  let loop = null, gce = null;
  const frames = [];
  const subBlocks = () => {
    const parts = [];
    for (;;) {
      const n = buf[off++];
      if (!n) break;
      parts.push(buf.subarray(off, off + n));
      off += n;
    }
    return Buffer.concat(parts);
  };
  while (off < buf.length) {
    const b = buf[off++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[off++];
      if (label === 0xf9) {
        off++; // block size 4
        gce = { disposal: (buf[off] >> 2) & 7, transparent: !!(buf[off] & 1), delay: u16(off + 1), tIndex: buf[off + 3] };
        off += 4;
        off++; // terminator
      } else if (label === 0xff) {
        const n = buf[off++];
        const id = buf.toString('latin1', off, off + n);
        off += n;
        const data = subBlocks();
        if (id === 'NETSCAPE2.0' && data[0] === 1) loop = data[1] | (data[2] << 8);
      } else {
        subBlocks();
      }
    } else if (b === 0x2c) {
      const x = u16(off), y = u16(off + 2), w = u16(off + 4), h = u16(off + 6);
      off += 9;
      const min = buf[off++];
      const data = subBlocks();
      const indices = lzwDecode(data, min, w * h);
      frames.push({ x, y, w, h, indices, ...(gce || {}) });
      gce = null;
    } else {
      throw new Error(`unexpected block 0x${b.toString(16)} at ${off - 1}`);
    }
  }
  return { width, height, loop, frames };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePng(width, height, rgb, filterFor) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const f = filterFor(y);
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = rgb[y * stride + x];
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + x] : 0;
      const c = x >= 3 && y > 0 ? rgb[(y - 1) * stride + x - 3] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function register(t, { ok, eq, throws }) {
  t('lzw: round-trips through an independent decoder, including a full table clear', () => {
    // pseudo-random indices force the table past 4096 entries several times
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 256);
    const cases = [
      Array.from({ length: 1 }, () => 7),
      Array.from({ length: 5000 }, () => 0),
      Array.from({ length: 60000 }, rnd),
      Array.from({ length: 30000 }, (_, i) => (i >> 5) & 255),
    ];
    for (const c of cases) {
      const back = lzwDecode(lzwEncode(Uint8Array.from(c), 8), 8, c.length);
      for (let i = 0; i < c.length; i++) if (back[i] !== c[i]) throw new Error(`mismatch at ${i} of ${c.length}`);
    }
  });

  t('png: decodes every filter type Chrome may emit', () => {
    const w = 23, h = 11;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37 + (i >> 3) * 11) & 255;
    const png = makePng(w, h, rgb, (y) => y % 5);
    const img = decodePng(png);
    eq(img.width, w, 'width'); eq(img.height, h, 'height');
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      if (img.data[j] !== rgb[i] || img.data[j + 1] !== rgb[i + 1] || img.data[j + 2] !== rgb[i + 2] || img.data[j + 3] !== 255) {
        throw new Error(`pixel ${i / 3} wrong`);
      }
    }
  });

  t('gif: frames, loop, holds and deltas are what the reader gets back', () => {
    const W = 40, H = 20;
    const frame = (px) => {
      const f = new Uint8Array(W * H * 4).fill(255);
      for (let y = 5; y < 9; y++) for (let x = px; x < px + 4; x++) {
        const p = (y * W + x) * 4; f[p] = 237; f[p + 1] = 113; f[p + 2] = 0;
      }
      return f;
    };
    const seq = [frame(2), frame(2), frame(2), frame(10), frame(20), frame(20)];
    const pal = buildPalette(seq);
    const enc = createGifEncoder({ width: W, height: H, palette: pal });
    seq.forEach((f) => enc.add(f, 5));
    const g = readGif(enc.finish());
    eq(g.width, W, 'width'); eq(g.height, H, 'height');
    eq(g.loop, 0, 'loops forever');
    eq(g.frames.length, 3, 'identical frames collapse into holds');
    eq(g.frames[0].delay, 15, 'first frame holds for three frames');
    eq(g.frames[2].delay, 10, 'last frame holds for two');
    ok(!g.frames[0].transparent && g.frames[0].w === W && g.frames[0].h === H, 'first frame is full and opaque');
    ok(g.frames[1].transparent && g.frames[1].w < W, 'later frames store only the changed rectangle');
    ok(g.frames.every((f) => f.disposal === 1), 'disposal: leave in place');
  });

  t('spec: loop timing is validated', () => {
    const base = JSON.parse(readFileSync(join(EX, 'starter.json'), 'utf8'));
    throws(() => normalize({ ...base, loop: { fps: 120 } }), 'loop.fps', 'fps out of range');
    throws(() => normalize({ ...base, loop: { travel: -5 } }), 'loop.travel', 'negative travel');
    throws(() => normalize({ ...base, loop: [1, 2] }), 'loop: must be an object', 'loop as array');
    ok(normalize({ ...base, loop: { travel: 900, hold: 800, fps: 15 } }).loop.fps === 15, 'valid loop kept');
  });

  t('build: the loop layer is added only when asked for', () => {
    const s = normalize(JSON.parse(readFileSync(join(EX, 'web-app.json'), 'utf8')));
    ok(!buildHtml(s, 'static').includes('window.__LOOP__'), 'static page has no loop');
    ok(!buildHtml(s, 'live').includes('window.__LOOP__'), 'live viewer has no loop');
    const html = buildHtml(s, 'static', { loop: { autoplay: false } });
    ok(html.includes('window.__LOOP__'), 'loop runtime embedded');
    ok(/"loop":\{[^}]*"autoplay":false/.test(html), 'capture turns autoplay off');
  });

  t('cli: gif writes a looping GIF whose first frame is the still diagram', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    const out = join(dir, 'starter.gif');
    execFileSync(process.execPath, [CLI, 'gif', join(EX, 'starter.json'), out, '--width=480', '--fps=10'], { stdio: 'pipe', timeout: 120000 });
    const g = readGif(readFileSync(out));
    eq(`${g.width}x${g.height}`, '480x270', 'output size');
    eq(g.loop, 0, 'loops forever');
    ok(g.frames.length > 3, `several stored frames (${g.frames.length})`);
    ok(g.frames[0].delay >= 110, `first frame holds on the still diagram (${g.frames[0].delay}cs)`);
    ok(!g.frames[0].transparent, 'first frame is a complete picture');
    ok(g.frames.slice(1).every((f) => f.transparent), 'the rest are deltas');
    const total = g.frames.reduce((s, f) => s + f.delay, 0);
    ok(total > 250 && total < 1000, `loop length is sane (${total}cs)`);
  });
}
