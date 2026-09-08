/*
 * live.js — the interactive viewer layer.
 *
 * Reads the graph diagram-lib.js already drew (window.__DIAGRAM__) rather than
 * re-deriving geometry, so what you focus, trace and animate is exactly what
 * was validated and exactly what the PNG shows.
 *
 * Everything here is additive: remove this file and the page is still the
 * finished diagram.
 */
(function () {
  'use strict';

  var D = window.__DIAGRAM__;
  if (!D || !D.drawn) return;

  var CFG = window.DIAGRAM_CONFIG || {};
  var MOTION = CFG.motion || {};
  var root = document.documentElement;
  var edges = D.drawn;

  root.setAttribute('data-live', '1');
  root.style.setProperty('--dur', (MOTION.duration || 2400) + 'ms');
  root.style.setProperty('--stagger', (MOTION.stagger || 160) + 'ms');

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- fit the fixed canvas to the viewport ----------
  function fit() {
    var w = CFG.width || 1920, h = CFG.height || 1080;
    // A viewport of 0 shows up in snapshot/thumbnail renderers; scaling the
    // page to nothing there would hide the diagram entirely.
    var vw = window.innerWidth || w, vh = window.innerHeight || h;
    var scale = Math.min(vw / w, vh / h, 1);
    if (!(scale > 0)) scale = 1;
    root.style.setProperty('--fit', scale);
    document.body.style.width = w + 'px';
    document.body.style.height = h + 'px';
    // reserve the scaled footprint so the page scrolls correctly
    var spacer = document.getElementById('aa-spacer') || (function () {
      var s = document.createElement('div');
      s.id = 'aa-spacer';
      s.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      document.documentElement.appendChild(s);
      return s;
    })();
    spacer.style.width = w * scale + 'px';
    spacer.style.height = h * scale + 'px';
  }
  fit();
  window.addEventListener('resize', fit);

  // ---------- signal packets ----------
  // One dot per edge, riding the exact path the router produced.
  var packets = [];
  if (!reduced) {
    edges.forEach(function (e) {
      var d = e.el.getAttribute('d');
      var dot = document.createElement('div');
      dot.className = 'aa-packet';
      dot.style.offsetPath = 'path("' + d + '")';
      dot.style.setProperty('--step', e.order);
      if (e.spec.color && e.spec.color !== '#232F3E') {
        dot.style.setProperty('--packet', e.spec.color);
        dot.style.boxShadow = '0 0 9px 2px ' + e.spec.color + '80';
      }
      dot.setAttribute('data-edge', String(e.index));
      document.body.appendChild(dot);
      packets.push(dot);
    });
  }

  // ---------- trace playback ----------
  var playTimer = null;

  function totalRunMs() {
    var maxStep = edges.reduce(function (m, e) { return Math.max(m, e.order); }, 0);
    return maxStep * (MOTION.stagger || 160) + (MOTION.duration || 2400) + 800;
  }

  function play() {
    if (reduced) return;
    clearTimeout(playTimer);
    root.removeAttribute('data-motion');
    // force a reflow so re-adding the attribute restarts the animations
    void document.body.offsetWidth;
    root.setAttribute('data-motion', 'playing');
    setBtn('play', true);
    playTimer = setTimeout(function () {
      root.removeAttribute('data-motion');
      setBtn('play', false);
    }, totalRunMs());
  }

  // ---------- focus & route ----------
  var focusId = null;
  var routeSeed = null;

  function clearHighlight() {
    root.removeAttribute('data-focus');
    focusId = null;
    routeSeed = null;
    linkState.focus = null;
    linkState.route = null;
    writeHash();
    document.querySelectorAll('.aa-lit, .aa-seed').forEach(function (el) {
      el.classList.remove('aa-lit', 'aa-seed');
    });
    setBtn('route', false);
    hint(null);
  }

  function lightEdge(e) {
    e.el.classList.add('aa-lit');
    if (e.labelEl) e.labelEl.classList.add('aa-lit');
    var node = document.getElementById(e.from.id);
    var node2 = document.getElementById(e.to.id);
    if (node) node.classList.add('aa-lit');
    if (node2) node2.classList.add('aa-lit');
    if (e.spec.step != null) {
      document.querySelectorAll('.num.on-canvas').forEach(function (n) {
        if (parseInt(n.textContent.trim(), 10) === e.spec.step) n.classList.add('aa-lit');
      });
    }
  }

  /** Everything one hop from `id`, in both directions. */
  function focusNode(id) {
    clearHighlight();
    focusId = id;
    linkState.focus = id;
    writeHash();
    root.setAttribute('data-focus', 'node');
    var seed = document.getElementById(id);
    if (seed) seed.classList.add('aa-lit', 'aa-seed');
    var touched = 0;
    edges.forEach(function (e) {
      if (e.from.id === id || e.to.id === id) { lightEdge(e); touched++; }
    });
    var label = nodeName(id);
    hint(
      '<b>' + esc(label) + '</b> — ' + touched + ' direct connection' + (touched === 1 ? '' : 's') +
      '. <kbd>R</kbd> then another node to trace a route · <kbd>Esc</kbd> to clear'
    );
  }

  /** Shortest directed route seed -> target over the authored arrows. */
  function traceRoute(fromId, toId) {
    var adj = {};
    edges.forEach(function (e) {
      (adj[e.from.id] = adj[e.from.id] || []).push(e);
      if (e.spec.both) (adj[e.to.id] = adj[e.to.id] || []).push({ __rev: true, e: e, from: e.to, to: e.from });
    });
    var queue = [[fromId, []]], seen = {};
    seen[fromId] = true;
    while (queue.length) {
      var cur = queue.shift(), at = cur[0], via = cur[1];
      if (at === toId) return via;
      (adj[at] || []).forEach(function (link) {
        var edge = link.__rev ? link.e : link;
        var next = link.__rev ? link.from.id : link.to.id;
        if (seen[next]) return;
        seen[next] = true;
        queue.push([next, via.concat([edge])]);
      });
    }
    return null;
  }

  function showRoute(fromId, toId) {
    var path = traceRoute(fromId, toId);
    clearHighlight();
    linkState.route = [fromId, toId];
    writeHash();
    root.setAttribute('data-focus', 'route');
    var a = nodeName(fromId), b = nodeName(toId);
    if (!path) {
      hint('No directed route from <b>' + esc(a) + '</b> to <b>' + esc(b) + '</b> in the authored arrows.');
      var s1 = document.getElementById(fromId), s2 = document.getElementById(toId);
      if (s1) s1.classList.add('aa-lit', 'aa-seed');
      if (s2) s2.classList.add('aa-lit');
      return;
    }
    path.forEach(lightEdge);
    var seed = document.getElementById(fromId);
    if (seed) seed.classList.add('aa-seed');
    hint(
      '<b>' + esc(a) + '</b> &rarr; <b>' + esc(b) + '</b> · ' + path.length + ' hop' +
      (path.length === 1 ? '' : 's') + ' · <kbd>Esc</kbd> to clear'
    );
  }

  function nodeName(id) {
    var el = document.getElementById(id);
    var lab = el && el.querySelector('.label');
    return lab ? lab.textContent.trim().replace(/\s+/g, ' ') : id;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- deep links ----------
  // The viewer state that matters for "look at this" lives in the hash, so a
  // pasted URL opens on the same node, route or theme. Nothing else is stored.
  var linkState = { focus: null, route: null };

  function readHash() {
    var out = {};
    String(location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      out[k] = v;
    });
    return out;
  }

  function writeHash() {
    var parts = [];
    if (linkState.route) parts.push('route=' + encodeURIComponent(linkState.route.join(',')));
    else if (linkState.focus) parts.push('focus=' + encodeURIComponent(linkState.focus));
    if (root.getAttribute('data-theme') === 'dark') parts.push('theme=dark');
    var h = parts.length ? '#' + parts.join('&') : '';
    if (h !== location.hash && (h || location.hash)) {
      try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) {}
    }
  }

  function copyLink() {
    writeHash();
    var url = location.href;
    var done = function () { hint('Link copied — it opens on this exact view. <kbd>Esc</kbd> to clear'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { hint('Copy this: <code>' + esc(url) + '</code>'); });
    } else {
      hint('Copy this: <code>' + esc(url) + '</code>');
    }
  }

  // ---------- chrome ----------
  var hintEl = null;
  function hint(html) {
    if (!html) {
      if (hintEl) { hintEl.remove(); hintEl = null; }
      return;
    }
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'aa-hint';
      document.documentElement.appendChild(hintEl);
    }
    hintEl.innerHTML = html;
  }

  var buttons = {};
  function setBtn(name, on) {
    if (buttons[name]) buttons[name].setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function toolbar() {
    var bar = document.createElement('div');
    bar.className = 'aa-toolbar';
    var items = [
      ['play', 'Replay', play],
      ['route', 'Route', function () {
        if (!focusId) { hint('Click a node first, then press <kbd>R</kbd> and click its destination.'); return; }
        routeSeed = focusId;
        setBtn('route', true);
        hint('Route from <b>' + esc(nodeName(routeSeed)) + '</b> — click the destination node.');
      }],
      [null],
      ['theme', 'Theme', function () {
        var dark = root.getAttribute('data-theme') === 'dark';
        root.setAttribute('data-theme', dark ? 'light' : 'dark');
        setBtn('theme', !dark);
        writeHash();
      }],
      ['link', 'Copy link', copyLink],
      ['print', 'Print / PDF', function () { clearHighlight(); window.print(); }],
      ['help', 'Keys', function () {
        hint(
          '<kbd>Space</kbd> replay · <kbd>R</kbd> route from focused node · ' +
          '<kbd>T</kbd> theme · <kbd>L</kbd> copy link · <kbd>P</kbd> print · <kbd>Esc</kbd> clear · click a node to focus'
        );
      }],
    ];
    items.forEach(function (it) {
      if (!it[0]) {
        var sep = document.createElement('div');
        sep.className = 'aa-sep';
        bar.appendChild(sep);
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = it[1];
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', it[2]);
      buttons[it[0]] = b;
      bar.appendChild(b);
    });
    document.documentElement.appendChild(bar);
  }

  // ---------- wiring ----------
  document.querySelectorAll('.node[id]').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (routeSeed && routeSeed !== el.id) { showRoute(routeSeed, el.id); return; }
      if (focusId === el.id) { clearHighlight(); return; }
      focusNode(el.id);
    });
  });

  document.body.addEventListener('click', function (ev) {
    if (!ev.target.closest('.node')) clearHighlight();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var k = ev.key.toLowerCase();
    if (k === 'escape') return clearHighlight();
    if (k === ' ') { ev.preventDefault(); return play(); }
    if (k === 't') return buttons.theme.click();
    if (k === 'r') return buttons.route.click();
    if (k === 'p') { ev.preventDefault(); return buttons.print.click(); }
    if (k === 'l') return copyLink();
    if (k === '?' || k === '/') { ev.preventDefault(); return buttons.help.click(); }
  });

  toolbar();

  // Restore a deep-linked view. A linked focus/route is what the reader was
  // sent to see, so it wins over the opening trace.
  var linked = readHash();
  if (linked.theme === 'dark') root.setAttribute('data-theme', 'dark');
  if (root.getAttribute('data-theme') === 'dark') setBtn('theme', true);
  var linkedView = false;
  if (linked.route) {
    var ends = linked.route.split(',');
    if (ends.length === 2 && document.getElementById(ends[0]) && document.getElementById(ends[1])) {
      showRoute(ends[0], ends[1]);
      linkedView = true;
    }
  } else if (linked.focus && document.getElementById(linked.focus)) {
    focusNode(linked.focus);
    linkedView = true;
  }

  // The trace is the first thing a reader sees; after it settles the page is
  // identical to the static render.
  if (!linkedView && (MOTION.animation || 'trace') === 'trace') play();
})();
