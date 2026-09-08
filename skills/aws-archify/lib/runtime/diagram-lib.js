/*
 * diagram-lib.js — anchor-based orthogonal arrows + geometry validator.
 *
 * Grown from the hand-authored library used for the ITC AWS Reference
 * Architecture diagrams. Two things changed when the source became JSON:
 *
 *  - arrows carry a `step`, so the trace animation and the callout numbering
 *    are driven by the same ordering the author already wrote down;
 *  - the drawn graph is published on window.__DIAGRAM__ for the live viewer
 *    (focus, route tracing) to read without re-deriving any geometry.
 *
 * The validator still runs in every mode. A rendered PNG of a broken diagram
 * must be unmistakably broken.
 */
(function () {
  'use strict';

  var CFG = window.DIAGRAM_CONFIG || {};
  var CANVAS_W = CFG.width || 1920;
  var CANVAS_H = CFG.height || 1080;
  var COLOR = '#232F3E';
  var GAP = 4; // px between an arrowhead/tail and the icon edge
  var MIN_SPACING = 24; // required distance between parallel runs
  // Anchors this close to aligned are treated as aligned. Two nodes drawn with
  // different icon sizes (84 vs 88) have centres 2px apart, which without a
  // tolerance produces a visible 2px staircase and drags the arrow's label to
  // the middle of one half instead of the middle of the run.
  var SNAP = 10;

  // ---------- helpers ----------
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2, el: el,
    };
  }

  function parseAnchor(spec) {
    var p = String(spec).split(':');
    var el = document.getElementById(p[0]);
    if (!el) throw new Error('no node with id "' + p[0] + '"');
    var img = el.querySelector('img');
    var r = rectOf(img || el);
    var side = p[1] || 'right';
    var off = p.length > 2 ? parseFloat(p[2]) : 0;
    var pt;
    if (side === 'left') pt = { x: r.left - GAP, y: r.cy + off };
    if (side === 'right') pt = { x: r.right + GAP, y: r.cy + off };
    if (side === 'top') pt = { x: r.cx + off, y: r.top - GAP };
    if (side === 'bottom') pt = { x: r.cx + off, y: r.bottom + GAP };
    if (!pt) throw new Error('bad side "' + side + '" in "' + spec + '"');
    return { pt: pt, side: side, rect: r, id: p[0] };
  }

  function axisOf(side) {
    return side === 'left' || side === 'right' ? 'h' : 'v';
  }

  // Orthogonal route: the first segment leaves along from.side, the last enters
  // along to.side. 0, 1 or 2 bends, never a diagonal.
  function routePoints(a, b, mid) {
    var p1 = a.pt, p2 = b.pt, ax1 = axisOf(a.side), ax2 = axisOf(b.side);
    if (ax1 === 'h' && ax2 === 'h') {
      if (Math.abs(p1.y - p2.y) <= SNAP) {
        var y = (p1.y + p2.y) / 2;
        return [{ x: p1.x, y: y }, { x: p2.x, y: y }];
      }
      var mx = mid !== undefined ? mid : (p1.x + p2.x) / 2;
      return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
    if (ax1 === 'v' && ax2 === 'v') {
      if (Math.abs(p1.x - p2.x) <= SNAP) {
        var x = (p1.x + p2.x) / 2;
        return [{ x: x, y: p1.y }, { x: x, y: p2.y }];
      }
      var my = mid !== undefined ? mid : (p1.y + p2.y) / 2;
      return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
    if (ax1 === 'h') return [p1, { x: p2.x, y: p1.y }, p2]; // h then v
    return [p1, { x: p1.x, y: p2.y }, p2]; // v then h
  }

  function toSegments(pts) {
    var segs = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var s = { x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y };
      s.axis = Math.abs(s.y1 - s.y2) < 0.5 ? 'h' : 'v';
      segs.push(s);
    }
    return segs;
  }

  function pathLength(pts) {
    var total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    }
    return total;
  }

  // ---------- drawing ----------
  function draw() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'diagram-edges');
    svg.setAttribute(
      'style',
      'position:absolute;top:0;left:0;width:' + CANVAS_W + 'px;height:' + CANVAS_H + 'px;pointer-events:none;'
    );
    var defs = document.createElementNS(svg.namespaceURI, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);

    var markers = {};
    function markerFor(color) {
      if (markers[color]) return markers[color];
      var id = 'arrow-' + color.replace(/[^a-zA-Z0-9]/g, '');
      var m = document.createElementNS(svg.namespaceURI, 'marker');
      m.setAttribute('id', id);
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('refX', '9');
      m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7');
      m.setAttribute('markerHeight', '7');
      m.setAttribute('orient', 'auto-start-reverse');
      var p = document.createElementNS(svg.namespaceURI, 'path');
      p.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      p.setAttribute('fill', color);
      m.appendChild(p);
      defs.appendChild(m);
      markers[color] = 'url(#' + id + ')';
      return markers[color];
    }

    // `const ARROWS` in another top-level script is a global binding but NOT a
    // window property — read the bare identifier, fall back to window.
    var arrowSpecs = typeof ARROWS !== 'undefined' ? ARROWS : window.ARROWS || [];

    // Trace order: an authored `step` wins, otherwise declaration order. Both
    // are 0-based here because the CSS delay multiplies by --step.
    var ordered = arrowSpecs.map(function (s, i) { return { s: s, i: i }; });
    var stepped = ordered.filter(function (o) { return o.s.step != null; });
    var minStep = stepped.length ? Math.min.apply(null, stepped.map(function (o) { return o.s.step; })) : 1;

    var drawn = [];
    arrowSpecs.forEach(function (spec, i) {
      var a = parseAnchor(spec.from), b = parseAnchor(spec.to);
      var pts = routePoints(a, b, spec.mid);
      var color = spec.color || COLOR;
      var order = spec.step != null ? spec.step - minStep : i;

      var path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute(
        'd',
        pts.map(function (p, j) { return (j ? 'L ' : 'M ') + p.x + ' ' + p.y; }).join(' ')
      );
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', spec.width || 2.5);
      if (spec.dashed) path.setAttribute('stroke-dasharray', '6 5');
      path.setAttribute('marker-end', markerFor(color));
      if (spec.both) path.setAttribute('marker-start', markerFor(color));
      path.setAttribute('data-animate', 'edge');
      path.setAttribute('data-edge', String(i));
      path.setAttribute('data-from', a.id);
      path.setAttribute('data-to', b.id);
      path.style.setProperty('--step', order);
      // A dashed relationship keeps its dash pattern; the trace animation owns
      // stroke-dasharray, so only solid edges may be animated that way.
      path.style.setProperty('--len', Math.round(pathLength(pts)));
      if (spec.dashed) path.setAttribute('data-dashed', '1');
      svg.appendChild(path);

      var labelEl = null;
      if (spec.label) {
        var segs = toSegments(pts);
        var longest = segs.reduce(
          function (best, s) {
            var len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
            return len > best.len ? { s: s, len: len } : best;
          },
          { s: segs[0], len: -1 }
        ).s;
        labelEl = document.createElement('div');
        labelEl.className = 'arrow-label';
        labelEl.textContent = spec.label;
        labelEl.setAttribute('data-animate', 'edge-label');
        labelEl.setAttribute('data-edge', String(i));
        labelEl.style.setProperty('--step', order);
        var lx = (longest.x1 + longest.x2) / 2 + (spec.labelDx || 0);
        var ly = (longest.y1 + longest.y2) / 2 + (spec.labelDy || 0);
        labelEl.style.left = lx + 'px';
        labelEl.style.top = ly + 'px';
        labelEl.style.transform = 'translate(-50%, -50%)';
        if (longest.axis === 'h' && spec.labelDy === undefined) {
          labelEl.style.transform = 'translate(-50%, -100%)';
          labelEl.style.top = ly - 4 + 'px';
        }
        document.body.appendChild(labelEl);
      }

      drawn.push({
        spec: spec, index: i, order: order, points: pts, segs: toSegments(pts),
        from: a, to: b, el: path, labelEl: labelEl,
      });
    });

    // Step badges and nodes animate on the same clock as the edge that reaches
    // them, so the eye follows one signal instead of three unrelated ones.
    document.querySelectorAll('.num.on-canvas').forEach(function (el) {
      var n = parseInt(el.textContent.trim(), 10);
      var owner = drawn.find(function (d) { return d.spec.step === n; });
      el.style.setProperty('--step', owner ? owner.order : Math.max(0, n - minStep));
    });
    document.querySelectorAll('.node').forEach(function (el) {
      var incoming = drawn.filter(function (d) { return d.to.id === el.id; });
      var order = incoming.length
        ? Math.min.apply(null, incoming.map(function (d) { return d.order; }))
        : 0;
      el.style.setProperty('--step', order);
    });

    return drawn;
  }

  // ---------- validation ----------
  function segIntersectsRect(s, r, pad) {
    pad = pad || 0;
    var L = r.left - pad, R = r.right + pad, T = r.top - pad, B = r.bottom + pad;
    if (s.axis === 'h') {
      var xa = Math.min(s.x1, s.x2), xb = Math.max(s.x1, s.x2);
      return s.y1 > T && s.y1 < B && xb > L && xa < R;
    }
    var ya = Math.min(s.y1, s.y2), yb = Math.max(s.y1, s.y2);
    return s.x1 > L && s.x1 < R && yb > T && ya < B;
  }

  function rectsOverlap(a, b, pad) {
    pad = pad || 0;
    return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
  }

  function shrinkSeg(s, amt) {
    var out = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, axis: s.axis };
    if (s.axis === 'h') {
      var dir = s.x2 > s.x1 ? 1 : -1;
      out.x1 += dir * amt;
      out.x2 -= dir * amt;
      if ((out.x2 - out.x1) * dir < 0) out.x2 = out.x1;
    } else {
      var d = s.y2 > s.y1 ? 1 : -1;
      out.y1 += d * amt;
      out.y2 -= d * amt;
      if ((out.y2 - out.y1) * d < 0) out.y2 = out.y1;
    }
    return out;
  }

  function describe(el) {
    var t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return '"' + (t.length > 40 ? t.slice(0, 40) + '…' : t) + '"';
  }

  function validate(drawn) {
    var issues = [];
    var panel = document.querySelector('.callout-panel');
    var panelLeft = panel ? rectOf(panel).left : CANVAS_W;

    function inPanel(el) {
      return panel && panel.contains(el);
    }

    var labels = [], nums = [], arrowLabels = [], icons = [], grpLabels = [], notes = [];
    document.querySelectorAll('.note').forEach(function (el) { notes.push(rectOf(el)); });
    document.querySelectorAll('.node .label').forEach(function (el) { labels.push(rectOf(el)); });
    document.querySelectorAll('.num').forEach(function (el) { if (!inPanel(el)) nums.push(rectOf(el)); });
    document.querySelectorAll('.arrow-label').forEach(function (el) { arrowLabels.push(rectOf(el)); });
    document.querySelectorAll('.node img').forEach(function (el) { icons.push(rectOf(el)); });
    document.querySelectorAll('.grp .grp-label').forEach(function (el) { grpLabels.push(rectOf(el)); });

    var obstacles = labels.concat(nums, arrowLabels, icons, grpLabels, notes);

    // 1) arrow segments must not cross any text, number or icon
    drawn.forEach(function (arr) {
      arr.segs.forEach(function (rawSeg) {
        var seg = shrinkSeg(rawSeg, 10); // ignore the immediate ends
        obstacles.forEach(function (r) {
          if (arr.labelEl && r.el === arr.labelEl) return;
          if (r.el === arr.from.rect.el || r.el === arr.to.rect.el) return;
          if (segIntersectsRect(seg, r, 1)) {
            issues.push(
              'arrow #' + arr.index + ' (' + arr.spec.from + ' -> ' + arr.spec.to + ') crosses ' +
                r.el.className + ' ' + describe(r.el)
            );
          }
        });
      });
    });

    // 2) numbers and arrow labels must not overlap other text or icons
    var seen = {};
    nums.concat(arrowLabels).forEach(function (a) {
      obstacles.forEach(function (b) {
        if (a.el === b.el) return;
        if (!rectsOverlap(a, b)) return;
        var key = [a.el.className, describe(a.el), b.el.className, describe(b.el)].join('|');
        var rev = [b.el.className, describe(b.el), a.el.className, describe(a.el)].join('|');
        if (seen[rev]) return;
        seen[key] = true;
        issues.push(
          a.el.className + ' ' + describe(a.el) + ' overlaps ' + b.el.className + ' ' + describe(b.el)
        );
      });
    });

    // 3) parallel runs of different arrows closer than MIN_SPACING
    for (var i = 0; i < drawn.length; i++) {
      for (var j = i + 1; j < drawn.length; j++) {
        (function (A, B) {
          A.segs.forEach(function (s1) {
            B.segs.forEach(function (s2) {
              if (s1.axis !== s2.axis) return;
              var d, o1a, o1b, o2a, o2b;
              if (s1.axis === 'h') {
                d = Math.abs(s1.y1 - s2.y1);
                o1a = Math.min(s1.x1, s1.x2); o1b = Math.max(s1.x1, s1.x2);
                o2a = Math.min(s2.x1, s2.x2); o2b = Math.max(s2.x1, s2.x2);
              } else {
                d = Math.abs(s1.x1 - s2.x1);
                o1a = Math.min(s1.y1, s1.y2); o1b = Math.max(s1.y1, s1.y2);
                o2a = Math.min(s2.y1, s2.y2); o2b = Math.max(s2.y1, s2.y2);
              }
              var overlap = Math.min(o1b, o2b) - Math.max(o1a, o2a);
              if (d > 0.5 && d < MIN_SPACING && overlap > 20) {
                issues.push(
                  'arrows #' + A.index + ' and #' + B.index + ' run parallel only ' +
                    Math.round(d) + 'px apart (need ' + MIN_SPACING + ')'
                );
              }
            });
          });
        })(drawn[i], drawn[j]);
      }
    }

    // 4) everything stays on the canvas and out of the callout panel
    obstacles.forEach(function (r) {
      if (r.right > panelLeft - 4) {
        issues.push(r.el.className + ' ' + describe(r.el) + ' intrudes into the callout panel');
      }
      if (r.left < 0 || r.top < 0 || r.bottom > CANVAS_H) {
        issues.push(r.el.className + ' ' + describe(r.el) + ' is outside the canvas');
      }
    });
    drawn.forEach(function (arr) {
      arr.segs.forEach(function (s) {
        if (Math.max(s.x1, s.x2) > panelLeft - 4) {
          issues.push('arrow #' + arr.index + ' reaches into the callout panel');
        }
      });
    });

    // 5) canvas step numbers must match the callout panel numbers.
    //    The builder guarantees this; kept as a net for hand-edited output.
    if (panel) {
      var canvasNums = nums.map(function (r) { return r.el.textContent.trim(); }).sort();
      var panelNums = [];
      panel.querySelectorAll('.num').forEach(function (el) { panelNums.push(el.textContent.trim()); });
      panelNums.sort();
      if (canvasNums.join(',') !== panelNums.join(',')) {
        issues.push(
          'step numbers on canvas [' + canvasNums + '] differ from the callout panel [' + panelNums + ']'
        );
      }
    }

    return issues;
  }

  function report(issues) {
    if (!issues.length) {
      console.log('DIAGRAM-VALIDATION: PASS');
      document.title = 'PASS - ' + document.title;
      return;
    }
    console.error('DIAGRAM-VALIDATION: FAIL', JSON.stringify(issues, null, 2));
    document.title = 'FAIL(' + issues.length + ') - ' + document.title;
    var banner = document.createElement('div');
    banner.id = 'diagram-validation-banner';
    banner.setAttribute(
      'style',
      'position:absolute;top:8px;right:500px;max-width:800px;z-index:99;' +
        'background:#B2152A;color:#fff;font:600 15px/1.4 "Segoe UI",sans-serif;' +
        'padding:10px 14px;border-radius:4px;white-space:pre-wrap;'
    );
    banner.textContent =
      'VALIDATION FAILED (' + issues.length + ')\n' +
      issues.slice(0, 8).map(function (s) { return '• ' + s; }).join('\n') +
      (issues.length > 8 ? '\n… +' + (issues.length - 8) + ' more (see console)' : '');
    document.body.appendChild(banner);
  }

  try {
    var drawn = draw();
    var issues = validate(drawn);
    window.__DIAGRAM__ = { drawn: drawn, issues: issues, config: CFG };
    report(issues);
    document.documentElement.setAttribute('data-diagram-ready', '1');
  } catch (e) {
    document.title = 'FAIL(script) - ' + document.title;
    var b = document.createElement('div');
    b.id = 'diagram-validation-banner';
    b.setAttribute(
      'style',
      'position:absolute;top:8px;right:500px;z-index:99;background:#B2152A;color:#fff;' +
        'font:600 16px sans-serif;padding:10px 14px;'
    );
    b.textContent = 'diagram-lib error: ' + e.message;
    document.body.appendChild(b);
    window.__DIAGRAM__ = { drawn: [], issues: ['script error: ' + e.message], config: CFG };
    console.error(e);
  }
})();
