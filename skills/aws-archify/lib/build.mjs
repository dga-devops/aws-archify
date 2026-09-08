/*
 * build.mjs — spec -> a single self-contained HTML file.
 *
 * Two modes off one spec:
 *   static  what the PNG is captured from: the AWS Reference Architecture page,
 *           nothing else on it.
 *   live    the same page plus the viewer layer (trace, focus, route, theme).
 *
 * Both share the identical layout and the identical arrow router, so the moving
 * version can never drift from the printed one.
 *
 * Icons are inlined as data URIs at build time. The old pipeline referenced
 * them by path and checked at render time that the files existed, because a
 * missing icon silently renders as a blank box; inlining removes the failure
 * mode instead of detecting it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineIcon } from './icons.mjs';
import { GROUP_KINDS, DENSITY } from './spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const runtime = (f) => readFileSync(join(HERE, 'runtime', f), 'utf8');

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Inline markup for authored prose. Deliberately tiny: bold for service names
 * (the AWS house style spells a service in full and bolds it on first mention),
 * backticks for identifiers, and an explicit line break.
 */
function rich(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<span class="mono">$1</span>')
    .replace(/\\n/g, '<br>');
}

function styles(spec) {
  const { width, height } = spec.canvas;
  const panelW = spec.panel.width;
  const t = DENSITY[spec.density];
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: "Segoe UI", "Amazon Ember", "Noto Sans Thai", Arial, sans-serif;
    background: #FFFFFF; color: #232F3E; position: relative;
  }

  .title {
    position: absolute; top: 30px; left: 40px; width: ${width - panelW - 60}px;
    font-size: 42px; font-weight: 600; line-height: 1.2;
  }
  .subtitle {
    position: absolute; top: 96px; left: 40px; width: ${width - panelW - 60}px;
    font-size: 20px; color: #545B64;
  }
  .title-rule {
    position: absolute; top: 145px; left: 40px; width: ${width - panelW - 40}px;
    border-top: 3px solid #232F3E;
  }

  .callout-panel {
    position: absolute; top: 0; right: 0; width: ${panelW}px; height: ${height}px;
    background: #F2F3F3; padding: 28px 26px; overflow: hidden;
  }
  .panel-head { font-size: ${t.panelHead}px; font-weight: 700; margin-bottom: 18px; }
  .callout { display: flex; gap: 13px; margin-bottom: 20px; }
  .callout .step-text { font-size: ${t.stepText}px; line-height: 1.45; }
  .panel-note {
    margin-top: 4px; padding-top: 13px; border-top: 1px solid #D5DBDB;
    font-size: ${t.panelNote}px; font-style: italic; line-height: 1.45; color: #545B64;
  }

  .num {
    flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
    background: #232F3E; color: #FFFFFF; font-size: 18px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .num.new { background: #ED7100; }
  .num.on-canvas { position: absolute; z-index: 10; }

  .grp { position: absolute; }
  .grp .grp-icon { position: absolute; top: 0; left: 0; width: 40px; height: 40px; }
  .grp .grp-label {
    position: absolute; top: 7px; left: 50px;
    font-size: ${t.grpLabel}px; font-weight: 600; white-space: nowrap;
  }
  .grp.no-icon .grp-label { left: 14px; color: #545B64; }
  .grp.sub .grp-label { font-size: ${t.grpSubLabel}px; left: 44px; }
  .grp.sub .grp-icon { width: 34px; height: 34px; }
  .grp.sub.no-icon .grp-label { left: 14px; }
  .grp.italic .grp-label { font-style: italic; }

  .node { position: absolute; text-align: center; }
  .node img { display: block; margin: 0 auto; }
  .node .label { margin-top: 7px; font-size: ${t.nodeLabel}px; line-height: 1.28; }
  .node .label.sm { font-size: ${t.nodeSm}px; line-height: 1.25; }
  .node.lbl-top .label { margin: 0 0 7px; }
  .node .label small { font-size: ${t.nodeSmall}px; color: #545B64; }
  .node .label .mono {
    font-family: Consolas, "Cascadia Code", ui-monospace, monospace;
    font-size: ${t.nodeMono}px; color: #545B64;
  }

  .arrow-label {
    position: absolute; font-size: ${t.arrowLabel}px; color: #545B64;
    background: #FFFFFF; padding: 0 4px; white-space: nowrap; z-index: 5;
  }

  .note {
    position: absolute; font-size: ${t.note}px; line-height: 1.45; color: #545B64;
  }
  .note b { color: #232F3E; }
  .note .hd { font-size: ${t.noteHead}px; font-weight: 700; color: #232F3E; margin-bottom: 5px; }

  .legend {
    position: absolute; left: 40px; bottom: 66px;
    font-size: 14.5px; line-height: 1.9; color: #545B64;
  }
  .legend .row { display: flex; align-items: center; gap: 9px; }
  .legend .sw { width: 26px; height: 15px; flex: 0 0 auto; }

  /* ===== Delta view: what changed between two revisions ===== */
  .delta-added .grp-label, .delta-added .label, .note.delta-added .hd { color: #ED7100; }
  .node.delta-added img, .note.delta-added, .grp.delta-added {
    outline: 3px dashed #ED7100; outline-offset: 4px;
  }
  .grp.delta-added { background: rgba(237,113,0,0.06); }
  .num.delta-added { background: #ED7100; }

  .delta-removed { opacity: .38; filter: grayscale(1); }
  .node.delta-removed img, .note.delta-removed, .grp.delta-removed {
    outline: 3px dashed #7D8998; outline-offset: 4px;
  }
  .node.delta-removed .label, .arrow-label.delta-removed { text-decoration: line-through; }
  .num.delta-removed { background: #7D8998; }
  #diagram-edges .delta-removed { opacity: .45; }

  .node.delta-changed img, .note.delta-changed, .grp.delta-changed {
    outline: 3px solid #ED7100; outline-offset: 4px;
  }
  .node.delta-changed .label, .arrow-label.delta-changed { color: #ED7100; font-weight: 600; }
  #diagram-edges .delta-changed { stroke-width: 3.5; }

  .node.delta-moved img { outline: 3px dotted #00A4A6; outline-offset: 4px; }
  .node.delta-moved .label { color: #00A4A6; }

  .footer-note {
    position: absolute; bottom: 26px; left: 40px;
    font-size: 16px; font-style: italic; color: #545B64;
  }
  .footer-brand {
    position: absolute; bottom: 26px; left: ${Math.round((width - panelW) / 2 - 120)}px;
    font-size: 26px; font-weight: 700; color: #ED7100;
  }
`;
}

function groupHtml(g) {
  const kind = GROUP_KINDS[g.kind];
  const color = g.color ?? kind.color;
  const dashed = g.dashed ?? kind.dashed;
  const fill = g.fill ?? kind.fill ?? null;
  // `icon: false` drops the corner icon — used for a boundary that is not an AWS
  // construct (a SaaS vendor, another cloud) but should still read as a boundary.
  const iconSpec = g.icon === false ? null : g.icon ?? kind.icon;

  const cls = ['grp', kind.italic ? 'italic' : '', g.sub ? 'sub' : '', iconSpec ? '' : 'no-icon', g.delta ? `delta-${g.delta}` : '']
    .filter(Boolean)
    .join(' ');
  const style = [
    `top:${g.at[1]}px`, `left:${g.at[0]}px`,
    `width:${g.size[0]}px`, `height:${g.size[1]}px`,
    `border:2px ${dashed ? 'dashed' : 'solid'} ${color}`,
    fill ? `background:${fill}` : '',
  ].filter(Boolean).join('; ');

  let inner = '';
  if (iconSpec) {
    const ic = inlineIcon(iconSpec);
    inner += `\n    <img class="grp-icon" src="${ic.dataUri}" alt="">`;
  }
  if (g.label) {
    const ls = [
      g.labelOffset ? `left:${g.labelOffset[0]}px; top:${g.labelOffset[1]}px` : '',
      g.labelSize ? `font-size:${g.labelSize}px` : '',
      kind.italic ? `color:${color}` : '',
    ].filter(Boolean).join('; ');
    inner += `\n    <div class="grp-label"${ls ? ` style="${ls}"` : ''}>${rich(g.label)}</div>`;
  }
  return `  <div${g.id ? ` id="${esc(g.id)}"` : ''} class="${cls}" style="${style}">${inner}\n  </div>`;
}

function nodeHtml(n) {
  const ic = inlineIcon(n.icon);
  const style = `top:${n.at[1]}px; left:${n.at[0]}px; width:${n.width}px`;
  let label = '';
  if (n.label || n.note || n.mono) {
    const parts = [];
    if (n.label) parts.push(rich(n.label));
    if (n.note) parts.push(`<small>${rich(n.note)}</small>`);
    if (n.mono) parts.push(`<span class="mono">${esc(n.mono)}</span>`);
    label = `<div class="label${n.small ? ' sm' : ''}">${parts.join('<br>')}</div>`;
  }
  const img = `<img src="${ic.dataUri}" width="${n.size}" height="${n.size}" alt="${esc(ic.name)}">`;
  const inner = n.labelTop ? `${label}\n    ${img}` : `${img}${label ? '\n    ' + label : ''}`;
  return (
    `  <div class="node${n.labelTop ? ' lbl-top' : ''}${n.delta ? ' delta-' + n.delta : ''}" id="${esc(n.id)}" style="${style}">\n` +
    `    ${inner}\n  </div>`
  );
}

function boxHtml(b) {
  const head = b.head ? `\n    <div class="hd">${rich(b.head)}</div>` : '';
  return (
    `  <div class="note${b.delta ? ' delta-' + b.delta : ''}" style="top:${b.at[1]}px; left:${b.at[0]}px; width:${b.width}px;">${head}\n` +
    `    ${rich(b.text)}\n  </div>`
  );
}

function panelHtml(spec) {
  if (!spec.steps.length && !spec.notes && !spec.panel.head) return '';
  const head = spec.panel.head ? `\n    <div class="panel-head">${rich(spec.panel.head)}</div>` : '';
  const steps = spec.steps
    .map(
      (s) =>
        `    <div class="callout${s.delta ? ' delta-' + s.delta : ''}"><div class="num${s.tone === 'new' ? ' new' : ''}${s.delta ? ' delta-' + s.delta : ''}">${s.n}</div>\n` +
        `      <div class="step-text">${rich(s.text)}</div></div>`
    )
    .join('\n');
  const note = spec.notes ? `\n    <div class="panel-note">${rich(spec.notes)}</div>` : '';
  return `  <div class="callout-panel">${head}\n${steps}${note}\n  </div>`;
}

function legendHtml(spec) {
  if (!spec.legend.length) return '';
  const rows = spec.legend
    .map((l) => {
      const color = l.color ?? '#232F3E';
      const sw = `border: 2px ${l.dashed ? 'dashed' : 'solid'} ${color};` + (l.fill ? ` background:${l.fill};` : '');
      return `    <div class="row"><div class="sw" style="${sw}"></div>${rich(l.text ?? '')}</div>`;
    })
    .join('\n');
  return `  <div class="legend">\n${rows}\n  </div>`;
}

/**
 * @param {object} spec normalized spec
 * @param {'static'|'live'} mode
 */
export function buildHtml(spec, mode = 'static') {
  const live = mode === 'live';

  const arrows = spec.arrows.map((a) => {
    const o = { from: a.from, to: a.to };
    if (a.label) o.label = a.label;
    if (a.step != null) o.step = a.step;
    if (a.dashed) o.dashed = true;
    if (a.both) o.both = true;
    if (a.color) o.color = a.color;
    if (a.mid !== undefined) o.mid = a.mid;
    if (a.width !== undefined) o.width = a.width;
    if (a.labelDx !== undefined) o.labelDx = a.labelDx;
    if (a.labelDy !== undefined) o.labelDy = a.labelDy;
    if (a.delta) o.delta = a.delta;
    return o;
  });

  const config = {
    width: spec.canvas.width,
    height: spec.canvas.height,
    panelWidth: spec.panel.width,
    motion: live ? spec.motion : { ...spec.motion, animation: 'none' },
    mode,
  };

  const canvasNums = spec.steps
    .filter((s) => s.onCanvas && s.at)
    .map(
      (s) =>
        `  <div class="num on-canvas${s.tone === 'new' ? ' new' : ''}${s.delta ? ' delta-' + s.delta : ''}" ` +
        `style="top:${s.at[1]}px; left:${s.at[0]}px;">${s.n}</div>`
    )
    .join('\n');

  const parts = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    `<title>${esc(spec.title)}</title>`,
    '<style>' + styles(spec) + (live ? '\n' + runtime('live.css') : '') + '</style>',
    '</head>',
    '<body>',
    '',
    `  <div class="title">${rich(spec.title)}</div>`,
    spec.subtitle ? `  <div class="subtitle">${rich(spec.subtitle)}</div>` : '',
    '  <div class="title-rule"></div>',
    '',
    spec.groups.length ? '  <!-- groups -->' : '',
    ...spec.groups.map(groupHtml),
    '',
    '  <!-- nodes -->',
    ...spec.nodes.map(nodeHtml),
    '',
    spec.boxes.length ? '  <!-- notes -->' : '',
    ...spec.boxes.map(boxHtml),
    '',
    canvasNums ? '  <!-- step numbers -->' : '',
    canvasNums,
    '',
    legendHtml(spec),
    panelHtml(spec),
    '',
    spec.reviewed ? `  <div class="footer-note">Reviewed for technical accuracy ${esc(spec.reviewed)}</div>` : '',
    spec.brand ? `  <div class="footer-brand">${esc(spec.brand)}</div>` : '',
    '',
    '<script>',
    'window.DIAGRAM_CONFIG = ' + JSON.stringify(config) + ';',
    'const ARROWS = ' + JSON.stringify(arrows, null, 2) + ';',
    '</script>',
    '<script>' + runtime('diagram-lib.js') + '</script>',
    live ? '<script>' + runtime('live.js') + '</script>' : '',
    '</body>',
    '</html>',
    '',
  ];

  return parts.filter((p) => p !== '').join('\n');
}
