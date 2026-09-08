/*
 * diff.mjs — what changed between two revisions of a diagram.
 *
 * Half the diagrams this tool exists for are titled "(Proposed)": an as-is
 * design next to a to-be one. Drawing the difference by hand means a
 * `proposed` boundary, a legend, and a reviewer squinting between two PNGs.
 * This compares the two specs directly and emits one delta spec in which
 * every item knows whether it was added, removed, changed or moved, so the
 * builder can draw the difference and the reader can see it in one picture.
 *
 * Matching is by identity, never by position: a node is the same node if its
 * id is the same. That is what makes "moved" distinguishable from
 * "removed here, added there".
 *
 * The idea, and the vocabulary added/removed/changed/moved, come from
 * archify's Architecture Delta (MIT, tt-a1i). The implementation is this
 * file's own.
 */
import { normalize } from './spec.mjs';

const NODE_FIELDS = ['icon', 'label', 'note', 'mono', 'small', 'labelTop', 'size', 'width'];
const GROUP_FIELDS = ['kind', 'label', 'icon', 'sub', 'color', 'dashed', 'fill', 'size'];
const ARROW_FIELDS = ['label', 'dashed', 'both', 'color', 'step', 'width'];
const STEP_FIELDS = ['text', 'tone'];
const BOX_FIELDS = ['head', 'text', 'width'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Drop null/undefined so the delta spec re-normalises cleanly. */
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function changedFields(a, b, fields) {
  return fields.filter((f) => !same(a[f], b[f]));
}

function groupKey(g) {
  return g.id ? `id:${g.id}` : `${g.kind}:${g.label ?? ''}`;
}

/** Anchor identity without the offset — sliding an attachment 14px is not a new relationship. */
function anchorKey(a) {
  const [id, side = 'right'] = String(a).split(':');
  return `${id}:${side}`;
}
function arrowKey(a) {
  return `${anchorKey(a.from)}->${anchorKey(a.to)}`;
}

function boxKey(b) {
  return b.head ? `head:${b.head}` : `text:${String(b.text).slice(0, 40)}`;
}

/**
 * Compare two raw specs.
 * @returns {{ summary, changes, delta }} where `delta` is a raw spec that
 *   renders the after-state with every difference marked.
 */
export function compareSpecs(beforeRaw, afterRaw, { beforeName = 'before', afterName = 'after' } = {}) {
  const before = normalize(beforeRaw, { file: beforeName });
  const after = normalize(afterRaw, { file: afterName });

  const changes = [];
  const record = (kind, change, key, extra = {}) => changes.push({ kind, change, key, ...extra });

  // ---- nodes ----
  const bNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const aNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const nodes = [];
  for (const n of after.nodes) {
    const prev = bNodes.get(n.id);
    if (!prev) {
      record('node', 'added', n.id, { after: { label: n.label, icon: n.icon } });
      nodes.push({ ...n, delta: 'added' });
      continue;
    }
    const fields = changedFields(prev, n, NODE_FIELDS);
    if (fields.length) {
      record('node', 'changed', n.id, { fields, before: pick(prev, fields), after: pick(n, fields) });
      nodes.push({ ...n, delta: 'changed' });
    } else if (!same(prev.at, n.at)) {
      record('node', 'moved', n.id, { before: prev.at, after: n.at });
      nodes.push({ ...n, delta: 'moved' });
    } else {
      nodes.push({ ...n });
    }
  }
  for (const n of before.nodes) {
    if (aNodes.has(n.id)) continue;
    record('node', 'removed', n.id, { before: { label: n.label, icon: n.icon } });
    // A removed node stays where it was, drawn as a ghost, so the reader sees
    // what left. Arrows that referenced it can still resolve their anchors.
    nodes.push({ ...n, delta: 'removed' });
  }

  // ---- groups ----
  const bGroups = new Map(before.groups.map((g) => [groupKey(g), g]));
  const aGroups = new Map(after.groups.map((g) => [groupKey(g), g]));
  const groups = [];
  for (const g of after.groups) {
    const k = groupKey(g);
    const prev = bGroups.get(k);
    if (!prev) {
      record('group', 'added', k, { after: { kind: g.kind, label: g.label } });
      groups.push({ ...g, delta: 'added' });
      continue;
    }
    const fields = changedFields(prev, g, GROUP_FIELDS);
    if (fields.length) {
      record('group', 'changed', k, { fields, before: pick(prev, fields), after: pick(g, fields) });
      groups.push({ ...g, delta: 'changed' });
    } else if (!same(prev.at, g.at)) {
      record('group', 'moved', k, { before: prev.at, after: g.at });
      groups.push({ ...g, delta: 'moved' });
    } else {
      groups.push({ ...g });
    }
  }
  for (const g of before.groups) {
    const k = groupKey(g);
    if (aGroups.has(k)) continue;
    record('group', 'removed', k, { before: { kind: g.kind, label: g.label } });
    groups.push({ ...g, delta: 'removed' });
  }

  // ---- arrows ----
  const bArrows = new Map(before.arrows.map((a) => [arrowKey(a), a]));
  const aArrows = new Map(after.arrows.map((a) => [arrowKey(a), a]));
  const arrows = [];
  for (const a of after.arrows) {
    const k = arrowKey(a);
    const prev = bArrows.get(k);
    if (!prev) {
      record('arrow', 'added', k, { after: { label: a.label } });
      arrows.push({ ...a, delta: 'added', color: '#ED7100' });
      continue;
    }
    const fields = changedFields(prev, a, ARROW_FIELDS);
    if (fields.length) {
      record('arrow', 'changed', k, { fields, before: pick(prev, fields), after: pick(a, fields) });
      arrows.push({ ...a, delta: 'changed' });
    } else {
      arrows.push({ ...a });
    }
  }
  for (const a of before.arrows) {
    const k = arrowKey(a);
    if (aArrows.has(k)) continue;
    record('arrow', 'removed', k, { before: { label: a.label } });
    // Removed relationships lose their step: they no longer belong to the
    // narrative, and a dangling step number would fail the contract. Their
    // label drops below the line, because the replacement usually runs along
    // the same corridor and the two labels would otherwise sit on each other.
    arrows.push({
      ...a, delta: 'removed', color: '#7D8998', dashed: true, step: null,
      labelDy: a.labelDy ?? 18,
    });
  }

  // ---- steps: the panel describes the after-state; removed steps are reported only ----
  const bSteps = new Map(before.steps.map((s) => [s.n, s]));
  const aSteps = new Map(after.steps.map((s) => [s.n, s]));
  const steps = [];
  for (const s of after.steps) {
    const prev = bSteps.get(s.n);
    if (!prev) {
      record('step', 'added', String(s.n), { after: { text: s.text } });
      steps.push({ ...s, delta: 'added' });
      continue;
    }
    const fields = changedFields(prev, s, STEP_FIELDS);
    if (fields.length) {
      record('step', 'changed', String(s.n), { fields, before: pick(prev, fields), after: pick(s, fields) });
      steps.push({ ...s, delta: 'changed' });
    } else {
      steps.push({ ...s });
    }
  }
  for (const s of before.steps) {
    if (!aSteps.has(s.n)) record('step', 'removed', String(s.n), { before: { text: s.text } });
  }

  // ---- boxes ----
  const bBoxes = new Map(before.boxes.map((b) => [boxKey(b), b]));
  const aBoxes = new Map(after.boxes.map((b) => [boxKey(b), b]));
  const boxes = [];
  for (const b of after.boxes) {
    const k = boxKey(b);
    const prev = bBoxes.get(k);
    if (!prev) {
      record('box', 'added', k);
      boxes.push({ ...b, delta: 'added' });
      continue;
    }
    const fields = changedFields(prev, b, BOX_FIELDS);
    boxes.push(fields.length ? { ...b, delta: 'changed' } : { ...b });
    if (fields.length) record('box', 'changed', k, { fields });
  }
  for (const b of before.boxes) {
    if (aBoxes.has(boxKey(b))) continue;
    record('box', 'removed', boxKey(b));
    boxes.push({ ...b, delta: 'removed' });
  }

  // ---- top-level ----
  for (const f of ['title', 'subtitle', 'reviewed', 'notes', 'density']) {
    if (!same(before[f], after[f])) record('meta', 'changed', f, { before: before[f], after: after[f] });
  }

  const summary = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const c of changes) if (c.kind !== 'meta') summary[c.change]++;

  const legend = [
    { text: 'Unchanged', color: '#232F3E' },
    ...(summary.added ? [{ text: `Added (${summary.added})`, color: '#ED7100', dashed: true, fill: 'rgba(237,113,0,0.06)' }] : []),
    ...(summary.changed ? [{ text: `Changed (${summary.changed})`, color: '#ED7100' }] : []),
    ...(summary.moved ? [{ text: `Moved (${summary.moved})`, color: '#00A4A6', dashed: true }] : []),
    ...(summary.removed ? [{ text: `Removed (${summary.removed})`, color: '#7D8998', dashed: true }] : []),
  ];

  const delta = compact({
    title: after.title,
    subtitle: `Changes from ${beforeName} — ${summary.added} added · ${summary.changed} changed · ${summary.moved} moved · ${summary.removed} removed`,
    reviewed: after.reviewed,
    brand: after.brand,
    density: after.density,
    canvas: after.canvas,
    panel: { ...after.panel, head: after.panel.head ?? 'What changes' },
    motion: after.motion,
    notes: after.notes,
    legend,
    groups: groups.map(compact),
    nodes: nodes.map(compact),
    arrows: arrows.map(compact),
    steps: steps.map(compact),
    boxes: boxes.map(compact),
  });

  return { summary, changes, delta };
}

function pick(o, fields) {
  const out = {};
  for (const f of fields) out[f] = o[f] ?? null;
  return out;
}
