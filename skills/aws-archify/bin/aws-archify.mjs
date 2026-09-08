#!/usr/bin/env node
/*
 * aws-archify — AWS Reference Architecture diagrams from a JSON spec.
 *
 *   validate <spec.json>              contract + geometry, no files written
 *   build    <spec.json> [out.html]   static HTML (what the PNG is captured from)
 *   live     <spec.json> [out.html]   interactive HTML (trace, focus, route, theme)
 *   render   <spec.json> [out.png]    validate, then capture the PNG
 *   deliver  <spec.json> [outdir]     render + live + receipt, what you ship
 *   diff     <before> <after> [dir]   one picture of what changed between two specs
 *   icons    <query>                  search the bundled AWS icon set
 *   init     [out.json]               a working starter spec
 *   doctor                            check this machine can render
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { normalize, SpecError } from '../lib/spec.mjs';
import { buildHtml } from '../lib/build.mjs';
import { screenshot, verdict, findBrowser } from '../lib/render.mjs';
import { searchIcons } from '../lib/icons.mjs';
import { compareSpecs } from '../lib/diff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = '2.1.0';

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

/**
 * Where to write. `given` may be a file path or a directory — a trailing
 * separator, or a path that already exists as one. Passing a directory used to
 * hand Chrome a directory as its --screenshot target, which fails silently and
 * still looked like a success.
 */
function outPath(given, specFile, ext, dir) {
  const base = basename(specFile, extname(specFile)) + ext;
  if (!given) return resolve(dir || dirname(specFile), base);

  const looksLikeDir =
    /[\\/]$/.test(given) || (existsSync(given) && statSync(given).isDirectory());
  return looksLikeDir ? resolve(given, base) : resolve(given);
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

// ---------- atomic delivery ----------
// An artefact is either the previous good one or the new verified one, never a
// half-written file. Everything is produced under a private name beside the
// target and renamed into place only once it exists and is non-empty.
function candidatePath(target) {
  // The real extension stays last: Chrome decides the screenshot format from
  // it and silently writes nothing to a path that does not end in .png.
  const ext = extname(target);
  return join(dirname(target), `.${basename(target, ext)}.${process.pid}.candidate${ext}`);
}

function commit(candidate, target) {
  const st = existsSync(candidate) && statSync(candidate);
  if (!st || !st.isFile() || st.size === 0) {
    try { rmSync(candidate); } catch {}
    throw new Error(`nothing to commit at ${rel(target)} — the candidate was not written`);
  }
  mkdirSync(dirname(target), { recursive: true });
  renameSync(candidate, target);
  return target;
}

function discard(candidate) {
  try { rmSync(candidate); } catch {}
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileRecord(path) {
  return { path: rel(path), bytes: statSync(path).size, sha256: sha256(path) };
}

/**
 * The receipt binds one spec to the artefacts built from it, by hash. In a
 * docs repository that is the answer to "which JSON produced this PNG", and to
 * "has this PNG been touched since". It records the geometry verdict too, but
 * that is a deterministic claim only — it says nothing about whether a human
 * looked at the picture.
 */
function writeReceipt(path, { specFile, artifacts, verdict: v, scale, mode }) {
  const receipt = {
    tool: 'aws-archify',
    version: PKG,
    generatedAt: new Date().toISOString(),
    mode,
    spec: fileRecord(specFile),
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([k, p]) => [k, { ...fileRecord(p), ...(k === 'png' ? { scale } : {}) }])),
    validation: {
      status: v.status,
      errors: v.errors || [],
      warnings: v.warnings || [],
    },
    // Three separate claims, never conflated: this receipt proves the first.
    claims: {
      deterministic: v.ok ? 'passed' : 'failed',
      browserEvidence: 'not collected',
      visualReview: 'pending',
    },
  };
  write(path, JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
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

/** One fix as a line the author can act on without reading the spec reference. */
function fixLine(f) {
  if (f.set) {
    const kv = Object.entries(f.set).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
    return `set ${kv} on ${f.on}` + (f.why ? c.dim(`  — ${f.why}`) : '');
  }
  if (f.nudgeAnchor) return `${f.why}`;
  if (f.moveLeftBy !== undefined) return `move left by ${f.moveLeftBy}px` + (f.why ? c.dim(`  — ${f.why}`) : '');
  if (f.shorten) return `shorten ${f.shorten}` + (f.why ? c.dim(`  — ${f.why}`) : '');
  if (f.move) return `move ${f.move}` + (f.why ? c.dim(`  — ${f.why}`) : '');
  return f.why || JSON.stringify(f);
}

function printDiagnostics(list, color) {
  for (const d of list) {
    console.log(`            ${color(d.code.padEnd(20))} ${d.message}`);
    for (const f of d.fixes || []) console.log(`            ${' '.repeat(20)} ${c.dim('→')} ${fixLine(f)}`);
  }
}

function reportVerdict(v) {
  if (v.ok) {
    const w = v.warnings?.length || 0;
    console.log(c.green('  geometry  PASS') + (w ? c.dim(`  (${w} warning${w === 1 ? '' : 's'})`) : ''));
    if (w) printDiagnostics(v.warnings, c.yellow);
    return true;
  }
  console.log(c.red(`  geometry  ${v.status}`));
  if (v.errors?.length) printDiagnostics(v.errors, c.red);
  else for (const i of v.issues) console.log('            - ' + i);
  if (v.warnings?.length) printDiagnostics(v.warnings, c.yellow);
  return false;
}

function usage() {
  return `${c.bold('aws-archify')} ${c.dim('v' + PKG)} — AWS Reference Architecture diagrams from JSON

  ${c.bold('validate')} <spec.json>            contract + geometry, writes nothing
  ${c.bold('build')}    <spec.json> [out.html] static HTML (source of the PNG)
  ${c.bold('live')}     <spec.json> [out.html] interactive HTML (trace, focus, route, theme)
  ${c.bold('render')}   <spec.json> [out.png]  validate, then capture the PNG
  ${c.bold('deliver')}  <spec.json> [outdir]   render + live + receipt: what you ship
  ${c.bold('diff')}     <before> <after> [dir]  one picture of what changed between two specs
  ${c.bold('icons')}    <query>                search the 862 bundled AWS icons
  ${c.bold('init')}     [out.json]             a working starter spec
  ${c.bold('doctor')}                          check this machine can render

  ${c.dim('--scale=N')}     PNG scale factor (default 1; use 2 for 4K)
  ${c.dim('--dark')}        open the live viewer in dark theme
  ${c.dim('--force')}       write the PNG even when validation fails
  ${c.dim('--no-receipt')}  skip the receipt.json that deliver writes beside its outputs
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
  const cand = candidatePath(png);
  try {
    await screenshot(htmlTmp, cand, { width: spec.canvas.width, height: spec.canvas.height, scale });
    commit(cand, png);
  } catch (e) {
    discard(cand);
    throw e;
  } finally {
    try { rmSync(htmlTmp); } catch {}
  }
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
  const liveHtml = buildHtml(spec, 'live');
  const candPng = candidatePath(png), candLive = candidatePath(liveOut);
  try {
    await screenshot(htmlTmp, candPng, { width: spec.canvas.width, height: spec.canvas.height, scale });
    write(candLive, liveHtml);
    // Both or neither: the PNG is committed first, and if the HTML then fails
    // to commit the PNG is already a complete, verified artefact on its own.
    commit(candPng, png);
    commit(candLive, liveOut);
  } catch (e) {
    discard(candPng);
    discard(candLive);
    throw e;
  } finally {
    try { rmSync(htmlTmp); } catch {}
  }

  console.log(c.green('  wrote     ') + rel(png) + c.dim(`  (${spec.canvas.width * scale}x${spec.canvas.height * scale}, for docs and slides)`));
  console.log(c.green('  wrote     ') + rel(liveOut) + c.dim(`  (${(liveHtml.length / 1024).toFixed(0)} KB, share this to explore it)`));

  if (!flags['no-receipt']) {
    const receiptPath = join(dir, base + '.receipt.json');
    const r = writeReceipt(receiptPath, { specFile: file, artifacts: { png, live: liveOut }, verdict: v, scale, mode: 'deliver' });
    console.log(c.green('  wrote     ') + rel(receiptPath) + c.dim(`  (spec ${r.spec.sha256.slice(0, 12)} → png ${r.artifacts.png.sha256.slice(0, 12)})`));
  }
  process.exit(ok ? 0 : 2);
}

async function cmdDiff() {
  const beforeArg = positional[0], afterArg = positional[1];
  if (!beforeArg || !afterArg) die('usage: aws-archify diff <before.json> <after.json> [outdir]');
  const { file: beforeFile } = loadSpec(beforeArg);
  const { file: afterFile } = loadSpec(afterArg);
  const beforeRaw = JSON.parse(readFileSync(beforeFile, 'utf8'));
  const afterRaw = JSON.parse(readFileSync(afterFile, 'utf8'));

  const { summary, changes, delta } = compareSpecs(beforeRaw, afterRaw, {
    beforeName: basename(beforeFile, '.json'),
    afterName: basename(afterFile, '.json'),
  });

  const dir = positional[2] ? resolve(positional[2]) : dirname(afterFile);
  const base = basename(afterFile, extname(afterFile)) + '.delta';
  const total = summary.added + summary.removed + summary.changed + summary.moved;

  console.log(c.bold(`${basename(beforeFile)} → ${basename(afterFile)}`));
  console.log(
    `  changes   ${c.green('+' + summary.added)} added  ${c.red('-' + summary.removed)} removed  ` +
    `${c.yellow('~' + summary.changed)} changed  ${c.dim('↔' + summary.moved)} moved`
  );
  for (const ch of changes) {
    const tag = { added: c.green('+'), removed: c.red('-'), changed: c.yellow('~'), moved: c.dim('↔') }[ch.change];
    const detail = ch.fields ? c.dim(`  (${ch.fields.join(', ')})`) : '';
    console.log(`            ${tag} ${ch.kind.padEnd(6)} ${ch.key}${detail}`);
  }
  if (flags.json) console.log(JSON.stringify({ summary, changes }, null, 2));
  if (!total) {
    console.log(c.dim('\n  the two specs draw the same diagram — nothing to render'));
    process.exit(0);
  }

  // The delta is a real spec: it goes through the same contract, the same
  // router and the same validator as anything else. Ghosts are exempt from
  // geometry; everything that is actually there still has to be right.
  let spec;
  try {
    spec = normalize(delta, { file: base + '.json' });
  } catch (e) {
    if (e instanceof SpecError) die('the delta spec failed the contract — this is a bug in diff, please report it:\n' + e.message);
    throw e;
  }

  const reportPath = join(dir, base + '.json');
  write(reportPath, JSON.stringify({ before: rel(beforeFile), after: rel(afterFile), summary, changes, spec: delta }, null, 2) + '\n');
  console.log(c.green('\n  wrote     ') + rel(reportPath) + c.dim('  (change report + delta spec)'));

  const htmlTmp = join(tmpdir(), `aws-archify-${process.pid}.delta.html`);
  write(htmlTmp, buildHtml(spec, 'static'));
  const v = await verdict(htmlTmp);
  const ok = reportVerdict(v);
  if (!ok && !flags.force) {
    try { rmSync(htmlTmp); } catch {}
    console.error(
      '\n' + c.yellow('delta not rendered.') + ' The after-state has geometry problems of its own (above);\n' +
      'fix them in ' + basename(afterFile) + ' or pass --force to render anyway.'
    );
    process.exit(2);
  }

  const scale = Number(flags.scale || 1);
  const png = join(dir, base + '.png'), liveOut = join(dir, base + '.live.html');
  const candPng = candidatePath(png), candLive = candidatePath(liveOut);
  try {
    await screenshot(htmlTmp, candPng, { width: spec.canvas.width, height: spec.canvas.height, scale });
    write(candLive, buildHtml(spec, 'live'));
    commit(candPng, png);
    commit(candLive, liveOut);
  } catch (e) {
    discard(candPng);
    discard(candLive);
    throw e;
  } finally {
    try { rmSync(htmlTmp); } catch {}
  }
  console.log(c.green('  wrote     ') + rel(png) + c.dim('  (one picture, differences marked)'));
  console.log(c.green('  wrote     ') + rel(liveOut) + c.dim('  (interactive — click a changed node to see what touches it)'));
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
  diff: cmdDiff,
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
