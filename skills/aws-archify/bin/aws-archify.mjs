#!/usr/bin/env node
/*
 * aws-archify — AWS Reference Architecture diagrams from a JSON spec.
 *
 *   validate <spec.json>              contract + geometry, no files written
 *   build    <spec.json> [out.html]   static HTML (what the PNG is captured from)
 *   live     <spec.json> [out.html]   interactive HTML (trace, focus, route, theme)
 *   render   <spec.json> [out.png]    validate, then capture the PNG
 *   deliver  <spec.json> [outdir]     render + live, the pair you ship
 *   icons    <query>                  search the bundled AWS icon set
 *   init     [out.json]               a working starter spec
 *   doctor                            check this machine can render
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { normalize, SpecError } from '../lib/spec.mjs';
import { buildHtml } from '../lib/build.mjs';
import { screenshot, verdict, findBrowser } from '../lib/render.mjs';
import { searchIcons } from '../lib/icons.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = '2.0.0';

// ---------- tiny arg parser ----------
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v === undefined ? true : v;
  } else positional.push(a);
}
const cmd = positional.shift();

const C = process.stdout.isTTY && !flags['no-color'];
const c = {
  dim: (s) => (C ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s) => (C ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (C ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (C ? `\x1b[33m${s}\x1b[0m` : s),
  bold: (s) => (C ? `\x1b[1m${s}\x1b[0m` : s),
};

function die(msg, code = 1) {
  console.error(c.red('error: ') + msg);
  process.exit(code);
}

function loadSpec(p) {
  if (!p) die('missing <spec.json>\n\n' + usage());
  const file = resolve(p);
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    die(`cannot read ${p}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    die(`${basename(file)} is not valid JSON — ${e.message}`);
  }
  try {
    return { spec: normalize(json, { file: basename(file) }), file };
  } catch (e) {
    if (e instanceof SpecError) die(e.message);
    throw e;
  }
}

function outPath(given, specFile, ext, dir) {
  if (given) return resolve(given);
  const base = basename(specFile, extname(specFile));
  return resolve(dir || dirname(specFile), base + ext);
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return path;
}

function rel(p) {
  const r = p.replace(process.cwd() + (process.platform === 'win32' ? '\\' : '/'), '');
  return r || p;
}

/** Build to a throwaway file and ask the browser for the geometry verdict. */
async function checkGeometry(spec) {
  const tmp = join(tmpdir(), `aws-archify-${process.pid}-${Date.now()}.html`);
  write(tmp, buildHtml(spec, 'static'));
  try {
    return await verdict(tmp);
  } finally {
    try { rmSync(tmp); } catch {}
  }
}

function reportVerdict(v) {
  if (v.ok) {
    console.log(c.green('  geometry  PASS'));
    return true;
  }
  console.log(c.red(`  geometry  ${v.status}`));
  for (const i of v.issues) console.log('            - ' + i);
  if (!v.issues.length) console.log('            (no detail captured — open the HTML and read the console)');
  return false;
}

function usage() {
  return `${c.bold('aws-archify')} ${c.dim('v' + PKG)} — AWS Reference Architecture diagrams from JSON

  ${c.bold('validate')} <spec.json>            contract + geometry, writes nothing
  ${c.bold('build')}    <spec.json> [out.html] static HTML (source of the PNG)
  ${c.bold('live')}     <spec.json> [out.html] interactive HTML (trace, focus, route, theme)
  ${c.bold('render')}   <spec.json> [out.png]  validate, then capture the PNG
  ${c.bold('deliver')}  <spec.json> [outdir]   render + live: the pair you ship
  ${c.bold('icons')}    <query>                search the 862 bundled AWS icons
  ${c.bold('init')}     [out.json]             a working starter spec
  ${c.bold('doctor')}                          check this machine can render

  ${c.dim('--scale=N')}     PNG scale factor (default 1; use 2 for 4K)
  ${c.dim('--dark')}        open the live viewer in dark theme
  ${c.dim('--force')}       write the PNG even when validation fails
  ${c.dim('--json')}        machine-readable output
`;
}

// ---------- commands ----------

async function cmdValidate() {
  const { spec, file } = loadSpec(positional[0]);
  console.log(c.bold(basename(file)));
  console.log(c.green('  contract  PASS') + c.dim(`  (${spec.nodes.length} nodes, ${spec.arrows.length} arrows, ${spec.steps.length} steps)`));
  const v = await checkGeometry(spec);
  const ok = reportVerdict(v);
  if (flags.json) console.log(JSON.stringify({ ok, contract: 'PASS', geometry: v }, null, 2));
  process.exit(ok ? 0 : 2);
}

async function cmdBuild(mode) {
  const { spec, file } = loadSpec(positional[0]);
  if (flags.dark) spec.motion.theme = 'dark';
  const out = outPath(positional[1], file, mode === 'live' ? '.live.html' : '.html');
  let html = buildHtml(spec, mode);
  if (mode === 'live' && flags.dark) html = html.replace('<html lang="en">', '<html lang="en" data-theme="dark">');
  write(out, html);
  console.log(c.green('wrote ') + rel(out) + c.dim(`  (${(html.length / 1024).toFixed(0)} KB, self-contained)`));
}

async function cmdRender() {
  const { spec, file } = loadSpec(positional[0]);
  const png = outPath(positional[1], file, '.png');
  const htmlTmp = join(tmpdir(), `aws-archify-${process.pid}.html`);
  write(htmlTmp, buildHtml(spec, 'static'));

  console.log(c.bold(basename(file)));
  console.log(c.green('  contract  PASS'));
  const v = await verdict(htmlTmp);
  const ok = reportVerdict(v);

  if (!ok && !flags.force) {
    try { rmSync(htmlTmp); } catch {}
    console.error(
      '\n' + c.yellow('not rendered.') + ' Fix the geometry above, or pass --force to capture it anyway\n' +
      '(the PNG will carry a red banner listing every issue).'
    );
    process.exit(2);
  }

  const scale = Number(flags.scale || 1);
  await screenshot(htmlTmp, png, { width: spec.canvas.width, height: spec.canvas.height, scale });
  try { rmSync(htmlTmp); } catch {}
  console.log(
    c.green('  wrote     ') + rel(png) +
    c.dim(`  (${spec.canvas.width * scale}x${spec.canvas.height * scale})`)
  );
  process.exit(ok ? 0 : 2);
}

async function cmdDeliver() {
  const { spec, file } = loadSpec(positional[0]);
  const dir = positional[1] ? resolve(positional[1]) : dirname(file);
  const base = basename(file, extname(file));
  const png = join(dir, base + '.png');
  const liveOut = join(dir, base + '.live.html');
  const htmlTmp = join(tmpdir(), `aws-archify-${process.pid}.html`);

  console.log(c.bold(basename(file)));
  console.log(c.green('  contract  PASS'));
  write(htmlTmp, buildHtml(spec, 'static'));
  const v = await verdict(htmlTmp);
  const ok = reportVerdict(v);
  if (!ok && !flags.force) {
    try { rmSync(htmlTmp); } catch {}
    console.error('\n' + c.yellow('nothing delivered.') + ' Fix the geometry above, or pass --force.');
    process.exit(2);
  }

  const scale = Number(flags.scale || 1);
  await screenshot(htmlTmp, png, { width: spec.canvas.width, height: spec.canvas.height, scale });
  try { rmSync(htmlTmp); } catch {}
  const liveHtml = buildHtml(spec, 'live');
  write(liveOut, liveHtml);

  console.log(c.green('  wrote     ') + rel(png) + c.dim(`  (${spec.canvas.width * scale}x${spec.canvas.height * scale}, for docs and slides)`));
  console.log(c.green('  wrote     ') + rel(liveOut) + c.dim(`  (${(liveHtml.length / 1024).toFixed(0)} KB, share this to explore it)`));
  process.exit(ok ? 0 : 2);
}

function cmdIcons() {
  const q = positional.join(' ');
  if (!q) die('usage: aws-archify icons <query>');
  const hits = searchIcons(q, Number(flags.limit || 20));
  if (!hits.length) return console.log(c.yellow(`no icon matches "${q}"`));
  if (flags.json) return console.log(JSON.stringify(hits, null, 2));
  for (const h of hits) {
    console.log(`  ${c.dim(h.type.padEnd(8))} ${h.name}`);
    console.log(`  ${' '.repeat(8)} ${c.dim(h.path)}`);
  }
  console.log(c.dim(`\n  use the name in "icon", e.g.  "icon": "${hits[0].name}"`));
}

function cmdInit() {
  const out = resolve(positional[0] || 'diagram.json');
  const starter = readFileSync(join(HERE, '..', 'examples', 'starter.json'), 'utf8');
  write(out, starter);
  console.log(c.green('wrote ') + rel(out));
  console.log(c.dim(`\n  next:  node ${rel(join(HERE, 'aws-archify.mjs'))} deliver ${rel(out)}`));
}

async function cmdDoctor() {
  let ok = true;
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 18;
  console.log(`  node        ${nodeOk ? c.green(process.version) : c.red(process.version + ' — need >= 18')}`);
  ok = ok && nodeOk;
  try {
    const b = findBrowser();
    console.log(`  browser     ${c.green(b)}`);
  } catch (e) {
    console.log(`  browser     ${c.red(e.message)}`);
    ok = false;
  }
  try {
    const { spec } = { spec: normalize(JSON.parse(readFileSync(join(HERE, '..', 'examples', 'starter.json'), 'utf8'))) };
    const v = await checkGeometry(spec);
    console.log(`  round-trip  ${v.ok ? c.green('PASS') : c.red(v.status)}`);
    ok = ok && v.ok;
  } catch (e) {
    console.log(`  round-trip  ${c.red(e.message.split('\n')[0])}`);
    ok = false;
  }
  process.exit(ok ? 0 : 1);
}

// ---------- dispatch ----------
const table = {
  validate: cmdValidate,
  build: () => cmdBuild('static'),
  live: () => cmdBuild('live'),
  render: cmdRender,
  deliver: cmdDeliver,
  icons: cmdIcons,
  init: cmdInit,
  doctor: cmdDoctor,
};

if (!cmd || flags.help || cmd === 'help') {
  console.log(usage());
  process.exit(cmd ? 0 : 1);
}
if (!table[cmd]) die(`unknown command "${cmd}"\n\n${usage()}`);

try {
  await table[cmd]();
} catch (e) {
  die(e.message);
}
