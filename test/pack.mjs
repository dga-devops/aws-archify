/*
 * Packaging tests. Run via test/run.mjs.
 *
 * `npx skills add` copies files and checks nothing; Claude's skill upload
 * validates. These keep the repository uploadable after every change —
 * in particular after the AWS icon set is refreshed.
 */
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, crc32 } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', 'skills', 'aws-archify');
const CLI = join(SKILL, 'bin', 'aws-archify.mjs');
const SAFE = /^[A-Za-z0-9._\-/]+$/;

function walk(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (/^(\.out|node_modules)$/.test(e.name)) continue;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

/** Read a ZIP through its central directory, inflating and CRC-checking every entry. */
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header ${i}`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26), lxlen = buf.readUInt16LE(lho + 28);
    const body = buf.subarray(lho + 30 + lnlen + lxlen, lho + 30 + lnlen + lxlen + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    if (data.length !== usize) throw new Error(`${name}: size ${data.length} != ${usize}`);
    if ((crc32(data) >>> 0) !== crc) throw new Error(`${name}: CRC mismatch`);
    entries.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

export function register(t, { ok, eq }) {
  t('pack: every shipped path is one the upload accepts', () => {
    const bad = walk(SKILL).filter((f) => !SAFE.test(f));
    ok(!bad.length, `paths the upload rejects (spaces, &, …): ${bad.join(', ')}`);
  });

  t('pack: the icon index points at files that exist', () => {
    const idx = JSON.parse(readFileSync(join(SKILL, 'aws-icons', 'index.json'), 'utf8'));
    const files = new Set(walk(join(SKILL, 'aws-icons')).map((f) => 'aws-icons/' + f));
    const missing = idx.icons.filter((i) => !files.has(i.path)).map((i) => i.path);
    ok(!missing.length, `index.json paths with no file: ${missing.slice(0, 5).join(', ')}`);
  });

  t('pack: builds an uploadable ZIP from the same files npx installs', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'aws-archify-test-')), 'aws-archify.zip');
    execFileSync(process.execPath, [CLI, 'pack', out], { stdio: 'pipe' });
    const zip = readZip(readFileSync(out));
    const names = [...zip.keys()];

    ok(names.length <= 200, `the upload accepts at most 200 entries (got ${names.length})`);
    ok([...zip.values()].every((d) => d.length <= 30 * 1024 * 1024), 'no file over the 30 MB limit');
    ok(names.every((n) => n.startsWith('aws-archify/')), 'one root folder, named after the skill');
    ok(names.every((n) => SAFE.test(n)), 'no rejected characters in any entry');
    ok(zip.has('aws-archify/SKILL.md'), 'SKILL.md at the root of the skill folder');
    ok(!names.some((n) => /\/test\/|README\.md$|package\.json$|\.out\/|\.candidate\./.test(n)), 'no repository or build clutter');
    ok(!names.some((n) => n.endsWith('.svg')), 'icons travel in the bundle, not as loose files');

    const md = zip.get('aws-archify/SKILL.md').toString('utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(md)[1];
    const keys = [...fm.matchAll(/^([A-Za-z][\w-]*):/gm)].map((m) => m[1]);
    const allowed = new Set(['name', 'description', 'license', 'allowed-tools', 'compatibility', 'metadata']);
    ok(keys.every((k) => allowed.has(k)), `only accepted frontmatter keys (got ${keys.join(', ')})`);
    ok(keys.includes('compatibility'), 'says what it needs to run');
    ok(md.includes('## Invoked as a command'), 'the body is carried over intact');

    // the repository copy keeps what Claude Code uses
    ok(readFileSync(join(SKILL, 'SKILL.md'), 'utf8').includes('argument-hint:'), 'source SKILL.md still has argument-hint');

    // every file on disk made it in intact: icons as exact text in the bundle,
    // everything else byte for byte (SKILL.md aside, and the plain file list)
    const bundle = JSON.parse(zip.get('aws-archify/aws-icons/bundle.json').toString('utf8'));
    let icons = 0;
    for (const f of walk(SKILL)) {
      if (f === 'SKILL.md' || f === 'aws-icons/_filelist.txt') continue;
      if (/^aws-icons\/.+\.svg$/.test(f)) {
        icons++;
        ok(bundle.files[f] === readFileSync(join(SKILL, f), 'utf8'), `${f} carried exactly in the bundle`);
        continue;
      }
      const got = zip.get('aws-archify/' + f);
      ok(got && got.equals(readFileSync(join(SKILL, f))), `${f} packed intact`);
    }
    eq(Object.keys(bundle.files).length, icons, 'the bundle holds every icon and nothing else');
    eq(bundle.count, icons, 'bundle count');
  });

  t('pack: the unpacked skill builds the same diagram as the repository', () => {
    // Extract the upload ZIP and build from it. With no loose SVGs present it
    // must resolve every icon from bundle.json and produce identical HTML.
    const dir = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    const out = join(dir, 'aws-archify.zip');
    execFileSync(process.execPath, [CLI, 'pack', out], { stdio: 'pipe' });
    for (const [name, data] of readZip(readFileSync(out))) {
      if (name.endsWith('/')) continue;
      const p = join(dir, 'x', name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, data);
    }
    const packed = join(dir, 'x', 'aws-archify');
    for (const ex of ['web-app.json', 'analytics-pipeline.json']) {
      const a = join(dir, 'from-repo.html'), b = join(dir, 'from-pack.html');
      execFileSync(process.execPath, [CLI, 'build', join(SKILL, 'examples', ex), a], { stdio: 'pipe' });
      execFileSync(process.execPath, [join(packed, 'bin', 'aws-archify.mjs'), 'build', join(packed, 'examples', ex), b], { stdio: 'pipe' });
      ok(readFileSync(a).equals(readFileSync(b)), `${ex}: identical HTML from the packed skill`);
    }
  });

  t('pack: the same tree always produces the same bytes', () => {
    const d = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    execFileSync(process.execPath, [CLI, 'pack', join(d, 'a.zip')], { stdio: 'pipe' });
    execFileSync(process.execPath, [CLI, 'pack', join(d, 'b.zip')], { stdio: 'pipe' });
    ok(readFileSync(join(d, 'a.zip')).equals(readFileSync(join(d, 'b.zip'))), 'deterministic');
  });
}
