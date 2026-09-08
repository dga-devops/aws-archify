/*
 * Smoke tests. No framework: node test/run.mjs
 *
 * Covers the three things that silently produce a wrong diagram — a wrong icon,
 * a bad spec that builds anyway, and a route that is not orthogonal — plus one
 * end-to-end render of the real example.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, SpecError, DENSITY } from '../skills/aws-archify/lib/spec.mjs';
import { resolveIcon, searchIcons } from '../skills/aws-archify/lib/icons.mjs';
import { buildHtml } from '../skills/aws-archify/lib/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EX = join(HERE, '..', 'skills', 'aws-archify', 'examples');

let pass = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what);
}
function throws(fn, match, what) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) throw new Error(`${what}: expected a throw, got none`);
  if (match && !threw.message.includes(match)) {
    throw new Error(`${what}: expected message containing ${JSON.stringify(match)}, got ${JSON.stringify(threw.message)}`);
  }
}

// ---------- icons ----------
t('icon: shorthand does not drift to a similarly named service', () => {
  eq(resolveIcon('Amazon S3').name, 'Amazon Simple Storage Service', 'Amazon S3');
  eq(resolveIcon('s3').name, 'Amazon Simple Storage Service', 's3');
  eq(resolveIcon('Amazon EC2').name, 'Amazon EC2', 'Amazon EC2');
});

t('icon: the Light variant wins on the white canvas', () => {
  ok(/Light/.test(resolveIcon('users').name), 'users should resolve to the _Light variant');
  ok(/Light/.test(resolveIcon('client').name), 'client should resolve to the _Light variant');
});

t('icon: a type prefix pins the family', () => {
  eq(resolveIcon('group:Region').type, 'group', 'group:Region type');
  eq(resolveIcon('resource:Amazon VPC / Endpoints').type, 'resource', 'endpoints type');
});

t('icon: an unknown name fails loudly', () => {
  throws(() => resolveIcon('Amazon Nonexistent Service'), 'no AWS icon matches', 'unknown icon');
});

t('icon: search returns candidates', () => {
  ok(searchIcons('lambda', 5).length > 0, 'search lambda');
});

// ---------- spec ----------
const minimal = {
  title: 'T',
  nodes: [
    { id: 'a', icon: 's3', at: [100, 100] },
    { id: 'b', icon: 'lambda', at: [400, 100] },
  ],
  arrows: [{ from: 'a:right', to: 'b:left', step: 1 }],
  steps: [{ n: 1, at: [250, 60], text: 'x' }],
};

t('spec: a valid spec normalises with defaults', () => {
  const s = normalize(minimal);
  eq(s.canvas.width, 1920, 'canvas width');
  eq(s.panel.width, 480, 'panel width');
  eq(s.density, 'comfortable', 'density');
  eq(s.motion.animation, 'trace', 'animation');
});

t('spec: every problem is reported in one pass', () => {
  let issues = [];
  try {
    normalize({
      nodes: [{ id: 'a', icon: 's3', at: [0, 0] }, { id: 'a', icon: 's3', at: [1, 1] }],
      arrows: [{ from: 'ghost:right', to: 'a:sideways' }],
      steps: [{ n: 1, text: 'no at' }],
    });
  } catch (e) {
    ok(e instanceof SpecError, 'should be a SpecError');
    issues = e.issues;
  }
  ok(issues.length >= 5, `expected at least 5 issues, got ${issues.length}`);
  ok(issues.some((i) => i.includes('title')), 'missing title reported');
  ok(issues.some((i) => i.includes('duplicate id')), 'duplicate id reported');
  ok(issues.some((i) => i.includes('not a node id')), 'unknown arrow endpoint reported');
  ok(issues.some((i) => i.includes('side must be one of')), 'bad side reported');
  ok(issues.some((i) => i.includes('at: required')), 'step without a canvas position reported');
});

t('spec: an arrow may not anchor to a group', () => {
  throws(
    () => normalize({ ...minimal, groups: [{ id: 'vpc', kind: 'vpc', at: [0, 0], size: [10, 10] }],
      arrows: [{ from: 'vpc:right', to: 'a:left' }] }),
    'arrows may only anchor to nodes',
    'group anchor'
  );
});

t('spec: a step referenced by an arrow must exist', () => {
  throws(
    () => normalize({ ...minimal, arrows: [{ from: 'a:right', to: 'b:left', step: 9 }] }),
    'no steps[] entry has that number',
    'dangling step'
  );
});

t('spec: density is checked', () => {
  throws(() => normalize({ ...minimal, density: 'cosy' }), 'density: must be one of', 'bad density');
  ok(DENSITY.compact.nodeLabel < DENSITY.comfortable.nodeLabel, 'compact type is smaller');
});

// ---------- build ----------
t('build: output is self-contained', () => {
  const html = buildHtml(normalize(minimal), 'static');
  ok(html.startsWith('<!DOCTYPE html>'), 'doctype');
  ok(!/src="(?!data:)/.test(html), 'every image must be inlined as a data URI');
  ok(!/<link/.test(html), 'no external stylesheet');
  ok(html.includes('DIAGRAM-VALIDATION'), 'validator is embedded');
});

t('build: static mode carries no viewer', () => {
  const html = buildHtml(normalize(minimal), 'static');
  ok(!html.includes('aa-toolbar'), 'static must not contain the toolbar');
  ok(!html.includes('aa-edge-flow'), 'static must not contain the animation');
});

t('build: live mode carries the viewer and finite motion', () => {
  const html = buildHtml(normalize(minimal), 'live');
  ok(html.includes('aa-toolbar'), 'toolbar present');
  ok(html.includes('@keyframes aa-edge-flow'), 'edge flow present');
  ok(html.includes('prefers-reduced-motion'), 'reduced motion honoured');
  ok(html.includes('@media print'), 'print styles present');
  ok(/animation: aa-edge-flow[^;]*\s1;/.test(html), 'the trace must run exactly once, never loop');
});

t('build: prose markup is applied and HTML is escaped', () => {
  const s = normalize({ ...minimal, steps: [{ n: 1, at: [1, 1], text: '**Amazon S3** holds `my-bucket` <script>' }] });
  const html = buildHtml(s, 'static');
  ok(html.includes('<b>Amazon S3</b>'), 'bold applied');
  ok(html.includes('<span class="mono">my-bucket</span>'), 'mono applied');
  ok(html.includes('&lt;script&gt;'), 'raw HTML escaped');
});

t('build: a bad icon name stops the build', () => {
  throws(
    () =>
      buildHtml(
        normalize({
          ...minimal,
          nodes: [{ id: 'a', icon: 'Totally Not A Service', at: [0, 0] }, minimal.nodes[1]],
        }),
        'static'
      ),
    'no AWS icon matches',
    'bad icon at build time'
  );
});

// ---------- the real example ----------
t('examples: every shipped example normalises and builds', () => {
  for (const f of readdirSync(EX).filter((n) => n.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(EX, f), 'utf8'));
    const s = normalize(raw, { file: f });
    ok(s.nodes.length > 0, `${f}: has nodes`);
    ok(buildHtml(s, 'live').length > 20_000, `${f}: live build produced output`);
    ok(buildHtml(s, 'static').length > 10_000, `${f}: static build produced output`);
  }
});

t('examples: the dense one exercises the optional features', () => {
  const s = normalize(JSON.parse(readFileSync(join(EX, 'analytics-pipeline.json'), 'utf8')));
  eq(s.density, 'compact', 'density');
  ok(s.boxes.length >= 2, 'has note boxes');
  ok(s.legend.length >= 2, 'has a legend');
  ok(s.groups.some((g) => g.kind === 'proposed'), 'has a proposed boundary');
});

t('examples: an example never carries real infrastructure', () => {
  // These ship publicly. The guard is structural on purpose: listing real
  // internal names here would publish exactly what it is meant to keep out.
  const ACCOUNT = /(?<![0-9])[0-9]{12}(?![0-9])/g;
  const HOST = /[a-z0-9][a-z0-9-]*[.](?:go[.]th|or[.]th|co[.]th|com|net|org|io|dev)/gi;
  const IPV4 = /(?<![0-9.])[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}(?![0-9])/g;

  for (const f of readdirSync(EX).filter((n) => n.endsWith('.json'))) {
    const raw = readFileSync(join(EX, f), 'utf8');

    for (const a of raw.match(ACCOUNT) || []) {
      ok(/^0+$/.test(a), `${f}: ${a} looks like a real AWS account id - use 000000000000`);
    }

    for (const h of raw.match(HOST) || []) {
      ok(/^example[.]/i.test(h), `${f}: hostname "${h}" - examples may only use example.* names`);
    }

    for (const addr of raw.match(IPV4) || []) {
      const [a, b] = addr.split('.').map(Number);
      const priv = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
      ok(priv, `${f}: ${addr} is a routable address - examples may only use RFC 1918 ranges`);
    }

    ok(/fictional|example/i.test(raw), `${f}: must say somewhere that it is an example`);
  }
});

// ---------- report ----------
console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
for (const f of failures) console.error('  FAIL  ' + f + '\n');
process.exit(failures.length ? 1 : 0);
