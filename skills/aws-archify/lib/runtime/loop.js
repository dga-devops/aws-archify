/*
 * loop.js — a seekable, endlessly repeating data-flow animation.
 *
 * The live viewer's trace is finite on purpose: it plays once and settles into
 * the static diagram. A GIF has no settled state to arrive at — it *is* the
 * animation — so the constraint is restated for the medium:
 *
 *   every single frame must be a complete, readable diagram, and the first
 *   frame must be the static one.
 *
 * Nothing on the page ever moves or disappears. Packets travel along the
 * arrows the router already drew, step badges pulse while their step is
 * running, and the matching sentence in the callout panel lights up. The first
 * frame is identical to the PNG, because Slack previews, Confluence, email
 * clients with animation off and PDF exports show only the first frame.
 *
 * Time is driven explicitly through window.__LOOP__.seek(ms), so a capture
 * tool can grab frame N at exactly t = N / fps without racing a clock.
 */
(function () {
  'use strict';

  var D = window.__DIAGRAM__;
  if (!D || !D.drawn) return;

  var CFG = window.DIAGRAM_CONFIG || {};
  var L = CFG.loop || {};
  var ACCENT = L.color || '#ED7100';
  var INK = '#232F3E';

  var HOLD = num(L.hold, 1200);       // rest on the static diagram, at the start
  var TRAVEL = num(L.travel, 1100);   // one packet crossing one edge
  var OVERLAP = num(L.overlap, 250);  // the next step starts before this one lands
  var GLOW = 450;                     // arrival glow on the target node
  var TAIL = GLOW + 250;              // let the last glow fade before wrapping

  function num(v, d) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : d; }

  var edges = D.drawn.filter(function (e) { return !e.ghost; });
  if (!edges.length) {
    window.__LOOP__ = { total: HOLD, frames: 1, seek: function () {} };
    return;
  }

  // ---------- timeline ----------
  // Arrows sharing a step move together; phases run in step order.
  var orders = [];
  edges.forEach(function (e) { if (orders.indexOf(e.order) < 0) orders.push(e.order); });
  orders.sort(function (a, b) { return a - b; });
  var STRIDE = Math.max(1, TRAVEL - OVERLAP);
  var phaseStart = {};
  orders.forEach(function (o, i) { phaseStart[o] = HOLD + i * STRIDE; });
  var TOTAL = HOLD + (orders.length - 1) * STRIDE + TRAVEL + TAIL;

  // ---------- geometry ----------
  function lengthOf(pts) {
    var s = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      s += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    }
    return s;
  }

  function pointAt(pts, s) {
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (s <= seg || i === pts.length - 2) {
        var f = seg ? Math.min(1, Math.max(0, s / seg)) : 0;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      s -= seg;
    }
    return pts[pts.length - 1];
  }

  function ease(x) { return 0.5 - 0.5 * Math.cos(Math.PI * x); }

  // ---------- overlays ----------
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('diagram-edges');
  var layer = document.createElementNS(NS, 'g');
  layer.setAttribute('id', 'loop-layer');
  svg.appendChild(layer);

  // A comet: three stacked trails of decreasing length and increasing
  // opacity, then the packet itself. SVG cannot fade a stroke along a path,
  // so the fade is built from layers.
  //
  // Sized for where a GIF is actually seen: a chat preview shrinks a 1920
  // page to roughly a third, and a packet drawn at icon-label scale becomes
  // a two-pixel speck there. `size` scales all of it.
  var K = num(L.size, 1.5);
  var TRAILS = [
    { len: 120 * K, width: 8 * K, opacity: 0.16 },
    { len: 64 * K, width: 6 * K, opacity: 0.32 },
    { len: 24 * K, width: 4.5 * K, opacity: 0.8 },
  ];

  var tracks = edges.map(function (e) {
    var color = e.spec.color && e.spec.color !== INK ? e.spec.color : ACCENT;
    var d = e.el.getAttribute('d');
    var len = lengthOf(e.points);
    var g = document.createElementNS(NS, 'g');
    g.setAttribute('visibility', 'hidden');
    var trails = TRAILS.map(function (t) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', color);
      p.setAttribute('stroke-width', t.width);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-opacity', t.opacity);
      g.appendChild(p);
      return { el: p, len: t.len };
    });
    var halo = document.createElementNS(NS, 'circle');
    halo.setAttribute('r', 12 * K);
    halo.setAttribute('fill', color);
    halo.setAttribute('fill-opacity', 0.22);
    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('r', 6 * K);
    dot.setAttribute('fill', color);
    dot.setAttribute('stroke', '#FFFFFF');
    dot.setAttribute('stroke-width', 2 * K);
    g.appendChild(halo);
    g.appendChild(dot);
    layer.appendChild(g);
    return { edge: e, g: g, trails: trails, halo: halo, dot: dot, len: len, color: color };
  });

  // Step badge on the canvas and its sentence in the panel, keyed by number.
  var badges = {}, rows = {};
  document.querySelectorAll('.num.on-canvas').forEach(function (el) {
    badges[el.textContent.trim()] = el;
  });
  document.querySelectorAll('.callout-panel .callout').forEach(function (row) {
    var n = row.querySelector('.num');
    if (n) rows[n.textContent.trim()] = row;
  });

  var style = document.createElement('style');
  style.textContent =
    '.callout.loop-active{background:rgba(237,113,0,.09);box-shadow:-8px 0 0 rgba(237,113,0,.09),8px 0 0 rgba(237,113,0,.09);border-radius:4px}' +
    '.num.on-canvas{transform-origin:50% 50%}';
  document.head.appendChild(style);

  // Which edges arrive at each node, for the arrival glow.
  var arrivals = {};
  tracks.forEach(function (t) {
    var id = t.edge.to.id;
    (arrivals[id] = arrivals[id] || []).push(t);
  });

  // ---------- one frame ----------
  function seek(ms) {
    var t = ((ms % TOTAL) + TOTAL) % TOTAL;
    var activeSteps = {};

    tracks.forEach(function (tr) {
      var start = phaseStart[tr.edge.order];
      var local = (t - start) / TRAVEL;
      if (local < 0 || local > 1) {
        tr.g.setAttribute('visibility', 'hidden');
        return;
      }
      if (tr.edge.spec.step != null) {
        var k = String(tr.edge.spec.step);
        activeSteps[k] = Math.max(activeSteps[k] || 0, Math.sin(Math.PI * local));
      }
      var s = ease(local) * tr.len;
      var p = pointAt(tr.edge.points, s);
      tr.g.setAttribute('visibility', 'visible');
      tr.dot.setAttribute('cx', p.x.toFixed(2));
      tr.dot.setAttribute('cy', p.y.toFixed(2));
      tr.halo.setAttribute('cx', p.x.toFixed(2));
      tr.halo.setAttribute('cy', p.y.toFixed(2));
      tr.trails.forEach(function (tl) {
        var from = Math.max(0, s - tl.len);
        var dash = Math.max(0.01, s - from);
        tl.el.setAttribute('stroke-dasharray', dash.toFixed(2) + ' ' + (tr.len * 2 + 400).toFixed(0));
        tl.el.setAttribute('stroke-dashoffset', (-from).toFixed(2));
      });
    });

    // badges pulse and panel rows light up while their step runs
    Object.keys(badges).forEach(function (k) {
      var el = badges[k], a = activeSteps[k] || 0;
      if (a > 0) {
        el.style.transform = 'scale(' + (1 + 0.16 * a).toFixed(3) + ')';
        el.style.boxShadow = '0 0 0 ' + (5 * a).toFixed(1) + 'px rgba(237,113,0,' + (0.35 * a).toFixed(3) + ')';
      } else {
        el.style.transform = '';
        el.style.boxShadow = '';
      }
    });
    Object.keys(rows).forEach(function (k) {
      rows[k].classList.toggle('loop-active', (activeSteps[k] || 0) > 0);
    });

    // a node glows briefly as a packet lands on it
    Object.keys(arrivals).forEach(function (id) {
      var node = document.getElementById(id);
      var img = node && node.querySelector('img');
      if (!img) return;
      var glow = 0;
      arrivals[id].forEach(function (tr) {
        var landed = phaseStart[tr.edge.order] + TRAVEL;
        var since = t - landed;
        if (since >= -80 && since <= GLOW) glow = Math.max(glow, 1 - Math.max(0, since) / GLOW);
      });
      img.style.filter = glow > 0.02
        ? 'drop-shadow(0 0 ' + (4 + 10 * glow).toFixed(1) + 'px rgba(237,113,0,' + (0.85 * glow).toFixed(3) + '))'
        : '';
    });
  }

  seek(0);

  window.__LOOP__ = {
    total: TOTAL,
    phases: orders.length,
    seek: seek,
  };

  // Opened directly in a browser, it plays; a capture tool turns this off and
  // drives seek() itself.
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (L.autoplay && !reduced && window.requestAnimationFrame) {
    var t0 = null;
    var tick = function (now) {
      if (t0 === null) t0 = now;
      seek(now - t0);
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }
})();
