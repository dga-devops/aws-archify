/*
 * spec.mjs — the diagram contract.
 *
 * Everything checkable without a browser is checked here, so a bad spec fails
 * before any HTML is written. Geometry (arrows crossing text, labels colliding,
 * things leaving the canvas) needs real text metrics and is checked in the
 * browser by runtime/diagram-lib.js instead.
 */

export const SIDES = ['left', 'right', 'top', 'bottom'];

/** Change markers a delta view attaches to items. Authors never write these;
 *  `aws-archify diff` does, and the builder renders them. */
export const DELTA = ['added', 'removed', 'changed', 'moved'];

function checkDelta(v, where, bad) {
  // null is "absent": a normalised spec fed back in carries delta: null.
  if (v != null && !DELTA.includes(v)) bad(`${where}.delta: must be one of ${DELTA.join(', ')}`);
  return v ?? null;
}

/** Group kinds and their standard styling. Colours come from the official
 *  AWS group icons — do not tune them per-diagram. */
export const GROUP_KINDS = {
  cloud:    { color: '#242F3E', dashed: false, icon: 'group:AWS Cloud' },
  account:  { color: '#E7157B', dashed: false, icon: 'group:AWS Account' },
  region:   { color: '#00A4A6', dashed: true,  icon: 'group:Region' },
  vpc:      { color: '#8C4FFF', dashed: false, icon: 'group:Virtual private cloud VPC' },
  az:       { color: '#00A4A6', dashed: true,  icon: null, italic: true },
  private:  { color: '#00A4A6', dashed: false, icon: 'group:Private subnet' },
  public:   { color: '#7AA116', dashed: false, icon: 'group:Public subnet' },
  onprem:   { color: '#7D8998', dashed: false, icon: 'group:Corporate data center' },
  asg:      { color: '#ED7100', dashed: true,  icon: 'group:Auto Scaling group' },
  // not in the official AWS set: for marking a proposed addition to an as-is design
  proposed: { color: '#ED7100', dashed: true,  icon: null, fill: 'rgba(237,113,0,0.06)' },
  plain:    { color: '#879196', dashed: false, icon: null },
};

export const COLORS = {
  ink:    '#232F3E',
  muted:  '#7D8998',
  accent: '#ED7100',
  teal:   '#00A4A6',
  purple: '#8C4FFF',
  green:  '#7AA116',
  red:    '#B2152A',
};

const DEFAULTS = {
  canvas: { width: 1920, height: 1080 },
  panel:  { width: 480 },
  motion: { animation: 'trace', duration: 2400, stagger: 160 },
  brand:  'AWS Reference Architecture',
  density: 'comfortable',
};

/*
 * Type scale. A dense diagram — three nested boundaries, fifteen nodes, notes
 * down the side — does not fit at the comfortable scale, and every author who
 * hit that hand-tuned the stylesheet. That tuning is this switch instead, so a
 * dense diagram stays inside the standard rather than forking away from it.
 */
export const DENSITY = {
  comfortable: {
    nodeLabel: 17.5, nodeSmall: 14, nodeSm: 14.5, nodeMono: 13.5,
    grpLabel: 19, grpSubLabel: 16.5, note: 14, noteHead: 15,
    stepText: 17, panelHead: 20, panelNote: 15, arrowLabel: 14.5,
  },
  compact: {
    nodeLabel: 15.5, nodeSmall: 13, nodeSm: 14, nodeMono: 13,
    grpLabel: 19, grpSubLabel: 16, note: 13.5, noteHead: 14.5,
    stepText: 15.5, panelHead: 21, panelNote: 14, arrowLabel: 14,
  },
};

export class SpecError extends Error {
  constructor(issues) {
    super(
      `spec is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => '  - ' + i).join('\n')
    );
    this.name = 'SpecError';
    this.issues = issues;
  }
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
function isPair(v) {
  return Array.isArray(v) && v.length === 2 && v.every(isNum);
}

/**
 * Validate and normalise a raw spec object. Throws SpecError listing every
 * problem at once — one round-trip per fix cycle instead of one per issue.
 */
export function normalize(raw, { file = 'spec' } = {}) {
  const issues = [];
  const bad = (msg) => issues.push(`${file}: ${msg}`);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SpecError([`${file}: top level must be a JSON object`]);
  }

  const spec = {
    title: raw.title,
    subtitle: raw.subtitle ?? null,
    reviewed: raw.reviewed ?? null,
    brand: raw.brand ?? DEFAULTS.brand,
    canvas: { ...DEFAULTS.canvas, ...(raw.canvas || {}) },
    panel: { ...DEFAULTS.panel, ...(raw.panel || {}) },
    motion: { ...DEFAULTS.motion, ...(raw.motion || {}) },
    density: raw.density ?? DEFAULTS.density,
    groups: [],
    nodes: [],
    arrows: [],
    steps: [],
    boxes: [],
    legend: Array.isArray(raw.legend) ? raw.legend : [],
    notes: raw.notes ?? null,
  };

  if (typeof spec.title !== 'string' || !spec.title.trim()) bad('title: required, non-empty string');
  if (!isNum(spec.canvas.width) || !isNum(spec.canvas.height)) bad('canvas: width/height must be numbers');
  if (!isNum(spec.panel.width) || spec.panel.width < 0) bad('panel.width: must be a non-negative number');
  if (!['trace', 'none'].includes(spec.motion.animation)) {
    bad(`motion.animation: must be "trace" or "none", got ${JSON.stringify(spec.motion.animation)}`);
  }
  if (!DENSITY[spec.density]) {
    bad(`density: must be one of ${Object.keys(DENSITY).join(', ')}, got ${JSON.stringify(spec.density)}`);
  }

  const ids = new Map(); // id -> what declared it

  const claim = (id, what, where) => {
    if (typeof id !== 'string' || !/^[A-Za-z][\w-]*$/.test(id)) {
      bad(`${where}: id ${JSON.stringify(id)} must start with a letter and contain only letters, digits, _ or -`);
      return false;
    }
    if (ids.has(id)) {
      bad(`${where}: duplicate id "${id}" (already used by ${ids.get(id)})`);
      return false;
    }
    ids.set(id, what);
    return true;
  };

  // ---- groups ----
  (raw.groups || []).forEach((g, i) => {
    const where = `groups[${i}]`;
    if (!g || typeof g !== 'object') return bad(`${where}: must be an object`);
    const kind = g.kind ?? 'plain';
    if (!GROUP_KINDS[kind]) {
      return bad(
        `${where}.kind: unknown kind ${JSON.stringify(kind)} — one of ${Object.keys(GROUP_KINDS).join(', ')}`
      );
    }
    if (g.id !== undefined && !claim(g.id, 'a group', where)) return;
    if (!isPair(g.at)) bad(`${where}.at: required [x, y]`);
    if (!isPair(g.size)) bad(`${where}.size: required [width, height]`);
    if (g.icon !== undefined && g.icon !== false && typeof g.icon !== 'string') {
      bad(`${where}.icon: use false to drop the standard corner icon, or a string to override it`);
    }
    spec.groups.push({
      id: g.id ?? null,
      kind,
      label: g.label ?? null,
      icon: g.icon,
      at: g.at,
      size: g.size,
      labelOffset: isPair(g.labelOffset) ? g.labelOffset : null,
      color: g.color ?? null,
      dashed: g.dashed,
      fill: g.fill ?? null,
      labelSize: isNum(g.labelSize) ? g.labelSize : null,
      sub: g.sub === true,
      delta: checkDelta(g.delta, where, bad),
    });
  });

  // ---- nodes ----
  (raw.nodes || []).forEach((n, i) => {
    const where = `nodes[${i}]`;
    if (!n || typeof n !== 'object') return bad(`${where}: must be an object`);
    if (!claim(n.id, 'a node', where)) return;
    if (typeof n.icon !== 'string' || !n.icon.trim()) {
      bad(`${where}.icon: required (an AWS icon name, "type:name", or a path)`);
    }
    if (!isPair(n.at)) bad(`${where}.at: required [x, y]`);
    if (n.width !== undefined && !isNum(n.width)) bad(`${where}.width: must be a number`);
    if (n.size !== undefined && !isNum(n.size)) bad(`${where}.size: must be a number (icon px)`);
    spec.nodes.push({
      id: n.id,
      icon: n.icon,
      label: n.label ?? null,
      note: n.note ?? null,
      mono: n.mono ?? null,
      at: n.at,
      width: n.width ?? 150,
      size: n.size ?? 76,
      small: n.small === true,
      labelTop: n.labelTop === true,
      delta: checkDelta(n.delta, where, bad),
    });
  });

  // ---- boxes: free-standing notes on the canvas (assumptions, cost, caveats) ----
  (raw.boxes || []).forEach((b, i) => {
    const where = `boxes[${i}]`;
    if (!b || typeof b !== 'object') return bad(`${where}: must be an object`);
    if (typeof b.text !== 'string' || !b.text.trim()) bad(`${where}.text: required`);
    if (!isPair(b.at)) bad(`${where}.at: required [x, y]`);
    if (b.width !== undefined && !isNum(b.width)) bad(`${where}.width: must be a number`);
    spec.boxes.push({
      head: b.head ?? null,
      text: b.text,
      at: b.at,
      width: b.width ?? 240,
      delta: checkDelta(b.delta, where, bad),
    });
  });

  // ---- steps ----
  const stepNums = new Set();
  (raw.steps || []).forEach((s, i) => {
    const where = `steps[${i}]`;
    if (!s || typeof s !== 'object') return bad(`${where}: must be an object`);
    const n = s.n ?? i + 1;
    if (!Number.isInteger(n) || n < 1) bad(`${where}.n: must be a positive integer`);
    if (stepNums.has(n)) bad(`${where}.n: duplicate step number ${n}`);
    stepNums.add(n);
    if (typeof s.text !== 'string' || !s.text.trim()) bad(`${where}.text: required`);
    const onCanvas = s.onCanvas !== false;
    if (onCanvas && !isPair(s.at)) {
      bad(
        `${where}.at: required [x, y] — every panel step needs its number on the diagram ` +
          `(set "onCanvas": false only for a step with no single location)`
      );
    }
    if (s.tone !== undefined && !['default', 'new'].includes(s.tone)) {
      bad(`${where}.tone: must be "default" or "new"`);
    }
    spec.steps.push({
      n, at: s.at ?? null, text: s.text, tone: s.tone ?? 'default', onCanvas,
      delta: checkDelta(s.delta, where, bad),
    });
  });
  spec.steps.sort((a, b) => a.n - b.n);

  // ---- arrows ----
  const parseEnd = (v, where, key) => {
    if (typeof v !== 'string') {
      bad(`${where}.${key}: required, e.g. "s3:right" or "s3:right:26"`);
      return;
    }
    const p = v.split(':');
    const [id, side = 'right', off] = p;
    if (ids.get(id) !== 'a node') {
      bad(
        `${where}.${key}: "${id}" is not a node id` +
          (ids.has(id) ? ` (it is ${ids.get(id)}; arrows may only anchor to nodes)` : '')
      );
    }
    if (!SIDES.includes(side)) bad(`${where}.${key}: side must be one of ${SIDES.join('/')}, got "${side}"`);
    if (off !== undefined && !Number.isFinite(Number(off))) bad(`${where}.${key}: offset "${off}" is not a number`);
    if (p.length > 3) bad(`${where}.${key}: too many ":" segments in "${v}"`);
  };

  (raw.arrows || []).forEach((a, i) => {
    const where = `arrows[${i}]`;
    if (!a || typeof a !== 'object') return bad(`${where}: must be an object`);
    parseEnd(a.from, where, 'from');
    parseEnd(a.to, where, 'to');
    if (a.from === a.to) bad(`${where}: from and to are the same anchor`);
    if (a.step !== undefined && (!Number.isInteger(a.step) || a.step < 1)) {
      bad(`${where}.step: must be a positive integer (it orders the trace animation)`);
    }
    if (a.color !== undefined && typeof a.color !== 'string') bad(`${where}.color: must be a colour name or hex`);
    if (a.mid !== undefined && !isNum(a.mid)) bad(`${where}.mid: must be a number`);
    spec.arrows.push({
      from: a.from,
      to: a.to,
      label: a.label ?? null,
      step: a.step ?? null,
      dashed: a.dashed === true,
      both: a.both === true,
      color: COLORS[a.color] ?? a.color ?? COLORS.ink,
      mid: a.mid,
      width: a.width,
      labelDx: a.labelDx,
      labelDy: a.labelDy,
      delta: checkDelta(a.delta, where, bad),
    });
  });

  // An arrow may be tied to a step number for ordering; that number must exist.
  for (const a of spec.arrows) {
    if (a.step !== null && !stepNums.has(a.step)) {
      bad(`arrows: step ${a.step} is referenced but no steps[] entry has that number`);
    }
  }

  if (!spec.nodes.length) bad('nodes: a diagram needs at least one node');

  if (issues.length) throw new SpecError(issues);
  return spec;
}
