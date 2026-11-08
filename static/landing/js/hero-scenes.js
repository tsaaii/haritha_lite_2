/* Hero word scenes (GSAP 3 + MorphSVG / MotionPath / DrawSVG, vendored in vendor/gsap).
   Each scene is an SVG illustration built around the real letters of the word, which stay
   real text (aria-label on the word), so they reflow with the font and screen size.

     HeroScenes.mount(stageEl, { scenes: ['tracing', ...], loop: true, onChange(i, scene) })
       -> { play(i), next(), prev(), pause(), resume(), destroy() }

   Layout contract (css/hero-scenes.css): .hs-stage is 2.45 font-sizes tall; the word sits
   on a baseline about 1.75 font-sizes down, leaving room above for machines (trommel, robot,
   cameras) and a little below for decks and conveyors. Pauses off-screen and in hidden tabs.
   prefers-reduced-motion (or html.a11y-still from js/prefs.js): the word is shown still, no scene. */
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
  // The site's own "Stop animations" setting (js/prefs.js) counts the same as the OS setting.
  function still() { return REDUCED || document.documentElement.classList.contains('a11y-still'); }

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

  /* 2. Processing — a rotating trommel: the letters tumble inside the drum (seen through the
        perforated screen), then one by one each drops through the screen, flashes green as it
        passes the mesh, and falls into place. Oversize debris rolls out of the discharge end. */
  SCENES.processing = { word: 'Processing.', blurb: 'Letters tumble inside a rotating trommel; one by one each drops through the screen, flashes as it passes the mesh, and falls into place. The overs roll out the far end.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, u = c.u, R = rng(7), uid = 'tr' + Date.now();
      var x0 = c.wx0 - u * 0.4, x1 = c.wx1 + u * 0.25, r = u * 0.36, cy = c.B - u * 1.32, mid = (x0 + x1) / 2;
      var TILT = 2, tan = Math.tan(TILT * Math.PI / 180), yAt = function (x) { return cy + (x - mid) * tan; };
      var rot = 'rotate(' + TILT + ' ' + f1(mid) + ' ' + f1(cy) + ')';
      var bd = el('defs', {}, c.back), fd = el('defs', {}, c.front);
      function grad(defs, id, stops) { var lg = el('linearGradient', { id: id, x1: 0, x2: 0, y1: 0, y2: 1 }, defs); stops.forEach(function (s) { el('stop', { offset: s[0], 'stop-color': s[1], 'stop-opacity': s[2] }, lg); }); }
      grad(bd, uid + 'in', [[0, '#55635A', 1], [0.55, '#2C3832', 1], [1, '#1B2520', 1]]);
      grad(fd, uid + 'sh', [[0, '#FFFFFF', 0.7], [0.18, '#EEF2EF', 0.42], [0.5, '#C9D2CC', 0.22], [0.82, '#8F9C94', 0.38], [1, '#5E6B63', 0.65]]);
      var bodyAttrs = { x: x0, y: cy - r, width: x1 - x0, height: 2 * r, rx: r * 0.42 };
      el('rect', bodyAttrs, el('clipPath', { id: uid + 'cb' }, bd));
      el('rect', bodyAttrs, el('clipPath', { id: uid + 'cf' }, fd));
      var sx0 = x0 + r * 0.9, sx1 = x1 - r * 0.9;          // screen (perforated) section
      el('rect', { x: sx0, y: cy - r, width: sx1 - sx0, height: 2 * r }, el('clipPath', { id: uid + 'cs' }, fd));

      // --- supports + base (behind everything)
      var base = c.back, by = cy + r + u * 0.2;
      [x0 + r * 0.55, x1 - r * 0.55].forEach(function (sx) {
        var yy = yAt(sx) + r;
        el('path', { d: 'M' + f1(sx - u * 0.16) + ',' + f1(by) + ' L' + f1(sx - u * 0.05) + ',' + f1(yy) + ' L' + f1(sx + u * 0.05) + ',' + f1(yy) + ' L' + f1(sx + u * 0.16) + ',' + f1(by) + ' Z', fill: C.i5 }, base);
        el('circle', { cx: sx - u * 0.06, cy: yy + u * 0.015, r: u * 0.035, fill: C.i7 }, base);
        el('circle', { cx: sx + u * 0.06, cy: yy + u * 0.015, r: u * 0.035, fill: C.i7 }, base);
        el('rect', { x: sx - u * 0.22, y: by, width: u * 0.44, height: u * 0.035, rx: u * 0.012, fill: C.i7 }, base);
      });
      // --- drum interior (dark), with lifter bars that sweep past
      var drumB = el('g', { transform: rot }, c.back);
      el('rect', Object.assign({ fill: 'url(#' + uid + 'in)' }, bodyAttrs), drumB);
      var lifters = el('g', {}, el('g', { 'clip-path': 'url(#' + uid + 'cb)' }, drumB)), ls = u * 0.42;
      for (var lx = x0 - ls; lx < x1 + ls; lx += ls) el('line', { x1: lx, y1: cy - r, x2: lx + u * 0.12, y2: cy + r, stroke: '#3D4A43', 'stroke-width': u * 0.03 }, lifters);
      // feed chute (left, higher end) and discharge chute (right) + overs pile
      el('path', { d: 'M' + f1(x0 - u * 0.55) + ',' + f1(yAt(x0) - r * 1.35) + ' L' + f1(x0 + r * 0.25) + ',' + f1(yAt(x0) - r * 0.25) + ' L' + f1(x0 + r * 0.25) + ',' + f1(yAt(x0) + r * 0.15) + ' L' + f1(x0 - u * 0.55) + ',' + f1(yAt(x0) - r * 0.7) + ' Z', fill: '#DDE4DF', stroke: C.i5, 'stroke-width': u * 0.012 }, c.back);
      var pileX = x1 + u * 0.42, pileY = by + u * 0.035;
      el('path', { d: 'M' + f1(x1 - r * 0.15) + ',' + f1(yAt(x1) + r * 0.35) + ' L' + f1(pileX + u * 0.06) + ',' + f1(pileY - u * 0.3) + ' L' + f1(pileX - u * 0.06) + ',' + f1(pileY - u * 0.36) + ' L' + f1(x1 - r * 0.3) + ',' + f1(yAt(x1) + r * 0.05) + ' Z', fill: '#DDE4DF', stroke: C.i5, 'stroke-width': u * 0.012 }, c.back);
      var pile = el('path', { d: 'M' + f1(pileX - u * 0.32) + ',' + f1(pileY) + ' Q' + f1(pileX) + ',' + f1(pileY - u * 0.34) + ' ' + f1(pileX + u * 0.32) + ',' + f1(pileY) + ' Z', fill: C.amber, opacity: 0.9 }, c.back);
      g.set(pile, { scaleY: 0, transformOrigin: '50% 100%' });

      // --- debris tumbling inside (behind the letters)
      var inside = function () { var x = sx0 + R() * (sx1 - sx0); return { x: x, y: yAt(x) - r * 0.4 + R() * r * 0.75 }; };
      var debris = [];
      for (var k = 0; k < 12; k++) {
        var p = inside(), kind = k % 3, d = kind === 0 ? el('circle', { cx: p.x, cy: p.y, r: u * (0.03 + R() * 0.03), fill: '#9AA79F' }, drumB)
          : kind === 1 ? el('rect', { x: p.x, y: p.y, width: u * 0.1, height: u * 0.045, rx: u * 0.01, fill: R() > 0.5 ? C.skyL : C.amber }, drumB)
            : el('path', { d: poly(p.x, p.y, u * 0.045, 6, 0.6, R), fill: '#8B8070' }, drumB);
        d._p = p; debris.push(d);
      }

      // --- the shell you look through (in front of the letters): shaded, perforated, ringed
      var drumF = el('g', { transform: rot }, c.front);
      el('rect', Object.assign({ fill: 'url(#' + uid + 'sh)' }, bodyAttrs), drumF);
      var mesh = el('g', {}, el('g', { 'clip-path': 'url(#' + uid + 'cs)' }, drumF)), s = u * 0.085, hr = u * 0.024;
      for (var hx = sx0 - s * 3; hx < sx1 + s * 3; hx += s)
        for (var hy = cy - r + s * 0.5, row = 0; hy < cy + r; hy += s * 0.78, row++) {
          var shade = Math.abs(hy - cy) / r;                      // holes foreshorten towards the edges
          el('rect', { x: f1(hx + (row % 2) * s / 2 - hr), y: f1(hy - hr * (1 - shade * 0.55)), width: f1(hr * 2), height: f1(hr * 2 * (1 - shade * 0.55)), rx: f1(hr * 0.5), fill: '#26312B', opacity: f1(0.42 - shade * 0.18) }, mesh);
        }
      var bands = el('g', {}, el('g', { 'clip-path': 'url(#' + uid + 'cf)' }, drumF)), bs = (sx1 - sx0) / 4;
      for (var bx = sx0 - bs; bx <= sx1 + bs; bx += bs) el('path', { d: 'M' + f1(bx) + ',' + f1(cy - r) + ' q' + f1(u * 0.07) + ',' + f1(r) + ' 0,' + f1(2 * r), fill: 'none', stroke: '#B9C4BD', 'stroke-width': u * 0.028 }, bands);
      el('rect', Object.assign({ fill: 'none', stroke: C.i7, 'stroke-width': u * 0.014 }, bodyAttrs), drumF);
      [x0 + r * 0.34, x1 - r * 0.34].forEach(function (ex) { el('ellipse', { cx: ex, cy: cy, rx: r * 0.3, ry: r * 1.04, fill: 'none', stroke: C.i7, 'stroke-width': u * 0.03 }, drumF); });
      el('ellipse', { cx: x1 - r * 0.34, cy: cy, rx: r * 0.2, ry: r * 0.78, fill: '#1B2520', opacity: 0.55 }, drumF);
      var gear = el('ellipse', { cx: x0 + r * 0.85, cy: cy, rx: r * 0.2, ry: r * 1.1, fill: 'none', stroke: C.i9, 'stroke-width': u * 0.035, 'stroke-dasharray': f1(u * 0.025) + ' ' + f1(u * 0.02) }, drumF);
      el('rect', { x: x0 + r * 0.25, y: cy - r * 1.6, width: u * 0.34, height: u * 0.2, rx: u * 0.03, fill: C.i7 }, drumF);
      el('line', { x1: x0 + r * 0.25 + u * 0.17, y1: cy - r * 1.4, x2: x0 + r * 0.85, y2: cy - r * 1.05, stroke: C.i5, 'stroke-width': u * 0.02 }, drumF);
      el('path', { d: 'M' + f1(x0 + r * 0.5) + ',' + f1(cy - r * 0.86) + ' L' + f1(x1 - r * 0.5) + ',' + f1(cy - r * 0.86), stroke: '#fff', 'stroke-width': u * 0.03, 'stroke-linecap': 'round', opacity: 0.75 }, drumF);
      var lab = el('text', { x: mid, y: cy - r - u * 0.1, 'text-anchor': 'middle', 'font-size': u * 0.075, fill: C.i5, 'font-family': 'var(--font-mono)', 'letter-spacing': '0.12em' }, c.front); lab.textContent = 'TROMMEL SCREEN';

      // rotation: mesh, bands, lifters and gear teeth sweep endlessly (beside the scene timeline)
      var spin = c.loop(g.timeline({ repeat: -1 }).to(mesh, { x: s, duration: 0.28, ease: 'none' }).set(mesh, { x: 0 }));
      var spin2 = c.loop(g.timeline({ repeat: -1 }).to(bands, { x: bs, duration: 1.1, ease: 'none' }).set(bands, { x: 0 }));
      var spin3 = c.loop(g.timeline({ repeat: -1 }).to(lifters, { x: -ls, duration: 0.7, ease: 'none' }).set(lifters, { x: 0 }));
      var spin4 = c.loop(g.to(gear, { strokeDashoffset: -u * 0.45, duration: 1, repeat: -1, ease: 'none' }));

      // letters start inside the drum, small and tumbling
      c.L.forEach(function (L, i) { var p = inside(), b = c.R[i]; g.set(L, { x: p.x - b.cx, y: p.y - b.cyv, scale: 0.48, rotation: R() * 360, color: MIX[i % MIX.length], opacity: 0, transformOrigin: '50% 60%' }); });
      tl.to(c.L, { opacity: 1, duration: 0.35, stagger: 0.03 }, 0).from(debris, { opacity: 0, duration: 0.3, stagger: 0.02 }, 0);
      var TUMBLE = 1.4;
      c.L.concat(debris).forEach(function (t, i) {
        var isL = i < c.L.length, b = isL ? c.R[i] : null, kf = [];
        for (var j = 0; j < 3; j++) { var q = inside(); kf.push(isL ? { x: q.x - b.cx, y: q.y - b.cyv, rotation: '+=' + (150 + R() * 120), duration: TUMBLE / 3 } : { x: q.x - t._p.x, y: q.y - t._p.y, rotation: '+=220', duration: TUMBLE / 3 }); }
        tl.to(t, { keyframes: kf, ease: 'sine.inOut', transformOrigin: '50% 50%' }, 0.1);
      });
      // fines dusting through the screen while it tumbles
      for (var fdot = 0; fdot < 18; fdot++) {
        var fx = sx0 + R() * (sx1 - sx0), dot = el('circle', { cx: fx, cy: yAt(fx) + r * 0.95, r: u * 0.013, fill: '#8B8070', opacity: 0 }, c.back);
        tl.fromTo(dot, { opacity: 0.9, y: 0 }, { y: c.B - yAt(fx) - r, opacity: 0, duration: 0.65, ease: 'power2.in', immediateRender: false }, 0.2 + R() * 1.3);
      }
      // one by one: to the screen floor -> through the mesh (flash + spray) -> fall and land
      var t0 = TUMBLE + 0.15, STEP = 0.3;
      c.L.forEach(function (L, i) {
        var b = c.R[i], at = t0 + i * STEP, floor = yAt(b.cx) + r * 0.55, exitY = yAt(b.cx) + r;
        tl.to(L, { x: 0, y: floor - b.cyv, rotation: 0, scale: 0.55, duration: 0.22, ease: 'power2.out' }, at);
        var flash = el('ellipse', { cx: b.cx, cy: exitY, rx: u * 0.1, ry: u * 0.03, fill: C.g3, opacity: 0 }, c.front);
        tl.fromTo(flash, { opacity: 0.95, attr: { rx: u * 0.08 } }, { opacity: 0, attr: { rx: u * 0.28, ry: u * 0.07 }, duration: 0.45, ease: 'power2.out', immediateRender: false }, at + 0.2);
        for (var sp = 0; sp < 5; sp++) {
          var spd = el('circle', { cx: b.cx, cy: exitY, r: u * 0.012, fill: sp % 2 ? C.g6 : '#8B8070', opacity: 0 }, c.back);
          tl.fromTo(spd, { opacity: 1, x: 0, y: 0 }, { opacity: 0, x: (R() - 0.5) * u * 0.35, y: u * (0.25 + R() * 0.25), duration: 0.5, ease: 'power1.in', immediateRender: false }, at + 0.2);
        }
        tl.to(L, { y: 0, scale: 1, color: C.i9, duration: 0.42, ease: 'power2.in' }, at + 0.22)
          .to(L, { scaleY: 0.86, scaleX: 1.08, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out', transformOrigin: '50% 100%' }, at + 0.64);
      });
      var tEnd = t0 + c.L.length * STEP;
      debris.forEach(function (d, i) {
        tl.to(d, { x: (x1 - r * 0.4) - d._p.x, y: yAt(x1) - d._p.y, duration: 0.45, ease: 'power1.in' }, tEnd - 0.6 + i * 0.06)
          .to(d, { x: '+=' + (pileX - x1 + r * 0.4), y: '+=' + (pileY - yAt(x1) - u * 0.15), scale: 0.6, opacity: 0, duration: 0.5, ease: 'power2.in' }, '>');
      });
      tl.to(pile, { scaleY: 1, duration: 1, ease: 'power2.out' }, tEnd - 0.2)
        .call(function () { [spin, spin2, spin3, spin4].forEach(function (t) { g.to(t, { timeScale: 0.35, duration: 1 }); }); }, null, tEnd + 0.3);
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

  /* 7. Auditing — a camera viewfinder frames the word, focuses, flashes; VERIFIED stamp lands. */
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

  /* 8. Alternate Fuel Resource — a cement kiln switches from coal to RDF pellets. Two hoppers
        feed an overhead conveyor; the diverter flips from COAL to RDF, the fuel-mix gauge swings
        over, the flame turns clean and the smoke clears, and the sooty letters turn green. */
  SCENES.afr = { word: 'Alternate Fuel Resource.', wordTop: 1.42, blurb: 'A cement kiln running on coal switches over to RDF pellets: the diverter flips, the fuel mix swings from coal to RDF, the flame and smoke clean up, and the sooty letters turn green.',
    build: function (c) {
      var tl = g.timeline(), fs = c.fs, u = c.u * 1.3, R = rng(29), W = c.W;   // machines a size up: the word sits lower here
      var top = c.B - fs * 0.78;                                   // top of the letters
      var xL = Math.max(u * 0.3, c.wx0 + u * 0.05), beltY = Math.min(top - c.u * 0.22, u * 1.0);
      var xK = Math.min(W - u * 0.3, c.wx1 + u * 0.1) - u * 1.45;  // kiln inlet
      // hoppers
      function hopper(x, label, col, fill) {
        var gH = el('g', {}, c.back), w = u * 0.5, y0 = u * 0.2, y1 = beltY - u * 0.24;
        el('path', { d: 'M' + f1(x) + ',' + f1(y0) + ' L' + f1(x + w) + ',' + f1(y0) + ' L' + f1(x + w * 0.66) + ',' + f1(y1) + ' L' + f1(x + w * 0.34) + ',' + f1(y1) + ' Z', fill: fill, stroke: col, 'stroke-width': u * 0.016 }, gH);
        for (var k = 0; k < 6; k++) el(label === 'COAL' ? 'path' : 'rect', label === 'COAL' ? { d: poly(x + w * (0.2 + 0.12 * k), y0 + u * 0.08 + (k % 2) * u * 0.05, u * 0.04, 6, 0.6, R), fill: C.coal } : { x: x + w * (0.16 + 0.12 * k), y: y0 + u * 0.06 + (k % 2) * u * 0.05, width: u * 0.07, height: u * 0.035, rx: u * 0.017, fill: C.g6 }, gH);
        var t = el('text', { x: x + w / 2, y: y0 - u * 0.05, 'text-anchor': 'middle', 'font-size': u * 0.08, fill: col, 'font-family': 'var(--font-mono)', 'letter-spacing': '0.12em', 'font-weight': 700 }, gH); t.textContent = label;
        var gate = el('rect', { x: x + w * 0.34, y: y1 - u * 0.012, width: w * 0.32, height: u * 0.024, fill: col }, gH);
        return { out: x + w / 2, gate: gate };
      }
      var coal = hopper(xL, 'COAL', C.i9, '#E8E4DE'), rdf = hopper(xL + u * 0.72, 'RDF', C.g7, C.g1);
      // overhead conveyor
      el('rect', { x: xL - u * 0.05, y: beltY, width: xK - xL + u * 0.1, height: u * 0.06, rx: u * 0.03, fill: C.i1, stroke: C.i5, 'stroke-width': u * 0.01 }, c.back);
      var belt = el('line', { x1: xL, x2: xK, y1: beltY + u * 0.03, y2: beltY + u * 0.03, stroke: C.i3, 'stroke-width': u * 0.012, 'stroke-dasharray': f1(u * 0.05) + ' ' + f1(u * 0.05) }, c.back);
      var diverter = el('line', { x1: rdf.out - u * 0.36, y1: beltY - u * 0.02, x2: rdf.out - u * 0.36, y2: beltY - u * 0.2, stroke: C.i9, 'stroke-width': u * 0.03, 'stroke-linecap': 'round' }, c.back);
      // rotary kiln + stack
      var kx0 = xK, kx1 = kx0 + u * 1.25, ky = beltY - u * 0.12, kr = u * 0.17;
      var kiln = el('g', { transform: 'rotate(-4 ' + f1(kx0) + ' ' + f1(ky) + ')' }, c.back);
      el('rect', { x: kx0, y: ky - kr, width: kx1 - kx0, height: kr * 2, rx: kr * 0.8, fill: C.i7 }, kiln);
      [0.3, 0.7].forEach(function (q) { el('rect', { x: kx0 + (kx1 - kx0) * q, y: ky - kr - u * 0.015, width: u * 0.05, height: kr * 2 + u * 0.03, rx: u * 0.01, fill: C.i5 }, kiln); });
      var glow = el('ellipse', { cx: kx0 + u * 0.12, cy: ky, rx: u * 0.09, ry: kr * 0.72, fill: '#8E2A1A' }, kiln);
      var flame = el('path', { d: 'M' + f1(kx0 + u * 0.08) + ',' + f1(ky - kr * 0.45) + ' Q' + f1(kx0 + u * 0.45) + ',' + f1(ky) + ' ' + f1(kx0 + u * 0.08) + ',' + f1(ky + kr * 0.45) + ' Z', fill: '#B23A22', opacity: 0.9 }, kiln);
      var stTop = u * 0.42, stx = kx1 - u * 0.12, stack = el('rect', { x: stx - u * 0.05, y: stTop, width: u * 0.1, height: ky - kr - stTop, fill: C.i5 }, c.back);
      var gauge = el('g', {}, c.front), gx = (xL + u * 1.3 + xK) / 2 - u * 0.65, gy = u * 0.2, gw = u * 1.3, gh = u * 0.08;
      var gl = el('text', { x: gx, y: gy - u * 0.04, 'font-size': u * 0.07, fill: C.i5, 'font-family': 'var(--font-mono)', 'letter-spacing': '0.12em' }, gauge); gl.textContent = 'KILN FUEL MIX';
      el('rect', { x: gx, y: gy, width: gw, height: gh, rx: gh / 2, fill: C.i1 }, gauge);
      var gC = el('rect', { x: gx, y: gy, width: gw, height: gh, rx: gh / 2, fill: C.coal }, gauge);
      var gR = el('rect', { x: gx, y: gy, width: 0, height: gh, rx: gh / 2, fill: C.g6 }, gauge);
      var gtC = el('text', { x: gx, y: gy + gh + u * 0.09, 'font-size': u * 0.065, fill: C.i9, 'font-family': 'var(--font-mono)' }, gauge); gtC.textContent = 'COAL';
      var gtR = el('text', { x: gx + gw, y: gy + gh + u * 0.09, 'text-anchor': 'end', 'font-size': u * 0.065, fill: C.g7, 'font-family': 'var(--font-mono)', opacity: 0.35 }, gauge); gtR.textContent = 'RDF';
      // smoke from the stack (dark while on coal, thinning after the switch)
      var puffs = [];
      for (var k = 0; k < 8; k++) {
        var pf = el('circle', { cx: stx, cy: stTop, r: u * (0.06 + R() * 0.05), fill: '#3B3631', opacity: 0 }, c.back);
        puffs.push(pf);
        var at = k * 0.45;
        tl.fromTo(pf, { opacity: 0.65, x: 0, y: 0, scale: 0.6 }, { opacity: 0, x: u * (0.25 + R() * 0.2), y: -u * 0.35, scale: 1.6, duration: 1.4, ease: 'sine.out', immediateRender: false }, at);
      }
      // letters start sooty
      g.set(c.L, { color: '#3A3530', y: function () { return (R() - 0.5) * fs * 0.03; }, rotation: function () { return (R() - 0.5) * 3; } });
      tl.to(belt, { strokeDashoffset: -u * 2.4, duration: 5.6, ease: 'none' }, 0);
      // fuel items riding the belt into the kiln
      function ride(kind, at, hop) {
        var item = kind === 'coal' ? el('path', { d: poly(0, 0, u * 0.055, 7, 0.55, R), fill: C.coal }, c.back)
          : el('rect', { x: -u * 0.045, y: -u * 0.02, width: u * 0.09, height: u * 0.04, rx: u * 0.02, fill: C.g6 }, c.back);
        g.set(item, { x: hop.out, y: beltY - u * 0.3, opacity: 0, transformOrigin: '50% 50%' });
        var dur = (xK - hop.out) / (u * 1.6);
        tl.to(item, { opacity: 1, duration: 0.1 }, at)
          .to(item, { y: beltY - u * 0.03, duration: 0.22, ease: 'power2.in' }, at)
          .to(item, { x: xK + u * 0.05, duration: dur, ease: 'none' }, at + 0.22)
          .to(item, { opacity: 0, scale: 0.5, duration: 0.15 }, at + 0.22 + dur - 0.1);
      }
      for (var i = 0; i < 8; i++) ride('coal', 0.1 + i * 0.2, coal);
      var SW = 1.75;
      tl.to(coal.gate, { attr: { x: '+=' + u * 0.0 }, scaleX: 0, transformOrigin: '50% 50%', duration: 0.01 }, SW - 0.05)
        .to(diverter, { rotation: 38, svgOrigin: f1(rdf.out - u * 0.36) + ' ' + f1(beltY - u * 0.02), duration: 0.3, ease: 'back.out(3)' }, SW)
        .to(rdf.gate, { scaleX: 0, transformOrigin: '50% 50%', duration: 0.2 }, SW);
      for (var j = 0; j < 18; j++) ride('rdf', SW + 0.15 + j * 0.15, rdf);
      // gauge, flame, smoke follow the switch
      tl.to(gC, { attr: { width: gw * 0.18 }, duration: 2.6, ease: 'power2.inOut' }, SW + 0.4)
        .to(gR, { attr: { x: gx + gw * 0.18, width: gw * 0.82 }, duration: 2.6, ease: 'power2.inOut' }, SW + 0.4)
        .to(gtR, { opacity: 1, duration: 0.6 }, SW + 0.8)
        .to(gtC, { opacity: 0.4, duration: 0.6 }, SW + 1.6)
        .to(flame, { fill: '#F6B53C', duration: 1.6 }, SW + 0.6)
        .to(glow, { fill: '#F9D27A', duration: 1.6 }, SW + 0.6)
        .to(puffs, { fill: '#C9CFCB', duration: 1.2 }, SW + 0.8)
        .to(flame, { scaleX: 1.18, svgOrigin: f1(kx0 + u * 0.08) + ' ' + f1(ky), duration: 0.16, yoyo: true, repeat: 23, ease: 'sine.inOut' }, 0);
      // the green wave across the letters, with a pellet popping off each one
      var w0 = c.wx0, w1 = c.wx1, WAVE = 2.4, tw = SW + 1.0;
      c.R.forEach(function (b, i) {
        var at = tw + WAVE * (b.cx - w0) / Math.max(1, w1 - w0);
        tl.to(c.L[i], { color: C.g6, y: 0, rotation: 0, duration: 0.3, ease: 'back.out(2.5)' }, at);
        if (c.L[i].textContent.trim() === '' || c.L[i].textContent === ' ') return;
        var pel = el('rect', { x: b.cx - u * 0.035, y: top - u * 0.02, width: u * 0.07, height: u * 0.032, rx: u * 0.016, fill: C.g6, opacity: 0 }, c.front);
        tl.fromTo(pel, { opacity: 1, y: 0, rotation: 0 }, { opacity: 0, y: -u * 0.22, rotation: 90, transformOrigin: '50% 50%', duration: 0.5, ease: 'power2.out', immediateRender: false }, at);
      });
      tl.to(c.L, { color: C.i9, duration: 0.6, stagger: 0.015 }, tw + WAVE + 0.5);
      return tl;
    } };

  var ORDER = ['tracing', 'processing', 'sorting', 'reclaiming', 'recovery', 'remediating', 'auditing', 'afr'];

  // ------------------------------------------------------------------ runner
  function mount(stage, opts) {
    opts = opts || {};
    var names = (opts.scenes || ORDER).filter(function (n) { return SCENES[n]; });
    var HOLD = opts.hold != null ? opts.hold : 1.6, loop = opts.loop !== false;
    var cur = -1, tl = null, paused = false, visible = true, loops = [];
    var back = el('svg', { class: 'hs-svg hs-back', 'aria-hidden': 'true' });
    var front = el('svg', { class: 'hs-svg hs-front', 'aria-hidden': 'true' });
    var word = document.createElement('span'); word.className = 'hs-word';   // span: the stage may sit inside an <h1>
    stage.textContent = '';
    stage.appendChild(back); stage.appendChild(word); stage.appendChild(front);

    function measure() {
      var sr = stage.getBoundingClientRect(), fs = parseFloat(getComputedStyle(word).fontSize);
      var base = document.createElement('span'); base.className = 'hs-base'; word.appendChild(base);
      var B = base.getBoundingClientRect().top - sr.top; word.removeChild(base);
      var spans = Array.prototype.slice.call(word.querySelectorAll('.hs-l'));
      var R = spans.map(function (s) { var r = s.getBoundingClientRect(); return { x: r.left - sr.left, w: r.width, cx: r.left - sr.left + r.width / 2, cyv: B - fs * 0.34 }; });
      return { W: sr.width, H: sr.height, u: sr.height / 2.45, fs: fs, B: B, L: spans, R: R, wx0: R[0].x, wx1: R[R.length - 1].x + R[R.length - 1].w, back: back, front: front, stage: stage,
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
      // Long words (e.g. "Alternate Fuel Research.") shrink to fit the width; machines keep their size (ctx.u).
      word.style.fontSize = '';
      word.style.top = sc.wordTop ? (r.height / 2.45 * sc.wordTop).toFixed(1) + 'px' : '';
      var ww = word.scrollWidth ? Array.prototype.reduce.call(word.children, function (a, s) { return a + s.getBoundingClientRect().width; }, 0) : 0;
      if (ww > r.width * 0.92) word.style.fontSize = (parseFloat(getComputedStyle(word).fontSize) * r.width * 0.92 / ww).toFixed(1) + 'px';
      back.setAttribute('viewBox', '0 0 ' + f1(r.width) + ' ' + f1(r.height)); front.setAttribute('viewBox', '0 0 ' + f1(r.width) + ' ' + f1(r.height));
      if (opts.onChange) opts.onChange(cur, names[cur], sc);
      if (still()) return;
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
