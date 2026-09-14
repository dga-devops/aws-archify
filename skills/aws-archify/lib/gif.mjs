/*
 * gif.mjs — an animated GIF89a encoder with no dependencies.
 *
 * Built for one kind of input: a diagram that is almost entirely still, with
 * a few small things moving across it. Three choices follow from that.
 *
 *  Palette   One global palette for every frame, so nothing shifts colour
 *            between frames. The most frequent colours — white, the panel
 *            grey, the ink — are pinned exactly; the rest (icon colours,
 *            anti-aliasing, the moving packets) come from median cut over the
 *            sampled frames. No dithering: it would scatter noise across flat
 *            areas and defeat the next point.
 *
 *  Deltas    After the first frame, only the rectangle that changed is
 *            stored, and inside it every pixel identical to the previous frame
 *            is transparent. A still diagram costs its bytes once.
 *
 *  Holds     A frame identical to the one before is not written; its time is
 *            added to the previous frame's delay.
 */

const TRANSPARENT = 0; // palette slot 0 is reserved for "unchanged"

// ---------- palette ----------

/**
 * @param {Uint8Array[]} samples RGBA frames that together contain every colour worth keeping
 * @param {{ colors?: number, pin?: number }} opts
 * @returns {Uint8Array} 256*3 RGB, slot 0 reserved
 */
export function buildPalette(samples, { colors = 255, pin = 24 } = {}) {
  const counts = new Map();
  let total = 0;
  for (const f of samples) {
    for (let i = 0; i < f.length; i += 4) {
      const k = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
      total++;
    }
  }
  const all = [];
  for (const [k, c] of counts) all.push({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255, c });
  all.sort((a, b) => b.c - a.c);

  // Large flat areas must come out exactly: a white that drifts to 254,254,254
  // is visible against the page it sits on.
  const pinned = [];
  while (pinned.length < pin && pinned.length < all.length && all[pinned.length].c >= total * 0.0005) {
    pinned.push(all[pinned.length]);
  }
  const rest = all.slice(pinned.length);

  const budget = Math.max(1, colors - pinned.length);
  const boxes = rest.length ? [box(rest)] : [];
  while (boxes.length < budget) {
    let bi = -1, best = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].items.length > 1 && boxes[i].score > best) { best = boxes[i].score; bi = i; }
    }
    if (bi < 0) break;
    const b = boxes[bi];
    const ch = b.channel;
    b.items.sort((x, y) => x[ch] - y[ch]);
    const half = b.weight / 2;
    let acc = 0, cut = 1;
    for (let i = 0; i < b.items.length; i++) {
      acc += b.items[i].c;
      if (acc >= half) { cut = Math.min(b.items.length - 1, Math.max(1, i)); break; }
    }
    boxes.splice(bi, 1, box(b.items.slice(0, cut)), box(b.items.slice(cut)));
  }

  const pal = new Uint8Array(256 * 3);
  let n = 1;
  for (const p of pinned) { pal[n * 3] = p.r; pal[n * 3 + 1] = p.g; pal[n * 3 + 2] = p.b; n++; }
  for (const b of boxes) {
    if (n > 255) break;
    let r = 0, g = 0, bl = 0;
    for (const it of b.items) { r += it.r * it.c; g += it.g * it.c; bl += it.b * it.c; }
    pal[n * 3] = Math.round(r / b.weight); pal[n * 3 + 1] = Math.round(g / b.weight); pal[n * 3 + 2] = Math.round(bl / b.weight);
    n++;
  }
  pal.used = n; // slots 1..n-1 hold colours
  return pal;
}

function box(items) {
  let w = 0, sr = 0, sg = 0, sb = 0;
  for (const it of items) { w += it.c; sr += it.r * it.c; sg += it.g * it.c; sb += it.b * it.c; }
  const mr = sr / w, mg = sg / w, mb = sb / w;
  let vr = 0, vg = 0, vb = 0;
  for (const it of items) {
    vr += it.c * (it.r - mr) ** 2; vg += it.c * (it.g - mg) ** 2; vb += it.c * (it.b - mb) ** 2;
  }
  const channel = vr >= vg && vr >= vb ? 'r' : vg >= vb ? 'g' : 'b';
  return { items, weight: w, score: vr + vg + vb, channel };
}

/** Nearest palette slot for an RGB colour, memoised: a diagram repeats itself. */
export function makeMapper(pal) {
  const n = pal.used || 256;
  const cache = new Map();
  return function (r, g, b) {
    const k = (r << 16) | (g << 8) | b;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    let best = 1, bd = Infinity;
    for (let i = 1; i < n; i++) {
      const dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2];
      // weighted towards green, where the eye is most sensitive
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) { bd = d; best = i; if (d === 0) break; }
    }
    cache.set(k, best);
    return best;
  };
}

// ---------- LZW ----------

export function lzwEncode(indices, minCodeSize = 8) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let table = new Map();
  const out = [];
  let acc = 0, bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; }
  };

  emit(clear);
  if (!indices.length) { emit(eoi); if (bits) out.push(acc & 255); return Uint8Array.from(out); }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

// ---------- encoder ----------

/**
 * Streaming encoder: add frames as they are captured, keep only the previous
 * frame's pixels, and hold the compressed output until finish().
 */
export function createGifEncoder({ width, height, palette, loop = 0 }) {
  const map = makeMapper(palette);
  const frames = [];
  let prev = null;

  function add(rgba, delayCs) {
    if (!prev) {
      const idx = new Uint8Array(width * height);
      for (let i = 0, p = 0; i < idx.length; i++, p += 4) idx[i] = map(rgba[p], rgba[p + 1], rgba[p + 2]);
      frames.push({ x: 0, y: 0, w: width, h: height, lzw: lzwEncode(idx), delay: delayCs, transparent: false });
      prev = rgba.slice();
      return;
    }

    // dirty rectangle, by comparing whole pixels
    const a = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
    const b = new Uint32Array(prev.buffer, prev.byteOffset, width * height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (a[row + x] !== b[row + x]) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { frames[frames.length - 1].delay += delayCs; return; }

    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * width + (x0 + x);
        if (a[i] === b[i]) { idx[y * w + x] = TRANSPARENT; continue; }
        const p = i * 4;
        idx[y * w + x] = map(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
    }
    frames.push({ x: x0, y: y0, w, h, lzw: lzwEncode(idx), delay: delayCs, transparent: true });
    prev.set(rgba);
  }

  function finish() {
    const parts = [];
    const u16 = (v) => [v & 255, (v >> 8) & 255];
    parts.push(Buffer.from('GIF89a', 'latin1'));
    // logical screen: global colour table present, 8 bits/channel, 256 entries
    parts.push(Uint8Array.from([...u16(width), ...u16(height), 0xf7, 0, 0]));
    parts.push(palette.subarray(0, 256 * 3));
    // NETSCAPE2.0: repeat forever (or `loop` times)
    parts.push(Uint8Array.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, ...u16(loop), 0x00]));

    for (const f of frames) {
      const delay = Math.max(2, Math.min(65535, Math.round(f.delay)));
      // graphic control: disposal 1 (leave in place), optional transparency
      parts.push(Uint8Array.from([0x21, 0xf9, 0x04, (1 << 2) | (f.transparent ? 1 : 0), ...u16(delay), TRANSPARENT, 0x00]));
      parts.push(Uint8Array.from([0x2c, ...u16(f.x), ...u16(f.y), ...u16(f.w), ...u16(f.h), 0x00]));
      parts.push(Uint8Array.from([8]));
      for (let i = 0; i < f.lzw.length; i += 255) {
        const chunk = f.lzw.subarray(i, i + 255);
        parts.push(Uint8Array.from([chunk.length]));
        parts.push(chunk);
      }
      parts.push(Uint8Array.from([0x00]));
    }
    parts.push(Uint8Array.from([0x3b]));
    return Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength)));
  }

  return {
    add,
    finish,
    get frameCount() { return frames.length; },
    get durationCs() { return frames.reduce((s, f) => s + Math.max(2, Math.round(f.delay)), 0); },
  };
}
