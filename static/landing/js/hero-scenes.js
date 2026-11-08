/* Hero word scenes (GSAP 3 + MorphSVG / MotionPath / DrawSVG, vendored in vendor/gsap).
   Each scene is an SVG illustration built around the real letters of the word, which stay
   real text (aria-label on the word), so they reflow with the font and screen size.

     HeroScenes.mount(stageEl, { scenes: ['tracing', ...], loop: true, onChange(i, scene) })
       -> { play(i), next(), prev(), pause(), resume(), destroy() }

   Layout contract (css/hero-scenes.css): .hs-stage is 2.45 font-sizes tall; the word sits
   on a baseline about 1.75 font-sizes down, leaving room above for machines (trommel, robot,
   cameras) and a little below for decks and conveyors. Pauses off-screen and in hidden tabs.
   prefers-reduced-motion: the word is shown still, no scene. */
(function () {
  'use strict';
  var g = window.gsap;
  if (!g) return;
  g.registerPlugin(window.MorphSVGPlugin, window.MotionPathPlugin, window.DrawSVGPlugin);

  var NS = 'http://www.w3.org/2000/svg';
  var C = { i9: '#121A14', i7: '#33413A', i5: '#5C6B62', i3: '#9AA79F', i2: '#CBD4CE', i1: '#E8EDEA', i05: '#F5F7F5',
    g9: '#0B3D22', g8: '#0E5230', g7: '#0F7A3E', g6: '#0FA14E', g4: '#57C97F', g3: '#7ED356', g2: '#BFEBC9', g1: '#E4F6E9',
    amber: '#C77D1B', red: '#C2402F', sky: '#2380B8', skyL: '#6FB8DE', dirt: '#8B8070', dirtD: '#6E6457', coal: '#26231F' };
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ helpers
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function f1(v) { return Math.round(v * 10) / 10; }
  function smooth(pts) {             // Catmull-Rom through the points -> cubic Bezier path
    var d = 'M' + f1(pts[0][0]) + ',' + f1(pts[0][1]);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ' C' + f1(p1[0] + (p2[0] - p0[0]) / 6) + ',' + f1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        f1(p2[0] - (p3[0] - p1[0]) / 6) + ',' + f1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + f1(p2[0]) + ',' + f1(p2[1]);
    }
    return d;
  }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function poly(cx, cy, r, n, jitter, R) {
    var pts = [];
    for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, rr = r * (1 - jitter / 2 + (R ? R() : 0.5) * jitter); pts.push(f1(cx + Math.cos(a) * rr) + ',' + f1(cy + Math.sin(a) * rr)); }
    return 'M' + pts.join(' L') + ' Z';
  }
  var MIX = [C.sky, C.amber, C.i5, C.g6, C.red, C.g4, C.i7, C.skyL];

  // ------------------------------------------------------------------ scenes
  // Each gets ctx { W, H, fs, B (baseline y), L (letter spans), R (letter boxes), wx0, wx1, back, front, stage }
  // and returns a GSAP timeline that ends with the word fully formed.
  var SCENES = {};

  /* 1. Tracing — a GPS route draws through the word; a truck follows it and lights each letter. */
  SCENES.tracing = { word: 'Tracing.', blurb: 'A GPS route draws through the word; the truck lights each letter as it passes and drops a pin.',
    build: function (c) {
      var tl = g.timeline(), n = c.R.length, fs = c.fs;
      var pts = [[c.wx0 - fs * 0.7, c.B - fs * 0.1]];
      c.R.forEach(function (r, i) { pts.push([r.cx, c.B - fs * (i % 2 ? 0.62 : 0.12)]); });
      pts.push([c.wx1 + fs * 0.45, c.B - fs * 0.85]);
      var d = smooth(pts);
      var faint = el('path', { d: d, fill: 'none', stroke: C.i2, 'stroke-width': fs * 0.03, 'stroke-linecap': 'round', 'stroke-dasharray': '0 ' + fs * 0.075, opacity: 0 }, c.back);
      var trail = el('path', { d: d, fill: 'none', stroke: C.g6, 'stroke-width': fs * 0.04, 'stroke-linecap': 'round', opacity: 0.85 }, c.back);
      var truck = el('g', {}, c.front);
      var halo = el('circle', { r: fs * 0.11, fill: C.g6, opacity: 0.18 }, truck);
      el('circle', { r: fs * 0.055, fill: C.g6, stroke: '#fff', 'stroke-width': fs * 0.018 }, truck);
      var end = pts[pts.length - 1];
      var pin = el('g', { opacity: 0 }, el('g', { transform: 'translate(' + f1(end[0]) + ',' + f1(end[1]) + ')' }, c.front));
      var pr = fs * 0.16;
      el('path', { d: 'M0,0 C' + f1(-pr) + ',' + f1(-pr * 1.3) + ' ' + f1(-pr) + ',' + f1(-pr * 2.4) + ' 0,' + f1(-pr * 2.4) + ' C' + f1(pr) + ',' + f1(-pr * 2.4) + ' ' + f1(pr) + ',' + f1(-pr * 1.3) + ' 0,0 Z', fill: C.g7 }, pin);
      var chk = el('path', { d: 'M' + f1(-pr * 0.42) + ',' + f1(-pr * 1.62) + ' L' + f1(-pr * 0.1) + ',' + f1(-pr * 1.3) + ' L' + f1(pr * 0.45) + ',' + f1(-pr * 1.95), fill: 'none', stroke: '#fff', 'stroke-width': fs * 0.035, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, pin);
      g.set(c.L, { color: C.i2, y: fs * 0.04 });
      g.set(trail, { drawSVG: '0%' });
      g.set(truck, { x: pts[0][0], y: pts[0][1] });
      var T = 3.4, x0 = pts[0][0], x1 = end[0];
      tl.to(faint, { opacity: 1, duration: 0.4 })
        .to(halo, { attr: { r: fs * 0.16 }, opacity: 0, duration: 0.9, repeat: 4, ease: 'power1.out' }, 0)
        .addLabel('go', 0.3)
        .to(trail, { drawSVG: '100%', duration: T, ease: 'none' }, 'go')
        .to(truck, { duration: T, ease: 'none', motionPath: { path: trail, align: trail, alignOrigin: [0.5, 0.5] } }, 'go');
      c.R.forEach(function (r, i) {
        var at = 'go+=' + (T * (r.cx - x0) / (x1 - x0)).toFixed(2);
        tl.to(c.L[i], { color: C.i9, y: 0, duration: 0.35, ease: 'back.out(2.5)' }, at);
        var ring = el('circle', { cx: r.cx, cy: c.B - fs * 0.35, r: fs * 0.05, fill: 'none', stroke: C.g6, 'stroke-width': fs * 0.012, opacity: 0 }, c.back);
        tl.fromTo(ring, { opacity: 0.8 }, { attr: { r: fs * 0.42 }, opacity: 0, duration: 0.7, ease: 'power2.out', immediateRender: false }, at);
      });
      tl.to(truck, { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: 0.25 }, 'go+=' + T)
        .fromTo(pin, { opacity: 0, y: -fs * 0.6 }, { opacity: 1, y: 0, duration: 0.6, ease: 'bounce.out' }, '>-0.05')
        .from(chk, { drawSVG: '0%', duration: 0.35 }, '>-0.1');
      return tl;
    } };

  /* 2. Processing — a rotating trommel drum tumbles the letters with debris; letters fall
        through the screen in order, oversize debris rolls out of the far end. */
  SCENES.processing = { word: 'Processing.', blurb: 'A rotating trommel tumbles the letters with stones and plastic; letters fall through the screen in order, the overs roll out the end.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, R = rng(7);
      var x0 = c.wx0 - fs * 0.3, x1 = c.wx1 + fs * 0.15, r = fs * 0.34, cy = c.B - fs * 1.32;
      var drum = el('g', { transform: 'rotate(-2.5 ' + f1((x0 + x1) / 2) + ' ' + f1(cy) + ')' }, c.back);
      var clipId = 'hs-clip-' + Date.now();
      var cp = el('clipPath', { id: clipId }, el('defs', {}, c.back));
      el('rect', { x: x0, y: cy - r, width: x1 - x0, height: 2 * r, rx: r * 0.45 }, cp);
      el('rect', { x: x0, y: cy - r, width: x1 - x0, height: 2 * r, rx: r * 0.45, fill: '#EEF2EF', stroke: C.i5, 'stroke-width': fs * 0.014 }, drum);
      var holes = el('g', { 'clip-path': 'url(#' + clipId + ')' }, drum), s = fs * 0.1;
      for (var hx = x0 - s * 3; hx < x1 + s * 3; hx += s)
        for (var hy = cy - r + s * 0.6, row = 0; hy < cy + r; hy += s * 0.8, row++)
          el('circle', { cx: f1(hx + (row % 2) * s / 2), cy: f1(hy), r: fs * 0.024, fill: C.i3, opacity: 0.6 }, holes);
      var ribs = el('g', { 'clip-path': 'url(#' + clipId + ')' }, drum), rs = fs * 0.55;
      for (var rx = x0 - rs; rx < x1 + rs; rx += rs) el('path', { d: 'M' + f1(rx) + ',' + f1(cy - r) + ' q' + f1(rs * 0.18) + ',' + f1(r) + ' 0,' + f1(2 * r), fill: 'none', stroke: C.i3, 'stroke-width': fs * 0.016 }, ribs);
      el('ellipse', { cx: x0 + r * 0.3, cy: cy, rx: r * 0.28, ry: r, fill: 'none', stroke: C.i5, 'stroke-width': fs * 0.018 }, drum);
      el('ellipse', { cx: x1 - r * 0.3, cy: cy, rx: r * 0.28, ry: r, fill: 'none', stroke: C.i5, 'stroke-width': fs * 0.018 }, drum);
      el('path', { d: 'M' + f1(x0 - fs * 0.45) + ',' + f1(cy - r * 1.25) + ' L' + f1(x0 + r * 0.2) + ',' + f1(cy - r * 0.2) + ' L' + f1(x0 + r * 0.2) + ',' + f1(cy + r * 0.2) + ' L' + f1(x0 - fs * 0.45) + ',' + f1(cy - r * 0.55) + ' Z', fill: C.i1, stroke: C.i5, 'stroke-width': fs * 0.012 }, c.back);
      [x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.75].forEach(function (sx) {
        el('line', { x1: sx, y1: cy + r, x2: sx - fs * 0.08, y2: c.B - fs * 0.85, stroke: C.i3, 'stroke-width': fs * 0.02 }, c.back);
        el('circle', { cx: sx, cy: cy + r, r: fs * 0.05, fill: C.i7 }, c.back);
      });
      var shine = el('rect', { x: x0 + r * 0.3, y: cy - r * 0.86, width: x1 - x0 - r * 0.6, height: r * 0.32, rx: r * 0.16, fill: '#fff', opacity: 0.55 }, c.front);
      var pileX = x1 + fs * 0.35, pile = el('path', { d: 'M' + f1(pileX - fs * 0.3) + ',' + f1(c.B) + ' Q' + f1(pileX) + ',' + f1(c.B - fs * 0.3) + ' ' + f1(pileX + fs * 0.3) + ',' + f1(c.B) + ' Z', fill: C.amber, opacity: 0.85 }, c.back);
      g.set(pile, { scaleY: 0, transformOrigin: '50% 100%' });
      el('path', { d: 'M' + f1(x1 - r * 0.2) + ',' + f1(cy + r * 0.1) + ' L' + f1(pileX + fs * 0.05) + ',' + f1(c.B - fs * 0.32), stroke: C.i5, 'stroke-width': fs * 0.03, 'stroke-linecap': 'round' }, c.back);

      // Endless drum spin runs beside the scene timeline (an infinite child would stop it ever completing).
      var spin = c.loop(g.timeline({ repeat: -1 }).to(holes, { x: s, duration: 0.32, ease: 'none' }).set(holes, { x: 0 }));
      var spin2 = c.loop(g.timeline({ repeat: -1 }).to(ribs, { x: rs, duration: 0.95, ease: 'none' }).set(ribs, { x: 0 }));
      // letters start inside the drum, small and tumbling
      var inside = function () { return { x: x0 + r + R() * (x1 - x0 - 2 * r), y: cy - r * 0.45 + R() * r * 0.8 }; };
      c.L.forEach(function (L, i) { var p = inside(), b = c.R[i]; g.set(L, { x: p.x - b.cx, y: p.y - b.cyv, scale: 0.5, rotation: R() * 360, color: MIX[i % MIX.length], opacity: 0 }); });
      var debris = [];
      for (var k = 0; k < 11; k++) {
        var p = inside(), kind = k % 3, dEl;
        debris.push(dEl = kind === 0 ? el('circle', { cx: p.x, cy: p.y, r: fs * (0.035 + R() * 0.03), fill: C.i5 }, c.front)
          : kind === 1 ? el('rect', { x: p.x, y: p.y, width: fs * 0.1, height: fs * 0.05, rx: fs * 0.01, fill: R() > 0.5 ? C.skyL : C.amber }, c.front)
            : el('path', { d: poly(p.x, p.y, fs * 0.045, 6, 0.6, R), fill: C.dirtD }, c.front));
        dEl._p = p;
      }
      tl.to(c.L, { opacity: 1, duration: 0.3, stagger: 0.03 }, 0)
        .from(debris, { opacity: 0, duration: 0.3, stagger: 0.02 }, 0);
      // tumble ~1.8 s
      c.L.concat(debris).forEach(function (t, i) {
        var isL = i < c.L.length, b = isL ? c.R[i] : null, kf = [];
        for (var j = 0; j < 3; j++) { var q = inside(); kf.push(isL ? { x: q.x - b.cx, y: q.y - b.cyv, rotation: '+=' + (140 + R() * 120), duration: 0.6 } : { x: q.x - t._p.x, y: q.y - t._p.y, rotation: '+=200', duration: 0.6 }); }
        tl.to(t, { keyframes: kf, ease: 'sine.inOut', transformOrigin: '50% 50%' }, 0.15);
      });
      // fines falling through the screen during the tumble
      for (var fdot = 0; fdot < 22; fdot++) {
        var fx = x0 + r + R() * (x1 - x0 - 2 * r), dot = el('circle', { cx: fx, cy: cy + r * 0.8, r: fs * 0.014, fill: C.dirt, opacity: 0 }, c.back);
        tl.fromTo(dot, { opacity: 0.9, y: 0 }, { y: c.B - (cy + r * 0.8), opacity: 0, duration: 0.7, ease: 'power2.in', immediateRender: false }, 0.3 + R() * 2.2);
      }
      tl.addLabel('drop', 2.05);
      c.L.forEach(function (L, i) {
        tl.to(L, { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.8, ease: 'bounce.out' }, 'drop+=' + (i * 0.13).toFixed(2))
          .to(L, { color: C.i9, duration: 0.4 }, 'drop+=' + (i * 0.13 + 0.55).toFixed(2));
      });
      debris.forEach(function (d, i) {
        tl.to(d, { x: '+=' + (pileX - (x0 + x1) / 2), y: c.B - cy - fs * 0.15, scale: 0.5, opacity: 0, duration: 0.7, ease: 'power2.in' }, 'drop+=' + (0.5 + i * 0.09).toFixed(2));
      });
      tl.to(pile, { scaleY: 1, duration: 1.2, ease: 'power2.out' }, 'drop+=0.6')
        .to(shine, { opacity: 0.2, duration: 0.6 }, 'drop+=1.4')
        .call(function () { spin.timeScale(0.4); spin2.timeScale(0.4); }, null, 'drop+=1.8');
      return tl;
    } };

  /* 3. Sorting — a gantry robot arm picks scrambled letters off a conveyor, one by one, into place. */
  SCENES.sorting = { word: 'Sorting.', blurb: 'A gantry robot arm picks the scrambled letters off a conveyor and places them one by one.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, n = c.L.length, R = rng(3);
      var Wc = (c.wx0 + c.wx1) / 2, railY = c.B - fs * 1.72, convY = c.B - fs * 1.0, scaleOn = 0.5;
      var grabDY = fs * 0.26, l1 = fs * 0.66, l2 = fs * 0.66;
      // rail + conveyor
      el('line', { x1: c.wx0 - fs * 0.5, y1: railY, x2: c.wx1 + fs * 0.5, y2: railY, stroke: C.i7, 'stroke-width': fs * 0.035, 'stroke-linecap': 'round' }, c.back);
      var beltY = convY + fs * 0.2, cx0 = c.wx0 - fs * 0.25, cx1 = c.wx1 + fs * 0.25;
      el('rect', { x: cx0, y: beltY, width: cx1 - cx0, height: fs * 0.07, rx: fs * 0.035, fill: C.i1, stroke: C.i5, 'stroke-width': fs * 0.01 }, c.back);
      var belt = el('line', { x1: cx0 + fs * 0.04, y1: beltY + fs * 0.035, x2: cx1 - fs * 0.04, y2: beltY + fs * 0.035, stroke: C.i3, 'stroke-width': fs * 0.012, 'stroke-dasharray': f1(fs * 0.06) + ' ' + f1(fs * 0.06) }, c.back);
      for (var k = 0; k <= 8; k++) el('circle', { cx: cx0 + (cx1 - cx0) * k / 8, cy: beltY + fs * 0.035, r: fs * 0.022, fill: C.i5 }, c.back);
      // slots
      var slots = c.R.map(function (r) { return el('line', { x1: r.x + r.w * 0.12, x2: r.x + r.w * 0.88, y1: c.B + fs * 0.06, y2: c.B + fs * 0.06, stroke: C.i2, 'stroke-width': fs * 0.014, 'stroke-dasharray': f1(fs * 0.03) + ' ' + f1(fs * 0.025), 'stroke-linecap': 'round' }, c.back); });
      // arm
      var arm = el('g', {}, c.front);
      var carriage = el('rect', { width: fs * 0.3, height: fs * 0.12, rx: fs * 0.03, fill: C.i9 }, arm);
      var s1 = el('line', { stroke: C.i7, 'stroke-width': fs * 0.06, 'stroke-linecap': 'round' }, arm);
      var s2 = el('line', { stroke: C.g6, 'stroke-width': fs * 0.045, 'stroke-linecap': 'round' }, arm);
      var j0 = el('circle', { r: fs * 0.045, fill: C.i9 }, arm), j1 = el('circle', { r: fs * 0.04, fill: C.i9 }, arm);
      var fa = el('line', { stroke: C.i9, 'stroke-width': fs * 0.025, 'stroke-linecap': 'round' }, arm), fb = el('line', { stroke: C.i9, 'stroke-width': fs * 0.025, 'stroke-linecap': 'round' }, arm);
      // scrambled order on the conveyor
      var perm = c.R.map(function (_, i) { return i; });
      for (var i = n - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      var convX = c.R.map(function (_, i) { return c.wx0 + (c.wx1 - c.wx0) * (perm[i] + 0.5) / n; });
      c.L.forEach(function (L, i) { g.set(L, { x: convX[i] - c.R[i].cx, y: convY - c.R[i].cyv, scale: scaleOn, color: MIX[i % MIX.length] }); });
      var P = { x: Wc, y: railY + fs * 0.75, grip: 1 }, carry = -1;
      function draw() {
        var bx = Wc + (P.x - Wc) * 0.88, by = railY, dx = P.x - bx, dy = P.y - by;
        var d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.5), cos2 = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2);
        var a2 = Math.acos(Math.max(-1, Math.min(1, cos2))), best = null;
        [a2, -a2].forEach(function (q) {
          var a1 = Math.atan2(dy, dx) - Math.atan2(l2 * Math.sin(q), l1 + l2 * Math.cos(q)), ex = bx + l1 * Math.cos(a1), ey = by + l1 * Math.sin(a1);
          if (!best || ex > best.ex) best = { ex: ex, ey: ey };
        });
        var ang = Math.atan2(dy, dx), tx = bx + Math.cos(ang) * d, ty = by + Math.sin(ang) * d;
        carriage.setAttribute('x', f1(bx - fs * 0.15)); carriage.setAttribute('y', f1(by - fs * 0.06));
        s1.setAttribute('x1', f1(bx)); s1.setAttribute('y1', f1(by)); s1.setAttribute('x2', f1(best.ex)); s1.setAttribute('y2', f1(best.ey));
        s2.setAttribute('x1', f1(best.ex)); s2.setAttribute('y1', f1(best.ey)); s2.setAttribute('x2', f1(tx)); s2.setAttribute('y2', f1(ty));
        j0.setAttribute('cx', f1(bx)); j0.setAttribute('cy', f1(by)); j1.setAttribute('cx', f1(best.ex)); j1.setAttribute('cy', f1(best.ey));
        var o = fs * (0.05 + 0.07 * P.grip), fl = fs * 0.16;
        fa.setAttribute('x1', f1(tx - fs * 0.02)); fa.setAttribute('y1', f1(ty)); fa.setAttribute('x2', f1(tx - o)); fa.setAttribute('y2', f1(ty + fl));
        fb.setAttribute('x1', f1(tx + fs * 0.02)); fb.setAttribute('y1', f1(ty)); fb.setAttribute('x2', f1(tx + o)); fb.setAttribute('y2', f1(ty + fl));
        if (carry >= 0) g.set(c.L[carry], { x: P.x - c.R[carry].cx, y: P.y + grabDY - c.R[carry].cyv });
      }
      draw();
      tl.to(belt, { strokeDashoffset: -fs * 0.6, duration: 1, ease: 'none' }, 0)
        .from(c.L, { opacity: 0, x: '-=' + fs * 0.6, duration: 0.6, stagger: 0.03, ease: 'power2.out' }, 0)
        .from(arm, { opacity: 0, y: -fs * 0.3, duration: 0.5 }, 0.2);
      var t0 = 0.75, order = c.R.map(function (_, i) { return i; });
      order.forEach(function (i) {
        tl.to(P, { x: convX[i], y: convY - grabDY, duration: 0.22, ease: 'power2.inOut', onUpdate: draw }, t0)
          .to(P, { grip: 0, duration: 0.06, onUpdate: draw })
          .call(function () { carry = i; })
          .to(P, { x: c.R[i].cx, y: c.R[i].cyv - grabDY, duration: 0.28, ease: 'power2.inOut', onUpdate: draw })
          .to(c.L[i], { scale: 1, duration: 0.28, ease: 'power2.out' }, '<')
          .call(function () { carry = -1; })
          .to(P, { grip: 1, duration: 0.06, onUpdate: draw })
          .to(c.L[i], { color: C.i9, duration: 0.3 }, '<')
          .to(slots[i], { stroke: C.g6, duration: 0.2 }, '<');
        t0 = '>';
      });
      tl.to(P, { x: Wc, y: railY + fs * 0.6, duration: 0.45, ease: 'power2.inOut', onUpdate: draw })
        .to(slots, { opacity: 0, duration: 0.5 }, '<');
      return tl;
    } };

  /* 4. Reclaiming — a grey dump morphs into green hills; rubble letters turn green and sprout. */
  SCENES.reclaiming = { word: 'Reclaiming.', blurb: 'A grey dump with flies and smoke slowly turns into green hills; the rubble letters turn green and sprout leaves.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, R = rng(19);
      var x0 = c.wx0 - fs * 0.6, x1 = c.wx1 + fs * 0.6, gy = c.B + fs * 0.1, N = 22, top = [], hills = [];
      for (var i = 0; i <= N; i++) {
        var u = i / N, x = x0 + (x1 - x0) * u, bump = Math.sin(Math.PI * u);
        top.push([x, gy - fs * (0.25 + 1.05 * bump * (0.75 + R() * 0.4)) ]);
        hills.push([x, gy - fs * (0.22 + 0.42 * Math.pow(Math.sin(Math.PI * u * 1.6 + 0.3), 2) * (0.6 + 0.4 * bump))]);
      }
      var close = ' L' + f1(x1) + ',' + f1(gy) + ' L' + f1(x0) + ',' + f1(gy) + ' Z';
      var dumpD = 'M' + top.map(function (p) { return f1(p[0]) + ',' + f1(p[1]); }).join(' L') + close;
      var hillD = smooth(hills) + close;
      var mound = el('path', { d: dumpD, fill: C.dirt, opacity: 0.55 }, c.back);
      var grass = el('path', { d: smooth(hills), fill: 'none', stroke: C.g6, 'stroke-width': fs * 0.035, 'stroke-linecap': 'round', opacity: 0 }, c.back);
      var specks = [];
      for (var k = 0; k < 26; k++) {
        var px = x0 + fs * 0.2 + R() * (x1 - x0 - fs * 0.4), py = gy - fs * (0.15 + R() * 0.7);
        specks.push(el('rect', { x: f1(px), y: f1(py), width: f1(fs * (0.03 + R() * 0.05)), height: f1(fs * 0.025), rx: fs * 0.006, fill: [C.i5, C.amber, C.skyL, C.dirtD, C.red][k % 5], opacity: 0.7, transform: 'rotate(' + Math.round(R() * 90) + ' ' + f1(px) + ' ' + f1(py) + ')' }, c.back));
      }
      var smoke = [0, 1, 2].map(function (j) { var sx = x0 + (x1 - x0) * (0.3 + j * 0.2); return el('path', { d: 'M' + f1(sx) + ',' + f1(gy - fs * 1.0) + ' q' + f1(fs * 0.12) + ',' + f1(-fs * 0.2) + ' 0,' + f1(-fs * 0.4) + ' t0,' + f1(-fs * 0.4), fill: 'none', stroke: C.i3, 'stroke-width': fs * 0.03, 'stroke-linecap': 'round', opacity: 0.5 }, c.back); });
      var flies = [];
      for (var fl = 0; fl < 7; fl++) { var fx = x0 + (x1 - x0) * (0.15 + R() * 0.7), fy = gy - fs * (1.1 + R() * 0.4); flies.push(el('circle', { cx: f1(fx), cy: f1(fy), r: fs * 0.016, fill: C.i7 }, c.front)); }
      g.set(c.L, { color: '#7D7468', rotation: function () { return (R() - 0.5) * 14; }, y: function () { return fs * R() * 0.05; } });
      flies.forEach(function (f, i) { tl.to(f, { x: '+=' + fs * 0.3, y: '-=' + fs * 0.12, duration: 0.35, repeat: 7, yoyo: true, ease: 'sine.inOut' }, i * 0.05); });
      smoke.forEach(function (s, i) { tl.fromTo(s, { drawSVG: '0% 30%', opacity: 0.55 }, { drawSVG: '70% 100%', opacity: 0, duration: 1.4, repeat: 1, ease: 'none' }, i * 0.3); });
      tl.addLabel('heal', 1.4)
        .to(mound, { morphSVG: hillD, fill: C.g4, opacity: 0.35, duration: 2.2, ease: 'power2.inOut' }, 'heal')
        .to(specks, { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: 0.4, stagger: { each: 0.05, from: 'start' } }, 'heal')
        .to(flies, { opacity: 0, scale: 0, duration: 0.4 }, 'heal')
        .to(grass, { opacity: 1, duration: 0.01 }, 'heal+=0.6')
        .fromTo(grass, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.8, ease: 'power1.inOut' }, 'heal+=0.6')
        .to(c.L, { color: C.g7, rotation: 0, y: 0, duration: 0.5, stagger: 0.1, ease: 'back.out(2)' }, 'heal+=0.7');
      // sprouts on a few letters
      [1, 4, 7].forEach(function (i, k) {
        if (!c.R[i]) return;
        var r = c.R[i], sx = r.cx, sy = c.B - fs * 0.7, lf = fs * 0.12, sp = el('g', {}, c.front);
        el('path', { d: 'M' + f1(sx) + ',' + f1(sy) + ' l0,' + f1(-lf * 0.9), stroke: C.g7, 'stroke-width': fs * 0.018, 'stroke-linecap': 'round' }, sp);
        el('path', { d: 'M' + f1(sx) + ',' + f1(sy - lf * 0.7) + ' q' + f1(-lf) + ',' + f1(-lf * 0.2) + ' ' + f1(-lf * 0.9) + ',' + f1(-lf * 0.9) + ' q' + f1(lf * 0.75) + ',' + f1(-lf * 0.1) + ' ' + f1(lf * 0.9) + ',' + f1(lf * 0.9) + 'Z', fill: C.g6 }, sp);
        el('path', { d: 'M' + f1(sx) + ',' + f1(sy - lf * 0.8) + ' q' + f1(lf) + ',' + f1(-lf * 0.2) + ' ' + f1(lf * 0.9) + ',' + f1(-lf * 0.9) + ' q' + f1(-lf * 0.75) + ',' + f1(-lf * 0.1) + ' ' + f1(-lf * 0.9) + ',' + f1(lf * 0.9) + 'Z', fill: C.g4 }, sp);
        g.set(sp, { scale: 0, svgOrigin: f1(sx) + ' ' + f1(sy) });
        tl.to(sp, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.45)' }, 'heal+=' + (1.6 + k * 0.25));
      });
      // a tree grows at the right
      var tx = x1 - fs * 0.25, ty = gy - fs * 0.25, tree = el('g', {}, c.back);
      var trunk = el('path', { d: 'M' + f1(tx) + ',' + f1(ty) + ' l0,' + f1(-fs * 0.55), stroke: C.g8, 'stroke-width': fs * 0.04, 'stroke-linecap': 'round' }, tree);
      var crown = el('circle', { cx: tx, cy: ty - fs * 0.7, r: fs * 0.25, fill: C.g6, opacity: 0.9 }, tree);
      tl.fromTo(trunk, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.6 }, 'heal+=1.4')
        .from(crown, { attr: { r: 0 }, duration: 0.8, ease: 'back.out(2)' }, 'heal+=1.85');
      return tl;
    } };

  /* 5. Recovery — recognisable materials fly in and become the letters. */
  SCENES.recovery = { word: 'Recovery.', blurb: 'Bottles, cans, paper and shards fly in from the edges and turn into the letters.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, R = rng(41), s = fs * 0.2;
      var MAT = [
        { col: '#2E8B57', d: function (x, y) { return 'M' + f1(x - s * 0.25) + ',' + f1(y + s) + ' l0,' + f1(-s * 1.1) + ' q0,' + f1(-s * 0.3) + ' ' + f1(s * 0.15) + ',' + f1(-s * 0.45) + ' l0,' + f1(-s * 0.35) + ' l' + f1(s * 0.2) + ',0 l0,' + f1(s * 0.35) + ' q' + f1(s * 0.15) + ',' + f1(s * 0.15) + ' ' + f1(s * 0.15) + ',' + f1(s * 0.45) + ' l0,' + f1(s * 1.1) + ' z'; } },
        { col: C.i3, d: function (x, y) { return 'M' + f1(x - s * 0.35) + ',' + f1(y - s * 0.6) + ' l' + f1(s * 0.7) + ',0 l0,' + f1(s * 1.2) + ' l' + f1(-s * 0.7) + ',0 z'; } },
        { col: '#E2D3AE', d: function (x, y) { return poly(x, y, s * 0.6, 7, 0.7, R); } },
        { col: C.skyL, d: function (x, y) { return 'M' + f1(x - s * 0.5) + ',' + f1(y + s * 0.4) + ' L' + f1(x + s * 0.1) + ',' + f1(y - s * 0.6) + ' L' + f1(x + s * 0.55) + ',' + f1(y + s * 0.3) + ' z'; } },
      ];
      g.set(c.L, { opacity: 0, scale: 0.2 });
      c.R.forEach(function (r, i) {
        var m = MAT[i % MAT.length], side = i % 4, sx = side === 0 ? -fs * 0.4 : side === 1 ? c.W + fs * 0.4 : r.cx + (R() - 0.5) * fs * 2, sy = side < 2 ? c.B - fs * (0.5 + R() * 1.2) : (side === 2 ? -fs * 0.3 : c.H + fs * 0.3);
        var frag = el('path', { d: m.d(0, 0), fill: m.col, stroke: 'rgba(0,0,0,0.15)', 'stroke-width': fs * 0.006 }, c.front);
        var tx = r.cx, ty = r.cyv, mx = (sx + tx) / 2 + (R() - 0.5) * fs, my = Math.min(sy, ty) - fs * (0.4 + R() * 0.5);
        var at = 0.15 + i * 0.13;
        g.set(frag, { x: sx, y: sy, rotation: R() * 360, transformOrigin: '50% 50%' });
        tl.to(frag, { duration: 0.95, ease: 'power2.inOut', rotation: '+=' + (200 + R() * 200), motionPath: { path: [{ x: sx, y: sy }, { x: mx, y: my }, { x: tx, y: ty }], curviness: 1.4 } }, at)
          .to(frag, { scale: 0, opacity: 0, duration: 0.2 }, at + 0.9)
          .to(c.L[i], { opacity: 1, scale: 1, color: m.col, duration: 0.45, ease: 'back.out(3)' }, at + 0.85);
        var burst = el('circle', { cx: tx, cy: ty, r: fs * 0.05, fill: 'none', stroke: m.col, 'stroke-width': fs * 0.014 }, c.back);
        g.set(burst, { opacity: 0 });
        tl.fromTo(burst, { opacity: 0.9 }, { attr: { r: fs * 0.35 }, opacity: 0, duration: 0.5, immediateRender: false }, at + 0.9);
      });
      var line = el('line', { x1: c.wx0, x2: c.wx1, y1: c.B + fs * 0.1, y2: c.B + fs * 0.1, stroke: C.g6, 'stroke-width': fs * 0.03, 'stroke-linecap': 'round' }, c.back);
      tl.to(c.L, { color: C.i9, duration: 0.6, stagger: 0.04 }, '>+0.25')
        .fromTo(line, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.8, ease: 'power2.inOut' }, '<');
      return tl;
    } };

  /* 6. Remediating — a methane cloud sits on hazy letters; a scanning beam clears it. */
  SCENES.remediating = { word: 'Remediating.', blurb: 'A methane cloud with rising CH₄ bubbles hangs over hazy letters; a scanning beam sweeps across and clears it.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, R = rng(23);
      var fid = 'hs-blur-' + Date.now(), defs = el('defs', {}, c.front);
      el('feGaussianBlur', { stdDeviation: f1(fs * 0.07) }, el('filter', { id: fid, x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs));
      var gid = 'hs-beam-' + Date.now(), lg = el('linearGradient', { id: gid, x1: '0', x2: '1', y1: '0', y2: '0' }, defs);
      el('stop', { offset: '0', 'stop-color': C.g3, 'stop-opacity': '0' }, lg); el('stop', { offset: '0.5', 'stop-color': C.g3, 'stop-opacity': '0.75' }, lg); el('stop', { offset: '1', 'stop-color': C.g3, 'stop-opacity': '0' }, lg);
      var cloud = el('g', { filter: 'url(#' + fid + ')' }, c.front), puffs = [];
      for (var k = 0; k < 9; k++) {
        var px = c.wx0 + (c.wx1 - c.wx0) * (k + 0.5) / 9, py = c.B - fs * (0.55 + R() * 0.35);
        puffs.push(el('ellipse', { cx: f1(px), cy: f1(py), rx: f1(fs * (0.35 + R() * 0.2)), ry: f1(fs * (0.22 + R() * 0.12)), fill: '#A9A194', opacity: 0.45 }, cloud));
      }
      var bubbles = [];
      for (var b = 0; b < 12; b++) {
        var bx = c.wx0 + R() * (c.wx1 - c.wx0), bg = el('g', { transform: 'translate(' + f1(bx) + ',' + f1(c.B) + ')' }, c.front);
        el('circle', { r: fs * 0.11, fill: '#fff', stroke: C.i3, 'stroke-width': fs * 0.01, opacity: 0.9 }, bg);
        var tx = el('text', { 'text-anchor': 'middle', y: fs * 0.035, 'font-size': fs * 0.095, fill: C.i5, 'font-family': 'var(--font-serif)' }, bg); tx.textContent = 'CH₄';
        bg._x = bx; bubbles.push(bg);
        tl.fromTo(bg, { y: c.B, opacity: 0 }, { y: c.B - fs * (1.0 + R() * 0.5), opacity: 1, duration: 1.6, ease: 'sine.out' }, R() * 1.2);
      }
      g.set(c.L, { color: C.i3, filter: 'blur(' + f1(fs * 0.035) + 'px)' });
      var beamW = fs * 0.5, beam = el('rect', { x: -beamW / 2, y: c.B - fs * 1.1, width: beamW, height: fs * 1.3, fill: 'url(#' + gid + ')' }, c.front);
      var x0 = c.wx0 - fs * 0.3, x1 = c.wx1 + fs * 0.3, T = 2.4;
      tl.addLabel('scan', 1.3)
        .fromTo(beam, { x: x0, opacity: 0 }, { opacity: 1, duration: 0.2 }, 'scan')
        .to(beam, { x: x1, duration: T, ease: 'none' }, 'scan')
        .to(beam, { opacity: 0, duration: 0.3 }, 'scan+=' + (T - 0.1));
      function at(x) { return 'scan+=' + Math.max(0, T * (x - x0) / (x1 - x0)).toFixed(2); }
      c.R.forEach(function (r, i) { tl.to(c.L[i], { color: C.i9, filter: 'blur(0px)', duration: 0.35 }, at(r.cx)); });
      puffs.forEach(function (p) { tl.to(p, { opacity: 0, scale: 1.4, transformOrigin: '50% 50%', duration: 0.5 }, at(Number(p.getAttribute('cx')))); });
      bubbles.forEach(function (bg) { tl.to(bg, { scale: 0, opacity: 0, transformOrigin: '50% 50%', duration: 0.25 }, at(bg._x)); });
      var ring = el('circle', { cx: c.wx1 + fs * 0.25, cy: c.B - fs * 0.35, r: fs * 0.1, fill: 'none', stroke: C.g6, 'stroke-width': fs * 0.02 }, c.back);
      g.set(ring, { opacity: 0 });
      tl.fromTo(ring, { opacity: 1 }, { attr: { r: fs * 0.5 }, opacity: 0, duration: 0.8, immediateRender: false }, 'scan+=' + T);
      return tl;
    } };

  /* 7. Weighing — letters drop onto a weighbridge deck; the display counts up to the weight. */
  SCENES.weighing = { word: 'Weighing.', blurb: 'Letters drop onto a weighbridge deck that dips with each one; the display counts up to the tonnage.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, R = rng(5);
      var dx0 = c.wx0 - fs * 0.25, dx1 = c.wx1 + fs * 0.25, dy = c.B + fs * 0.06;
      el('path', { d: 'M' + f1(dx0 - fs * 0.5) + ',' + f1(dy + fs * 0.14) + ' L' + f1(dx0) + ',' + f1(dy) + ' L' + f1(dx0) + ',' + f1(dy + fs * 0.14) + ' Z', fill: C.i2 }, c.back);
      el('path', { d: 'M' + f1(dx1 + fs * 0.5) + ',' + f1(dy + fs * 0.14) + ' L' + f1(dx1) + ',' + f1(dy) + ' L' + f1(dx1) + ',' + f1(dy + fs * 0.14) + ' Z', fill: C.i2 }, c.back);
      var deck = el('g', {}, c.back);
      el('rect', { x: dx0, y: dy, width: dx1 - dx0, height: fs * 0.09, rx: fs * 0.02, fill: C.i7 }, deck);
      for (var k = 1; k < 8; k++) el('line', { x1: dx0 + (dx1 - dx0) * k / 8, x2: dx0 + (dx1 - dx0) * k / 8, y1: dy + fs * 0.015, y2: dy + fs * 0.075, stroke: C.i5, 'stroke-width': fs * 0.008 }, deck);
      [0.15, 0.5, 0.85].forEach(function (u) { el('rect', { x: dx0 + (dx1 - dx0) * u - fs * 0.05, y: dy + fs * 0.09, width: fs * 0.1, height: fs * 0.05, fill: C.i5 }, c.back); });
      var bw = fs * 1.55, bh = fs * 0.5, bx = c.wx1 - bw + fs * 0.1, by = c.B - fs * 1.68;
      var box = el('g', {}, c.front);
      el('rect', { x: bx, y: by, width: bw, height: bh, rx: fs * 0.06, fill: C.i9 }, box);
      var lab = el('text', { x: bx + fs * 0.08, y: by - fs * 0.06, 'font-size': fs * 0.075, fill: C.i5, 'font-family': 'var(--font-mono)', 'letter-spacing': '0.1em' }, box); lab.textContent = 'WEIGHBRIDGE 01';
      var read = el('text', { x: bx + bw - fs * 0.38, y: by + bh * 0.68, 'text-anchor': 'end', 'font-size': fs * 0.27, fill: C.g3, 'font-family': 'var(--font-mono)' }, box); read.textContent = '0.00';
      var unit = el('text', { x: bx + bw - fs * 0.1, y: by + bh * 0.68, 'text-anchor': 'end', 'font-size': fs * 0.12, fill: C.g2, 'font-family': 'var(--font-mono)' }, box); unit.textContent = 'MT';
      var led = el('circle', { cx: bx + fs * 0.12, cy: by + fs * 0.12, r: fs * 0.03, fill: C.amber }, box);
      var stable = el('text', { x: bx + fs * 0.2, y: by + fs * 0.145, 'font-size': fs * 0.06, fill: C.i3, 'font-family': 'var(--font-mono)' }, box); stable.textContent = 'WEIGHING';
      g.set(c.L, { y: -fs * 1.6, opacity: 0 });
      tl.from(box, { opacity: 0, y: -fs * 0.2, duration: 0.4 }, 0);
      var total = 12.48, w = 0, shares = c.R.map(function () { return 0.6 + R(); }), sum = shares.reduce(function (a, b) { return a + b; }, 0);
      var counter = { v: 0 };
      c.L.forEach(function (L, i) {
        var at = 0.35 + i * 0.26, nw = w + total * shares[i] / sum; w = nw;
        tl.to(L, { opacity: 1, duration: 0.1 }, at)
          .to(L, { y: 0, duration: 0.55, ease: 'bounce.out' }, at)
          .to(deck, { y: fs * 0.025, duration: 0.08, yoyo: true, repeat: 1, ease: 'power1.out' }, at + 0.22)
          .to(counter, { v: nw, duration: 0.35, ease: 'power2.out', onUpdate: function () { read.textContent = counter.v.toFixed(2); } }, at + 0.22);
      });
      tl.to(led, { attr: { fill: C.g3 }, duration: 0.2 }, '>+0.1')
        .call(function () { stable.textContent = 'STABLE'; stable.setAttribute('fill', C.g3); }, null, '<')
        .fromTo(box, { scale: 1 }, { scale: 1.04, transformOrigin: '50% 50%', yoyo: true, repeat: 1, duration: 0.15 }, '<');
      return tl;
    } };

  /* 8. Auditing — a camera viewfinder frames the word, focuses, flashes; VERIFIED stamp lands. */
  SCENES.auditing = { word: 'Auditing.', blurb: 'A camera viewfinder frames the word with REC and a running clock, pulls focus, flashes, and a VERIFIED stamp lands.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, pad = fs * 0.28;
      var x0 = c.wx0 - pad, x1 = c.wx1 + pad, y0 = c.B - fs * 1.05, y1 = c.B + fs * 0.32, k = fs * 0.22, sw = fs * 0.03;
      var vf = el('g', {}, c.front);
      [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(function (q) {
        el('path', { d: 'M' + f1(q[0]) + ',' + f1(q[1] + q[3] * k) + ' L' + f1(q[0]) + ',' + f1(q[1]) + ' L' + f1(q[0] + q[2] * k) + ',' + f1(q[1]), fill: 'none', stroke: C.i9, 'stroke-width': sw, 'stroke-linecap': 'round' }, vf);
      });
      var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      el('path', { d: 'M' + f1(mx - fs * 0.08) + ',' + f1(my) + ' h' + f1(fs * 0.16) + ' M' + f1(mx) + ',' + f1(my - fs * 0.08) + ' v' + f1(fs * 0.16), stroke: C.i5, 'stroke-width': fs * 0.012, opacity: 0.6 }, vf);
      var rec = el('circle', { cx: x0 + fs * 0.12, cy: y0 - fs * 0.16, r: fs * 0.045, fill: C.red }, vf);
      var rt = el('text', { x: x0 + fs * 0.22, y: y0 - fs * 0.13, 'font-size': fs * 0.09, fill: C.i9, 'font-family': 'var(--font-mono)', 'letter-spacing': '0.08em' }, vf); rt.textContent = 'REC · CAM 03 · WEIGHBRIDGE';
      var clock = el('text', { x: x1, y: y0 - fs * 0.13, 'text-anchor': 'end', 'font-size': fs * 0.09, fill: C.i5, 'font-family': 'var(--font-mono)' }, vf);
      var t0 = new Date(), sec = { s: 0 };
      function tick() { var d = new Date(t0.getTime() + sec.s * 1000), p = function (v) { return String(v).padStart(2, '0'); }; clock.textContent = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
      tick();
      var flash = el('rect', { x: 0, y: 0, width: c.W, height: c.H, fill: '#fff', opacity: 0 }, c.front);
      var st = el('g', {}, c.front), swd = fs * 1.4, sht = fs * 0.38, sx = c.wx1 - swd * 0.42, sy = c.B + fs * 0.34;
      el('rect', { x: sx - swd / 2, y: sy - sht / 2, width: swd, height: sht, rx: fs * 0.06, fill: 'rgba(255,255,255,0.88)', stroke: C.g7, 'stroke-width': fs * 0.035 }, st);
      el('rect', { x: sx - swd / 2 + fs * 0.05, y: sy - sht / 2 + fs * 0.05, width: swd - fs * 0.1, height: sht - fs * 0.1, rx: fs * 0.035, fill: 'none', stroke: C.g7, 'stroke-width': fs * 0.01 }, st);
      var stx = el('text', { x: sx + fs * 0.07, y: sy + fs * 0.08, 'text-anchor': 'middle', 'font-size': fs * 0.21, 'font-weight': 700, fill: C.g7, 'font-family': 'var(--font-serif)', 'letter-spacing': '0.08em' }, st); stx.textContent = 'VERIFIED';
      el('path', { d: 'M' + f1(sx - swd / 2 + fs * 0.14) + ',' + f1(sy) + ' l' + f1(fs * 0.06) + ',' + f1(fs * 0.06) + ' l' + f1(fs * 0.1) + ',' + f1(-fs * 0.12), fill: 'none', stroke: C.g7, 'stroke-width': fs * 0.035, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, st);
      g.set(st, { rotation: -8, svgOrigin: f1(sx) + ' ' + f1(sy), opacity: 0, scale: 2.4 });
      g.set(c.L, { color: C.i5, filter: 'blur(' + f1(fs * 0.05) + 'px)', scale: 1.04 });
      tl.fromTo(vf, { opacity: 0, scale: 1.25, svgOrigin: f1(mx) + ' ' + f1(my) }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, 0)
        .to(rec, { opacity: 0.15, duration: 0.45, repeat: 9, yoyo: true, ease: 'steps(1)' }, 0)
        .to(sec, { s: 5, duration: 5, ease: 'none', onUpdate: tick }, 0)
        .to(c.L, { filter: 'blur(' + f1(fs * 0.012) + 'px)', duration: 0.6, ease: 'power2.inOut' }, 0.8)
        .to(c.L, { filter: 'blur(' + f1(fs * 0.03) + 'px)', duration: 0.3 }, 1.4)
        .to(c.L, { filter: 'blur(0px)', color: C.i9, scale: 1, duration: 0.5, ease: 'power3.out' }, 1.7)
        .to(flash, { opacity: 0.85, duration: 0.06 }, 2.45)
        .to(flash, { opacity: 0, duration: 0.45 }, 2.51)
        .to(st, { opacity: 0.95, scale: 1, duration: 0.35, ease: 'back.out(2.2)' }, 2.9)
        .fromTo(c.stage, { x: 0 }, { x: fs * 0.02, duration: 0.05, repeat: 3, yoyo: true, clearProps: 'x' }, 3.2);
      return tl;
    } };

  /* 9. Fuelling — coal lumps ride a conveyor and turn into green RDF pellets that become the word;
        the kiln flame turns clean. */
  SCENES.fuelling = { word: 'Fuelling.', blurb: 'Coal lumps ride a conveyor and turn into green RDF pellets that become the letters; the kiln flame burns cleaner.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, R = rng(13);
      var by = c.B + fs * 0.14, bx0 = c.wx0 - fs * 0.9, bx1 = c.wx1 + fs * 0.5;
      el('rect', { x: bx0, y: by, width: bx1 - bx0, height: fs * 0.07, rx: fs * 0.035, fill: C.i1, stroke: C.i5, 'stroke-width': fs * 0.01 }, c.back);
      var belt = el('line', { x1: bx0 + fs * 0.04, x2: bx1 - fs * 0.04, y1: by + fs * 0.035, y2: by + fs * 0.035, stroke: C.i3, 'stroke-width': fs * 0.012, 'stroke-dasharray': f1(fs * 0.06) + ' ' + f1(fs * 0.06) }, c.back);
      // kiln at the right
      var kx = bx1 + fs * 0.12, ky = c.B - fs * 0.05, kw = fs * 0.9, kh = fs * 0.36;
      var kiln = el('g', { transform: 'rotate(-6 ' + f1(kx) + ' ' + f1(ky) + ')' }, c.back);
      el('rect', { x: kx, y: ky - kh / 2, width: kw, height: kh, rx: kh / 2.4, fill: C.i7 }, kiln);
      el('rect', { x: kx + kw * 0.2, y: ky - kh / 2, width: fs * 0.05, height: kh, fill: C.i5 }, kiln);
      el('rect', { x: kx + kw * 0.6, y: ky - kh / 2, width: fs * 0.05, height: kh, fill: C.i5 }, kiln);
      var fx = kx - fs * 0.02, fy = ky;
      var flame = el('path', { d: 'M' + f1(fx) + ',' + f1(fy - kh * 0.32) + ' C' + f1(fx - fs * 0.35) + ',' + f1(fy - kh * 0.3) + ' ' + f1(fx - fs * 0.32) + ',' + f1(fy + kh * 0.3) + ' ' + f1(fx) + ',' + f1(fy + kh * 0.32) + ' C' + f1(fx - fs * 0.16) + ',' + f1(fy + kh * 0.1) + ' ' + f1(fx - fs * 0.2) + ',' + f1(fy - kh * 0.1) + ' ' + f1(fx) + ',' + f1(fy - kh * 0.32) + ' Z', fill: '#C2402F', opacity: 0.9 }, c.back);
      var smoke = [];
      for (var k = 0; k < 4; k++) smoke.push(el('circle', { cx: kx + kw * 0.85, cy: ky - kh * 0.6, r: fs * (0.08 + k * 0.03), fill: C.coal, opacity: 0 }, c.back));
      smoke.forEach(function (s, i) { tl.fromTo(s, { opacity: 0.55, y: 0, x: 0 }, { opacity: 0, y: -fs * 0.6, x: fs * 0.15, duration: 1.2, repeat: 1, ease: 'sine.out' }, i * 0.3); });
      tl.to(flame, { scaleX: 1.15, scaleY: 0.92, svgOrigin: f1(fx) + ' ' + f1(fy), duration: 0.18, yoyo: true, repeat: 26, ease: 'sine.inOut' }, 0)
        .to(belt, { strokeDashoffset: -fs * 2.4, duration: 4.6, ease: 'none' }, 0);
      g.set(c.L, { opacity: 0, y: fs * 0.22, scale: 0.35 });
      var pellet = function (x, y) { return poly(x, y, fs * 0.075, 10, 0.08, null); }, lastAt = 0;
      c.R.forEach(function (r, i) {
        var lump = el('path', { d: poly(0, 0, fs * 0.09, 7, 0.55, R), fill: C.coal }, c.back);
        var start = bx0 - fs * 0.2, travel = r.cx - start, v = fs * 2.2, dur = travel / v, at = 0.1 + i * 0.22;
        g.set(lump, { x: start, y: by - fs * 0.08, transformOrigin: '50% 50%', opacity: 0 });
        lastAt = Math.max(lastAt, at + dur + 0.7);
        tl.to(lump, { opacity: 1, duration: 0.15 }, at)
          .to(lump, { x: r.cx, duration: dur, ease: 'none' }, at)
          .to(lump, { morphSVG: pellet(0, 0), fill: C.g6, duration: 0.3 }, at + dur - 0.1)
          .to(lump, { y: by - fs * 0.45, scale: 0.4, opacity: 0, duration: 0.3, ease: 'power2.in' }, at + dur + 0.15)
          .to(c.L[i], { opacity: 1, y: 0, scale: 1, color: C.g6, duration: 0.45, ease: 'back.out(2.5)' }, at + dur + 0.25);
      });
      tl.to(flame, { fill: '#F2A93B', duration: 1.4 }, 1.6)
        .to(c.L, { color: C.i9, duration: 0.6, stagger: 0.04 }, lastAt);
      return tl;
    } };

  var ORDER = ['tracing', 'processing', 'sorting', 'reclaiming', 'recovery', 'remediating', 'weighing', 'auditing', 'fuelling'];

  // ------------------------------------------------------------------ runner
  function mount(stage, opts) {
    opts = opts || {};
    var names = (opts.scenes || ORDER).filter(function (n) { return SCENES[n]; });
    var HOLD = opts.hold != null ? opts.hold : 1.6, loop = opts.loop !== false;
    var cur = -1, tl = null, paused = false, visible = true, loops = [];
    var back = el('svg', { class: 'hs-svg hs-back', 'aria-hidden': 'true' });
    var front = el('svg', { class: 'hs-svg hs-front', 'aria-hidden': 'true' });
    var word = document.createElement('div'); word.className = 'hs-word';
    stage.textContent = '';
    stage.appendChild(back); stage.appendChild(word); stage.appendChild(front);

    function measure() {
      var sr = stage.getBoundingClientRect(), fs = parseFloat(getComputedStyle(word).fontSize);
      var base = document.createElement('span'); base.className = 'hs-base'; word.appendChild(base);
      var B = base.getBoundingClientRect().top - sr.top; word.removeChild(base);
      var spans = Array.prototype.slice.call(word.querySelectorAll('.hs-l'));
      var R = spans.map(function (s) { var r = s.getBoundingClientRect(); return { x: r.left - sr.left, w: r.width, cx: r.left - sr.left + r.width / 2, cyv: B - fs * 0.34 }; });
      return { W: sr.width, H: sr.height, fs: fs, B: B, L: spans, R: R, wx0: R[0].x, wx1: R[R.length - 1].x + R[R.length - 1].w, back: back, front: front, stage: stage,
        loop: function (t) { loops.push(t); if (paused || !visible) t.pause(); return t; } };
    }
    function clear() {
      if (tl) { tl.kill(); tl = null; }
      loops.forEach(function (t) { t.kill(); }); loops = [];
      g.killTweensOf([back, front, word, stage]);
      while (back.firstChild) back.removeChild(back.firstChild);
      while (front.firstChild) front.removeChild(front.firstChild);
      g.set([back, front, word], { opacity: 1 });
    }
    function play(i) {
      clear();
      cur = (i + names.length) % names.length;
      var sc = SCENES[names[cur]];
      word.setAttribute('role', 'img'); word.setAttribute('aria-label', sc.word);
      word.innerHTML = sc.word.split('').map(function (ch) { return '<span class="hs-l" aria-hidden="true">' + (ch === ' ' ? '&nbsp;' : ch.replace('&', '&amp;').replace('<', '&lt;')) + '</span>'; }).join('');
      var r = stage.getBoundingClientRect();
      back.setAttribute('viewBox', '0 0 ' + f1(r.width) + ' ' + f1(r.height)); front.setAttribute('viewBox', '0 0 ' + f1(r.width) + ' ' + f1(r.height));
      if (opts.onChange) opts.onChange(cur, names[cur], sc);
      if (REDUCED) return;
      var c = measure();
      tl = g.timeline({ paused: paused || !visible });
      tl.add(sc.build(c));
      tl.to({}, { duration: HOLD });
      tl.to([back, front, word], { opacity: 0, duration: 0.5, ease: 'power1.in' });
      tl.eventCallback('onComplete', function () { if (loop) play(cur + 1); });
    }
    function sync() { [tl].concat(loops).forEach(function (t) { if (t) { if (paused || !visible) t.pause(); else t.resume(); } }); }
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting && document.visibilityState === 'visible'; sync(); }, { threshold: 0.15 }) : null;
    if (io) io.observe(stage);
    function onVis() { visible = document.visibilityState === 'visible'; sync(); }
    document.addEventListener('visibilitychange', onVis);
    var rz = null, lastW = stage.getBoundingClientRect().width;
    function onResize() { clearTimeout(rz); rz = setTimeout(function () { var w = stage.getBoundingClientRect().width; if (Math.abs(w - lastW) > 2) { lastW = w; play(cur); } }, 200); }
    window.addEventListener('resize', onResize);
    var api = {
      play: play, next: function () { play(cur + 1); }, prev: function () { play(cur - 1); },
      pause: function () { paused = true; sync(); }, resume: function () { paused = false; sync(); },
      get index() { return cur; }, names: names,
      setLoop: function (v) { loop = !!v; },
      destroy: function () { clear(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', onResize); },
    };
    var start = function () { play(opts.start || 0); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
    return api;
  }

  window.HeroScenes = { mount: mount, SCENES: SCENES, ORDER: ORDER };
})();
