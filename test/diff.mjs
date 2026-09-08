/*
 * diff + delivery tests. Run via test/run.mjs.
 */
import { readFileSync, readdirSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { normalize } from '../skills/aws-archify/lib/spec.mjs';
import { buildHtml } from '../skills/aws-archify/lib/build.mjs';
import { compareSpecs } from '../skills/aws-archify/lib/diff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, '..', 'skills', 'aws-archify', 'examples');
const CLI = join(HERE, '..', 'skills', 'aws-archify', 'bin', 'aws-archify.mjs');

export function register(t, { ok, eq, throws }) {
  const after = () => JSON.parse(readFileSync(join(EX, 'web-app.json'), 'utf8'));

  function before() {
    const b = after();
    b.nodes = b.nodes.filter((n) => n.id !== 'waf');
    const ecs = b.nodes.find((n) => n.id === 'ecs');
    ecs.icon = 'Amazon EC2'; ecs.label = 'Amazon EC2';
    b.nodes.find((n) => n.id === 'db').at = [760, 600];
    // a bastion host that the to-be design retires: must survive as a ghost
    b.nodes.push({ id: 'bastion', icon: 'Amazon EC2', label: 'Bastion', at: [1000, 600], width: 130, size: 56 });
    b.groups = b.groups.filter((g) => g.label !== 'Data subnet');
    b.arrows = [
      { from: 'users:right', to: 'cf:left', step: 1 },
      { from: 'cf:right', to: 'alb:left', label: 'HTTPS 443', step: 2 },
      { from: 'alb:right', to: 'ecs:left', label: 'HTTP 80', step: 3 },
      { from: 'ecs:bottom:70', to: 'db:top', label: 'TLS 5432', step: 4 },
      { from: 'bastion:left', to: 'db:right', label: 'SSH', dashed: true, color: 'muted' },
    ];
    b.steps = b.steps.slice(0, 4).map((s, i) => ({ ...s, n: i + 1 }));
    return b;
  }

  t('diff: classifies added, removed, changed and moved by identity', () => {
    const { summary, changes } = compareSpecs(before(), after());
    const find = (kind, key) => changes.find((c) => c.kind === kind && c.key === key);
    eq(find('node', 'waf').change, 'added', 'waf added');
    eq(find('node', 'ecs').change, 'changed', 'ecs changed');
    ok(find('node', 'ecs').fields.includes('icon'), 'ecs icon change recorded');
    eq(find('node', 'db').change, 'moved', 'db moved (same identity, new position)');
    eq(find('group', 'private:Data subnet').change, 'added', 'data subnet added');
    eq(find('arrow', 'cf:right->alb:left').change, 'removed', 'old cf->alb removed');
    eq(find('arrow', 'cf:right->waf:left').change, 'added', 'new cf->waf added');
    eq(find('node', 'bastion').change, 'removed', 'bastion removed');
    eq(find('arrow', 'bastion:left->db:right').change, 'removed', 'bastion arrow removed');
    ok(summary.added > 0 && summary.removed > 0 && summary.changed > 0 && summary.moved === 1, 'summary counts');
  });

  t('diff: identical specs produce no changes', () => {
    const { summary, changes } = compareSpecs(after(), after());
    eq(changes.length, 0, 'no changes');
    eq(summary.added + summary.removed + summary.changed + summary.moved, 0, 'zero summary');
  });

  t('diff: an anchor offset is not a new relationship', () => {
    const a = after();
    const b = after();
    b.arrows[0] = { ...b.arrows[0], from: 'users:right:12' };
    const { changes } = compareSpecs(a, b);
    ok(!changes.some((c) => c.kind === 'arrow'), 'sliding an attachment point is not a change');
  });

  t('diff: the delta is a valid spec that re-normalises and builds', () => {
    const { delta } = compareSpecs(before(), after());
    const spec = normalize(delta, { file: 'delta' });
    ok(spec.nodes.some((n) => n.delta === 'added'), 'added marker survives');
    ok(spec.nodes.some((n) => n.delta === 'removed'), 'removed ghost is present');
    ok(spec.legend.length >= 3, 'legend generated');
    ok(spec.subtitle && /added/.test(spec.subtitle), 'subtitle summarises');
    const html = buildHtml(spec, 'static');
    ok(html.includes('delta-added') && html.includes('delta-removed') && html.includes('delta-moved'), 'delta classes emitted');
  });

  t('diff: a removed arrow never keeps a step number', () => {
    const { delta } = compareSpecs(before(), after());
    for (const a of delta.arrows) {
      if (a.delta === 'removed') ok(a.step === undefined, 'removed arrow has no step');
    }
  });

  t('diff: removed steps are reported but not drawn (panel must match canvas)', () => {
    const a = after();
    const b = after();
    b.steps = b.steps.slice(0, 3);
    b.arrows = b.arrows.map((x) => (x.step > 3 ? { ...x, step: undefined } : x));
    const { changes, delta } = compareSpecs(a, b);
    ok(changes.some((c) => c.kind === 'step' && c.change === 'removed'), 'removed step reported');
    ok(!delta.steps.some((s) => s.delta === 'removed'), 'removed step not in the delta spec');
  });

  t('spec: delta markers are validated', () => {
    throws(
      () => normalize({ ...after(), nodes: [{ ...after().nodes[0], delta: 'exploded' }, ...after().nodes.slice(1)] }),
      'delta: must be one of',
      'bad delta value'
    );
  });

  t('cli: deliver leaves no candidate files and writes a receipt whose hashes match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    execFileSync(process.execPath, [CLI, 'deliver', join(EX, 'starter.json'), dir], { stdio: 'pipe' });
    const files = readdirSync(dir);
    ok(!files.some((f) => f.includes('.candidate')), 'no candidate left behind: ' + files.join(', '));
    ok(files.includes('starter.png') && files.includes('starter.live.html') && files.includes('starter.receipt.json'), 'three outputs');
    const r = JSON.parse(readFileSync(join(dir, 'starter.receipt.json'), 'utf8'));
    const h = (f) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
    eq(r.artifacts.png.sha256, h('starter.png'), 'png hash');
    eq(r.artifacts.live.sha256, h('starter.live.html'), 'live hash');
    eq(r.validation.status, 'PASS', 'verdict recorded');
    eq(r.claims.deterministic, 'passed', 'deterministic claim');
    eq(r.claims.visualReview, 'pending', 'visual review is never claimed by the tool');
  });

  t('cli: a scaled render is the scaled size, with the page filling it', () => {
    // --window-size is CSS px and the device scale factor multiplies it. Passing
    // width*scale as the window size doubled up: at --scale=2 the PNG came out
    // 4x too large with the page in one corner. Read the IHDR, trust nothing.
    const dim = (f) => {
      const b = readFileSync(f);
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    const dir = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    const spec = join(EX, 'starter.json');
    execFileSync(process.execPath, [CLI, 'render', spec, join(dir, 'r2.png'), '--scale=2'], { stdio: 'pipe' });
    eq(dim(join(dir, 'r2.png')).join('x'), '3840x2160', 'render --scale=2');
    execFileSync(process.execPath, [CLI, 'card', spec, join(dir, 'c2.png')], { stdio: 'pipe' });
    eq(dim(join(dir, 'c2.png')).join('x'), '2400x1260', 'card default 2x');
    execFileSync(process.execPath, [CLI, 'card', spec, join(dir, 'c1.png'), '--scale=1'], { stdio: 'pipe' });
    eq(dim(join(dir, 'c1.png')).join('x'), '1200x630', 'card --scale=1');
  });

  t('build: card mode frames the same diagram inside a stage', () => {
    const s = normalize(after());
    const html = buildHtml(s, 'card');
    ok(html.includes('id="diagram-stage"'), 'stage wrapper present');
    ok(/transform: translate\([^)]+\) scale\([0-9.]+\)/.test(html), 'stage is scaled to fit');
    ok(html.includes('class="card-head"') && html.includes('class="card-foot"'), 'card chrome present');
    ok(!html.includes('<div class="callout-panel"'), 'no callout panel element on a card');
    ok(!html.includes('class="title-rule"'), 'no page title rule on a card');
    ok(!html.includes('aa-toolbar'), 'no viewer chrome on a card');
    for (const n of s.nodes) ok(html.includes(`id="${n.id}"`), `node ${n.id} drawn`);
  });

  t('cli: diff writes report, png and live html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    const bPath = join(dir, 'before.json');
    require_write(bPath, JSON.stringify(before()));
    execFileSync(process.execPath, [CLI, 'diff', bPath, join(EX, 'web-app.json'), dir], { stdio: 'pipe' });
    for (const f of ['web-app.delta.json', 'web-app.delta.png', 'web-app.delta.live.html']) {
      ok(existsSync(join(dir, f)) && statSync(join(dir, f)).size > 500, `${f} written`);
    }
    const report = JSON.parse(readFileSync(join(dir, 'web-app.delta.json'), 'utf8'));
    ok(report.summary && Array.isArray(report.changes) && report.spec, 'report shape');
  });

  t('validator: diagnostics are structured and carry a concrete fix', () => {
    // A step badge dropped onto an icon must produce overlap/step with a new `at`.
    const s = after();
    s.steps[2].at = [560, 440];
    const dir = mkdtempSync(join(tmpdir(), 'aws-archify-test-'));
    const p = join(dir, 'bad.json');
    require_write(p, JSON.stringify(s));
    let out = '';
    try {
      execFileSync(process.execPath, [CLI, 'validate', p, '--json', '--no-color'], { stdio: 'pipe' });
      ok(false, 'validate should fail');
    } catch (e) {
      out = String(e.stdout || '');
    }
    const json = JSON.parse(out.slice(out.indexOf('{')));
    const d = json.geometry.errors.find((x) => x.code === 'overlap/step');
    ok(d, 'overlap/step diagnostic present');
    ok(d.fixes.some((f) => f.set && Array.isArray(f.set.at)), 'a concrete `at` is suggested');
    ok(d.subject.startsWith('steps[n='), 'subject names the step');
  });
}

import { writeFileSync } from 'node:fs';
function require_write(p, s) { writeFileSync(p, s, 'utf8'); }
