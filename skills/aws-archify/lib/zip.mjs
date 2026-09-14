/*
 * zip.mjs — write a plain ZIP archive, no dependencies.
 *
 * Just enough for packaging the skill: stored or deflated entries, ASCII
 * names, one fixed timestamp so the same tree always produces the same bytes.
 */
import { crc32, deflateRawSync } from 'node:zlib';

// 2026-01-01 00:00:00 in MS-DOS date/time: deterministic output
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * @param {{ name: string, data?: Buffer }[]} entries  directories end with "/"
 * @returns {Buffer}
 */
export function createZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'latin1');
    const isDir = e.name.endsWith('/');
    const raw = isDir ? Buffer.alloc(0) : e.data;
    const crc = isDir ? 0 : crc32(raw) >>> 0;
    let method = 0, body = raw;
    if (!isDir && raw.length) {
      const deflated = deflateRawSync(raw, { level: 9 });
      if (deflated.length < raw.length) { method = 8; body = deflated; }
    }

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0, 6);             // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);            // extra length
    local.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);            // version made by
    ch.writeUInt16LE(20, 6);            // version needed
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);            // extra
    ch.writeUInt16LE(0, 32);            // comment
    ch.writeUInt16LE(0, 34);            // disk
    ch.writeUInt16LE(0, 36);            // internal attributes
    ch.writeUInt32LE(isDir ? 0x10 : 0, 38); // external: MS-DOS directory bit
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + body.length;
  }

  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...local, ...central, end]);
}
