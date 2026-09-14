/*
 * png.mjs — decode the PNGs Chrome hands back, into RGBA.
 *
 * Only what a headless screenshot produces: 8-bit, non-interlaced, grey /
 * grey+alpha / RGB / RGBA. Enough to feed the GIF encoder without a
 * dependency; not a general-purpose PNG library.
 */
import { inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('not a PNG');
  }
  let off = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === 'IDAT') {
      idat.push(data);
    } else if (kind === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!ch) throw new Error(`unsupported PNG colour type ${type}`);
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth}`);
  if (interlace) throw new Error('interlaced PNG is not supported');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let p = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    // one loop per filter type: the switch stays out of the per-byte path
    if (filter === 0) {
      for (let x = 0; x < stride; x++) cur[x] = raw[p++];
    } else if (filter === 1) {
      for (let x = 0; x < stride; x++) cur[x] = (raw[p++] + (x >= ch ? cur[x - ch] : 0)) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) cur[x] = (raw[p++] + prev[x]) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) cur[x] = (raw[p++] + (((x >= ch ? cur[x - ch] : 0) + prev[x]) >> 1)) & 255;
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        cur[x] = (raw[p++] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    } else {
      throw new Error(`bad PNG filter ${filter} on row ${y}`);
    }

    let o = y * width * 4;
    if (ch === 4) {
      out.set(cur, o);
    } else if (ch === 3) {
      for (let i = 0; i < stride; i += 3, o += 4) {
        out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = 255;
      }
    } else if (ch === 2) {
      for (let i = 0; i < stride; i += 2, o += 4) {
        out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = cur[i + 1];
      }
    } else {
      for (let i = 0; i < stride; i++, o += 4) {
        out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = 255;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, data: out };
}
