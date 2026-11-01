/* Advitia Labs landing page — interactive islands.
   Ported from the Claude Design export "Advitia Website v2". No build step:
   plain JS on the vendored React 18 UMD build (static/landing/vendor).
   Islands: #hero-word, #platform-app, #balance-viz, #forecast-viz. */
(function () {
'use strict';
if (!window.React || !window.ReactDOM) return;

const mq = q => !!(window.matchMedia && window.matchMedia(q).matches);
const REDUCED = mq('(prefers-reduced-motion: reduce)');
const CAN_HOVER = mq('(hover: hover) and (pointer: fine)');
const SUBS = { '₂': '2', '₄': '4', 'ₓ': 'x' };
/* Pagella has no subscript digits; render CO₂ / CH₄ with real <sub>. */
const chem = s => (typeof s !== 'string' || !/[₂₄ₓ]/.test(s)) ? s
  : s.split(/([₂₄ₓ])/).map((p, i) => i % 2 ? React.createElement('sub', { key: i }, SUBS[p]) : p);
/* Continuous visibility as a ref (no re-render): animation loops idle off-screen. */
function useVisibleRef(ref) {
  const vis = React.useRef(false);
  React.useEffect(() => {
    const el = ref.current; if (!el || !window.IntersectionObserver) { vis.current = true; return; }
    const io = new IntersectionObserver(([e]) => { vis.current = e.isIntersecting; }, { rootMargin: '120px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  return vis;
}
function useVisible(ref) {
  const [v, setV] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current; if (!el || !window.IntersectionObserver) { setV(true); return; }
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { threshold: 0.15 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return v;
}

const h = React.createElement;
const K = { g900:'#0B3D22', g800:'#0E5230', g700:'#0F7A3E', g600:'#0FA14E', g400:'#57C97F', g300:'#7ED356', g200:'#BFEBC9', g100:'#E4F6E9', sky:'#2380B8', sky4:'#6FB8DE', amber:'#C77D1B', red:'#C2402F', i900:'#121A14', i700:'#33413A', i500:'#5C6B62', i300:'#9AA79F', i200:'#CBD4CE', i100:'#E8EDEA', i050:'#F5F7F5' };
const SERIF = 'var(--font-serif)', MONO = 'var(--font-mono)';
const EASE = 'cubic-bezier(0.22,1,0.36,1)';

function useInView(th) {
  const ref = React.useRef(null);
  const [v, setV] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); io.disconnect(); } }, { threshold: th || 0.3 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return [ref, v];
}
function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function bez(p, t) { const u = 1 - t; return [0, 1].map(i => u*u*u*p[0][i] + 3*u*u*t*p[1][i] + 3*u*t*t*p[2][i] + t*t*t*p[3][i]); }
function dOf(p) { return `M${p[0]} C${p[1]} ${p[2]} ${p[3]}`; }
function smooth(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i-1] || pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2] || p2;
    const c1 = [p1[0] + (p2[0]-p0[0])/6, p1[1] + (p2[1]-p0[1])/6], c2 = [p2[0] - (p3[0]-p1[0])/6, p2[1] - (p3[1]-p1[1])/6];
    d += ` C${c1} ${c2} ${p2}`;
  }
  return d;
}
const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });


/* ---------- Hero: site flow ---------- */
const OX = 1070;
const OUT = [ { k: 'soil', label: 'Soil and fines', short: 'SOIL', share: '30–35%', c: K.g800, co2: 0.3 }, { k: 'inert', label: 'Stones and inerts', short: 'INERTS', share: '15–20%', c: K.i500, co2: 0.2 },
              { k: 'rdf', cr: ['EPR credit', 'Carbon credit'], label: 'RDF', short: 'RDF', share: '15–20%', c: K.amber, co2: 0.6 }, { k: 'plastic', cr: ['EPR credit'], label: 'Recycled plastics', short: 'PLASTICS', share: '5%', c: K.sky, co2: 1.4 },
              { k: 'metal', label: 'Metals', short: 'METALS', share: '2–5%', c: K.i700, co2: 1.8 }, { k: 'compost', cr: ['Carbon credit'], label: 'Compost', short: 'COMPOST', share: '20–25%', c: K.g600, co2: 0.9 },
              { k: 'bio', cr: ['Secure disposal'], label: 'Bio waste (hazardous)', short: 'BIO', share: '≈ 6%', c: K.red, co2: 0 } ].map((o, i) => Object.assign(o, { y: 70 + i * 122 }));
const BRIDGE = 432, STOP = 548, MR = 552, UR = 332, LR = 792, TX = 320, CX = 850, EX = 960;
function mkRoute(pts, rad) {
  rad = rad || 40; const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), r = Math.min(rad, d1 / 2, d2 / 2);
    const a = [p1[0] + (p0[0] - p1[0]) * r / d1, p1[1] + (p0[1] - p1[1]) * r / d1], b = [p1[0] + (p2[0] - p1[0]) * r / d2, p1[1] + (p2[1] - p1[1]) * r / d2];
    out.push(a); for (let k = 1; k < 10; k++) { const t = k / 10, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1]]); } out.push(b);
  }
  out.push(pts[pts.length - 1]);
  const P = [out[0]]; for (let i = 1; i < out.length; i++) if (Math.hypot(out[i][0] - P[P.length - 1][0], out[i][1] - P[P.length - 1][1]) > 0.01) P.push(out[i]);
  const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return { pts: P, cum, L: cum[cum.length - 1], d: 'M' + P.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') };
}
function atRoute(R, s) {
  s = Math.max(0, Math.min(R.L, s)); let i = 1; while (i < R.cum.length - 1 && R.cum[i] < s) i++;
  const a = R.pts[i - 1], b = R.pts[i], f = (s - R.cum[i - 1]) / ((R.cum[i] - R.cum[i - 1]) || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])];
}
const ROAD_D = [ mkRoute([[40, 228], [TX, 228], [TX, LR], [CX, LR], [CX, UR], [TX, UR]]).d, mkRoute([[40, 734], [TX, 734]]).d, mkRoute([[TX, MR], [EX, MR]]).d ];
const FAN = OUT.map(o => [[EX, MR], [EX + 48, MR], [OX - 100, o.y], [OX - 34, o.y]]);
const T_CYC = 16;
const OUT_INFO = { soil: 'Fine, soil-like material screened from legacy waste. Reused as cover or fill on site.', inert: 'Stones, glass, ceramics and grit from both lines. Sent for construction and engineered fill.',
  rdf: 'Refuse-derived fuel from light combustibles and multi-layer plastics, co-processed in cement kilns. Eligible for EPR and carbon credits.', plastic: 'Hand-picked recyclable plastics, baled and sold to recyclers. Counts toward producers\u2019 EPR targets.',
  metal: 'Ferrous and non-ferrous metals, sold to scrap recyclers.', compost: 'Organic fines composted aerobically, avoiding the methane they would produce in a landfill. Eligible for carbon credits.',
  bio: 'Hazardous sanitary waste such as sanitary pads and diapers. Picked out by hand, kept separate, and sent for secure disposal by incineration.' };
const HOT = [
  { t: 'Legacy landfill', d: 'The legacy dump being biomined. An excavator loads mixed waste into tippers, cell by cell, against the drone survey.', x: 20, y: 56, w: 262, h: 160 },
  { t: 'Households', d: 'Fresh municipal waste collected door to door and brought in by collection trucks.', x: 24, y: 640, w: 236, h: 70 },
  { t: 'Legacy feed and hopper', d: 'Tipped waste rides a feed conveyor into a hopper, which meters it evenly into the trommel.', x: 690, y: 212, w: 140, h: 100 },
  { t: 'Legacy trommel', d: 'A rotating drum screen. Fine holes release soil and fines, larger holes release stones and inerts, and what passes over the end is RDF.', x: 520, y: 228, w: 170, h: 64 },
  { t: 'Legacy outputs', d: 'Soil and fines, stones and inerts, and RDF. Each pile is loaded into a dispatch truck and weighed out.', x: 476, y: 292, w: 212, h: 40 },
  { t: 'CCTV', d: 'Cameras read number plates and record each load on the weighbridge, so every weight has visual evidence.', x: 664, y: 346, w: 70, h: 40 },
  { t: 'Boom barrier', d: 'Holds each vehicle until the weighbridge is clear, so trucks are weighed one at a time.', x: 408, y: 518, w: 40, h: 76 },
  { t: 'Weighbridge', d: 'Every truck is weighed in metric tonnes: loaded on the way in, and again on the way out with processed fractions.', x: 452, y: 538, w: 224, h: 42 },
  { t: 'Dispatch road', d: 'Processed fractions leave only after being weighed out. The ledger reconciles them against what came in.', x: 700, y: 536, w: 250, h: 30 },
  { t: 'Household feed', d: 'Collection trucks tip onto the floor; a feed conveyor lifts the waste up to the picking station.', x: 700, y: 670, w: 120, h: 100 },
  { t: 'Manual picking', d: 'Workers on the picking belt pull out hazardous bio waste first, then recyclable plastics, metals and multi-layer plastics.', x: 556, y: 616, w: 146, h: 64 },
  { t: 'Picking bins', d: 'Bio waste (sanitary pads, diapers) for secure disposal; plastics and metals for recycling; MLP for RDF.', x: 546, y: 712, w: 134, h: 66 },
  { t: 'Household trommel', d: 'Screens what remains after picking: fines to compost, mid-size to inerts, and overs to RDF.', x: 408, y: 684, w: 136, h: 44 },
  { t: 'Household outputs', d: 'Compost, inerts and RDF, each loaded and dispatched across the weighbridge.', x: 366, y: 738, w: 170, h: 54 }
].concat(OUT.map(o => ({ t: o.label, d: OUT_INFO[o.k], x: OX - 28, y: o.y - 28, w: 236, h: 80 })));
const MIXC = [K.sky, K.amber, K.i500, K.g600, K.i300, '#E8EDEA'];
const anim = (name, dur, delay, timing) => ({ animation: name + ' ' + dur + 's ' + (timing || 'ease-in-out') + ' ' + (delay || 0) + 's infinite', transformOrigin: '0px 0px' });
const A = (x, y, style, ...kids) => h('g', { transform: 'translate(' + x + ',' + y + ')' }, h('g', { style }, ...kids));
const ST = (c, w) => ({ stroke: c, strokeWidth: w || 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' });
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

const LFM = 'M4 150 L14 132 C20 120 28 124 34 110 L42 104 C48 92 56 98 62 84 L70 88 C78 70 88 76 96 62 L104 66 C110 52 118 58 124 46 L132 52 C140 42 148 52 154 58 L162 56 C170 66 174 62 180 74 L188 72 C194 84 200 82 206 96 L214 98 C220 110 228 112 232 126 L240 136 L246 150 Z';
const HEAP2 = 'M218 150 C222 138 230 136 236 130 C244 136 250 140 254 150 Z';
const SPECKS = [[30,118,K.sky,-20],[50,98,K.amber,15],[80,78,K.i700,30],[100,72,K.sky,-10],[140,56,K.amber,25],[170,72,K.sky,-30],[192,90,K.i700,10],[212,108,K.amber,-15],[60,120,K.g600,0],[120,90,K.sky,20],[176,104,K.amber,-25],[90,110,K.i700,35],[150,84,K.g600,-5],[228,140,K.sky,12]];
function Landfill() {
  return h('g', { transform: 'translate(20,60)' },
    h('defs', null, h('clipPath', { id: 'ta-lf' }, h('path', { d: LFM }))),
    [[30, -6, 0], [90, 6, 1.6]].map((b, i) => h('g', { key: 'b' + i }, A(b[0], b[1], anim('ta-fly', 9, b[2]),
      h('path', Object.assign({ d: 'M-6 0 Q-3 -4 0 0 Q3 -4 6 0', fill: 'none' }, ST(K.i500, 1.4)))))),
    h('g', { clipPath: 'url(#ta-lf)' },
      h('rect', { x: 0, y: 40, width: 250, height: 40, fill: K.i200 }),
      h('rect', { x: 0, y: 80, width: 250, height: 26, fill: K.i300 }),
      h('rect', { x: 0, y: 106, width: 250, height: 22, fill: '#8A978F' }),
      h('rect', { x: 0, y: 128, width: 250, height: 30, fill: K.i500 }),
      h('path', { d: 'M0 96 C40 90 60 104 100 98 C140 92 170 108 250 100', fill: 'none', stroke: K.i100, strokeWidth: 2, opacity: 0.6 }),
      SPECKS.map((s, i) => h('rect', { key: i, x: s[0], y: s[1], width: 8, height: 4, rx: 1.5, fill: s[2], transform: 'rotate(' + s[3] + ' ' + s[0] + ' ' + s[1] + ')' }))),
    h('path', Object.assign({ d: LFM, fill: 'none' }, ST(K.i700, 1.3))),
    h('path', Object.assign({ d: HEAP2, fill: K.i300 }, ST(K.i700, 1.2))),
    h('line', { x1: 0, x2: 262, y1: 150, y2: 150, stroke: K.i300 }),
    [[36, 106, 0], [196, 84, 1.2], [70, 84, 2.4]].map((w, i) => h('g', { key: i }, A(w[0], w[1], anim('ta-rise', 3.6, w[2], 'ease-out'),
      h('path', Object.assign({ d: 'M0 0 c-4 -6 4 -10 0 -16', fill: 'none' }, ST(K.i300, 1.6)))))),
    h('text', { x: 214, y: 70, style: { fontFamily: MONO, fontSize: 10, fill: K.i500 } }, 'CH₄'),
    h('rect', { x: 102, y: 42, width: 42, height: 9, rx: 4.5, fill: K.i900 }),
    h('rect', { x: 106, y: 26, width: 24, height: 17, rx: 3, fill: K.g600 }),
    h('rect', { x: 118, y: 29, width: 9, height: 7, rx: 1.5, fill: '#fff' }),
    A(130, 32, anim('ta-dig', 3.2),
      h('path', Object.assign({ d: 'M0 0 L22 -16', fill: 'none' }, ST(K.i700, 4))),
      h('path', Object.assign({ d: 'M22 -16 L34 2', fill: 'none' }, ST(K.i700, 3))),
      h('path', { d: 'M31 0 L41 5 L33 12 Z', fill: K.i700 })));
}
function Houses() {
  const house = x => h('g', { key: x },
    h('rect', { x, y: 66, width: 52, height: 38, fill: '#fff', stroke: K.i700, strokeWidth: 1.4 }),
    h('path', Object.assign({ d: 'M' + (x - 4) + ' 68 L' + (x + 26) + ' 44 L' + (x + 56) + ' 68 Z', fill: K.g100 }, ST(K.i700, 1.4))),
    h('rect', { x: x + 20, y: 84, width: 12, height: 20, fill: K.i100 }),
    h('rect', { x: x + 6, y: 74, width: 10, height: 9, fill: '#E7F3FA', stroke: K.i300, strokeWidth: 0.8 }),
    h('rect', { x: x + 38, y: 92, width: 10, height: 12, rx: 2, fill: K.g600 }),
    h('rect', { x: x + 37, y: 89, width: 12, height: 3, rx: 1.5, fill: K.g700 }));
  return h('g', { transform: 'translate(20,366)' }, [8, 84, 160].map(house));
}
const wheel = (x, y) => A(x, y, null, h('circle', { r: 5.5, fill: K.i900 }),
  h('g', { style: anim('ta-spin', 0.7, 0, 'linear') }, h('circle', { r: 2, fill: '#fff' }), h('line', { x1: 0, y1: -4, x2: 0, y2: 4, stroke: '#fff', strokeWidth: 1 })));
const cab = () => h('g', null, h('rect', { x: 8, y: -25, width: 22, height: 19, rx: 4, fill: K.i900 }), h('rect', { x: 17, y: -22, width: 10, height: 7, rx: 1.5, fill: '#E7F3FA' }));
const TRUCKS = [
  () => h('g', null, h('path', { d: 'M-32 -27 L6 -27 L4 -8 L-30 -8 Z', fill: K.i500 }), h('path', { d: 'M-30 -27 C-24 -38 -10 -40 2 -27 Z', fill: K.i300 }),
    h('rect', { x: -33, y: -9, width: 64, height: 4, fill: K.i900 }), cab(), wheel(-21, -3), wheel(19, -3)),
  () => h('g', null, h('rect', { x: -32, y: -29, width: 38, height: 22, rx: 4, fill: K.g600 }), h('rect', { x: -28, y: -20, width: 30, height: 2.5, rx: 1.25, fill: K.g300 }),
    h('rect', { x: -33, y: -9, width: 64, height: 4, fill: K.i900 }), cab(), wheel(-21, -3), wheel(19, -3)) ];

function SiteOffice({ refs }) {
  return h('g', null,
    h('line', { x1: 380, x2: 760, y1: 392, y2: 392, stroke: K.i200 }),
    h('line', { x1: 712, x2: 712, y1: 236, y2: 392, stroke: K.i700, strokeWidth: 3 }),
    h('line', { x1: 712, x2: 698, y1: 242, y2: 242, stroke: K.i700, strokeWidth: 3 }),
    A(698, 246, anim('ta-cam', 6),
      h('polygon', { points: '-26,0 -150,186 -70,196', fill: K.sky, style: { animation: 'ta-beam 2.4s ease-in-out infinite' } }),
      h('rect', { x: -26, y: -7, width: 26, height: 13, rx: 3, fill: '#fff', stroke: K.i700, strokeWidth: 1.4 }),
      h('rect', { x: -28, y: -9, width: 24, height: 4, rx: 2, fill: K.i700 }),
      h('circle', { cx: -26, cy: 0, r: 3, fill: K.i900 }),
      h('circle', { cx: -7, cy: 0, r: 1.8, fill: K.red, style: { animation: 'ta-blink 1.2s ease-in-out infinite' } })),
    h('text', { x: 720, y: 232, style: { fontFamily: MONO, fontSize: 9, fill: K.i500 } }, 'CAM 01'),
    h('path', { d: 'M440 ' + (BRIDGE + 10) + ' L452 ' + BRIDGE + ' L452 ' + (BRIDGE + 10) + ' Z', fill: K.i500 }),
    h('path', { d: 'M676 ' + BRIDGE + ' L688 ' + (BRIDGE + 10) + ' L676 ' + (BRIDGE + 10) + ' Z', fill: K.i500 }),
    h('rect', { x: 452, y: BRIDGE, width: 224, height: 10, rx: 2, ref: refs.deck, fill: K.i700, style: { transition: 'fill .3s' } }),
    h('rect', { x: 458, y: BRIDGE + 10, width: 212, height: 6, fill: K.i200 }),
    h('text', { x: 564, y: BRIDGE + 30, textAnchor: 'middle', style: { fontFamily: SERIF, fontSize: 9, letterSpacing: '0.14em', fill: K.i500 } }, 'WEIGHBRIDGE'));
}

const RPT = 'indefinite';
function Fall({ x0, x1, y0, y1, n, c, r, dur, seed }) {
  const R = rng(seed);
  return h('g', null, Array.from({ length: n }, (_, i) => { const x = (x0 + R() * (x1 - x0)).toFixed(1), b = (R() * dur).toFixed(2) + 's';
    return h('circle', { key: i, cx: x, cy: y0, r, fill: Array.isArray(c) ? c[i % c.length] : c, opacity: 0 },
      h('animate', { attributeName: 'cy', from: y0, to: y1, dur: dur + 's', begin: b, repeatCount: RPT }),
      h('animate', { attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.1;0.85;1', dur: dur + 's', begin: b, repeatCount: RPT })); }));
}
function Drum({ x, y, len, r, ang, secs, id, dur }) {
  let s0 = 0; const rows = [];
  secs.forEach((sc, si) => { const x0 = s0 * len + 3, x1 = sc.to * len - 3, sp = sc.hr * 2 + 4.5; s0 = sc.to;
    for (let cy = -r - 8, j = 0; cy <= r + 8; cy += 8, j++) rows.push(h('line', { key: si + '_' + j, x1: x0 + (j % 2 ? sp / 2 : 0), x2: x1, y1: cy, y2: cy, stroke: K.i700, strokeWidth: sc.hr * 2, strokeLinecap: 'round', strokeDasharray: '0 ' + sp.toFixed(1) })); });
  return h('g', { transform: 'translate(' + x + ',' + y + ') rotate(' + ang + ')' },
    h('defs', null, h('clipPath', { id }, h('rect', { x: 0, y: -r, width: len, height: 2 * r, rx: 6 }))),
    h('rect', { x: 0, y: -r, width: len, height: 2 * r, rx: 6, fill: K.i300 }),
    h('g', { clipPath: 'url(#' + id + ')' },
      h('g', null, h('animateTransform', { attributeName: 'transform', type: 'translate', from: '0 0', to: '0 16', dur: (dur * 2) + 's', repeatCount: RPT }), rows),
      h('rect', { x: 0, y: -r, width: len, height: r * 0.5, fill: '#fff', opacity: 0.3 }),
      h('rect', { x: 0, y: r * 0.45, width: len, height: r * 0.55, fill: K.i900, opacity: 0.2 })),
    secs.slice(0, -1).map((sc, i) => h('line', { key: i, x1: sc.to * len, x2: sc.to * len, y1: -r, y2: r, stroke: K.i700, strokeWidth: 2 })),
    h('rect', { x: 0, y: -r, width: len, height: 2 * r, rx: 6, fill: 'none', stroke: K.i700, strokeWidth: 1.4 }),
    [0.13, 0.87].map((f, i) => h('rect', { key: 'rg' + i, x: f * len - 4, y: -r - 3, width: 8, height: 2 * r + 6, rx: 2, fill: K.i700 })),
    h('ellipse', { cx: 0, cy: 0, rx: 4, ry: r, fill: K.i700 }), h('ellipse', { cx: len, cy: 0, rx: 4, ry: r, fill: K.i900 }));
}
function Belt({ a, b, items, dur }) {
  const d = 'M' + a[0] + ',' + (a[1] - 5) + ' L' + b[0] + ',' + (b[1] - 5);
  return h('g', null,
    h('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: K.i900, strokeWidth: 6, strokeLinecap: 'round' }),
    h('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: K.i500, strokeWidth: 2, strokeDasharray: '4 6' }, h('animate', { attributeName: 'stroke-dashoffset', from: 10, to: 0, dur: '0.5s', repeatCount: RPT })),
    [a, b].map((p, i) => h('circle', { key: i, cx: p[0], cy: p[1], r: 4, fill: K.i700 })),
    Array.from({ length: items }, (_, i) => { const bg = (i * dur / items).toFixed(2) + 's';
      return h('rect', { key: 'it' + i, x: -3.5, y: -2.5, width: 7, height: 5, rx: 1.5, fill: MIXC[i % MIXC.length], opacity: 0 },
        h('animateMotion', { path: d, dur: dur + 's', begin: bg, repeatCount: RPT }), h('set', { attributeName: 'opacity', to: 1, begin: bg })); }));
}
function Picker({ x, y, shirt, bin, dur, delay, dir }) {
  const D = dur + 's', B = delay + 's', q = dir || 1, rv = [0, 35, 20, -40, 0].map(v => v * q).join(';');
  return h('g', null,
    h('path', { d: 'M' + (x - 7) + ' ' + y + ' L' + (x - 6) + ' ' + (y - 24) + ' Q' + x + ' ' + (y - 28) + ' ' + (x + 6) + ' ' + (y - 24) + ' L' + (x + 7) + ' ' + y + ' Z', fill: shirt }),
    h('circle', { cx: x, cy: y - 33, r: 6, fill: K.i700 }),
    h('path', { d: 'M' + (x - 8) + ' ' + (y - 35) + ' Q' + x + ' ' + (y - 46) + ' ' + (x + 8) + ' ' + (y - 35) + ' Z', fill: '#E5AE0C' }),
    h('line', { x1: x - 5 * q, y1: y - 21, x2: x - 8 * q, y2: y - 6, stroke: K.i700, strokeWidth: 3, strokeLinecap: 'round' }),
    h('g', { transform: 'translate(' + (x + 4 * q) + ',' + (y - 21) + ')' }, h('g', null,
      h('animateTransform', { attributeName: 'transform', type: 'rotate', values: rv, keyTimes: '0;0.3;0.45;0.7;1', dur: D, begin: B, repeatCount: RPT }),
      h('line', { x1: 0, y1: 0, x2: 0, y2: 17, stroke: K.i700, strokeWidth: 3, strokeLinecap: 'round' }))),
    h('rect', { x: -3.5, y: -2.5, width: 7, height: 5, rx: 1.5, fill: bin.c, opacity: 0 },
      h('animateMotion', { path: 'M' + (x - 4 * q) + ',' + (y - 2) + ' Q' + (x + 8 * q) + ',' + (y - 26) + ' ' + bin.x + ',' + (y + 4) + ' L' + bin.x + ',' + 562, keyPoints: '0;0;1;1', keyTimes: '0;0.3;0.8;1', calcMode: 'linear', dur: D, begin: B, repeatCount: RPT }),
      h('animate', { attributeName: 'opacity', values: '0;0;1;1;0', keyTimes: '0;0.28;0.32;0.8;0.84', dur: D, begin: B, repeatCount: RPT })));
}
const pile = (cx, gy, w, ht, c) => h('path', { d: 'M' + (cx - w) + ' ' + gy + ' Q' + cx + ' ' + (gy - ht * 2) + ' ' + (cx + w) + ' ' + gy + ' Z', fill: c, opacity: 0.85 });
const leg = (x, y0, y1) => h('line', { x1: x, x2: x, y1: y0, y2: y1, stroke: K.i700, strokeWidth: 3 });
const tag = (x, y, t, c) => h('text', { x, y, textAnchor: 'middle', style: { fontFamily: MONO, fontSize: 9, letterSpacing: '0.08em', fill: c || K.i500, stroke: '#fff', strokeWidth: 3, paintOrder: 'stroke', strokeLinejoin: 'round' } }, t);
function LegacyPlant() {
  const G = 310;
  return h('g', null,
    h('line', { x1: 450, x2: 830, y1: G, y2: G, stroke: K.i200 }),
    pile(816, G, 18, 9, K.i300),
    leg(716, 246, G), leg(704, 246, G), leg(685, 278, G), leg(542, 288, G),
    h(Belt, { a: [806, 304], b: [728, 226], items: 6, dur: 2.4 }),
    h(Fall, { x0: 620, x1: 688, y0: 282, y1: 304, n: 12, c: K.g800, r: 1.6, dur: 0.9, seed: 21 }),
    h(Fall, { x0: 534, x1: 608, y0: 289, y1: 304, n: 9, c: [K.i500, K.i300], r: 2.4, dur: 0.9, seed: 22 }),
    h(Fall, { x0: 510, x1: 520, y0: 274, y1: 304, n: 5, c: [K.amber, K.sky, '#E8EDEA'], r: 3, dur: 0.8, seed: 23 }),
    pile(655, G, 32, 8, K.g800), pile(570, G, 32, 9, K.i500), pile(500, G, 20, 9, K.amber),
    h(Drum, { x: 524.4, y: 268.6, len: 180, r: 24, ang: -4, secs: [{ to: 0.5, hr: 2.8 }, { to: 1, hr: 1.3 }], id: 'ta-dr1', dur: 0.5 }),
    h('polygon', { points: '736,220 688,220 700,250 718,250', fill: K.g800, stroke: K.g900, strokeWidth: 1.2 }));
}
function HouseholdPlant() {
  const G = 600, BY = 505, bins = [{ x: 664, c: K.red }, { x: 630, c: K.sky }, { x: 596, c: K.i700 }, { x: 562, c: K.amber }];
  return h('g', null,
    h('line', { x1: 360, x2: 830, y1: G, y2: G, stroke: K.i200 }),
    pile(816, G, 18, 9, K.i300),
    h('line', { x1: 544, x2: 702, y1: 452, y2: 452, stroke: K.i700, strokeWidth: 3, strokeLinecap: 'round' }),
    leg(700, 452, G), leg(546, 452, G),
    bins.map((b, i) => h('g', { key: 'b' + i },
      h('polygon', { points: (b.x - 5) + ',' + (BY + 4) + ' ' + (b.x + 5) + ',' + (BY + 4) + ' ' + (b.x + 7) + ',548 ' + (b.x - 7) + ',548', fill: K.i200 }),
      h('rect', { x: b.x - 13, y: 548, width: 26, height: 28, rx: 3, fill: '#fff', stroke: b.c, strokeWidth: 1.6 }),
      h('rect', { x: b.x - 13, y: 548, width: 26, height: 5, rx: 2, fill: b.c }))),
    bins.map((b, i) => h(Picker, { key: 'p' + i, x: b.x + 14, y: BY - 2, shirt: [K.g600, K.sky, K.g700, K.g600][i], bin: b, dur: 2.2 + i * 0.25, delay: i * 0.45, dir: -1 })),
    h(Belt, { a: [806, 594], b: [695, BY], items: 7, dur: 2.6 }),
    h(Belt, { a: [695, BY], b: [555, BY], items: 9, dur: 3.2 }),
    leg(528, 540, G), leg(424, 548, G),
    h(Fall, { x0: 480, x1: 534, y0: 545, y1: 594, n: 12, c: K.g600, r: 1.6, dur: 1.0, seed: 31 }),
    h(Fall, { x0: 418, x1: 474, y0: 550, y1: 594, n: 9, c: [K.i500, K.i300], r: 2.2, dur: 1.0, seed: 32 }),
    h(Fall, { x0: 402, x1: 410, y0: 536, y1: 594, n: 5, c: [K.amber, '#E8EDEA', K.sky], r: 3, dur: 0.9, seed: 33 }),
    pile(506, G, 28, 8, K.g600), pile(447, G, 26, 7, K.i500), pile(388, G, 18, 9, K.amber),
    h(Drum, { x: 412.3, y: 531.1, len: 130, r: 18, ang: -4, secs: [{ to: 0.5, hr: 2.2 }, { to: 1, hr: 1.1 }], id: 'ta-dr2', dur: 0.5 }));
}
function FractionIcon({ i }) {
  const o = OUT[i], s = ST(o.c), k = o.k;
  const flame = (sc) => h('g', { transform: 'scale(' + sc + ')' }, h('g', { style: anim('ta-flicker', 1.6) },
    h('path', Object.assign({ d: 'M0 0 C-7 0 -9 -6 -8 -10 C-7 -15 -3 -17 -2 -24 C3 -20 8 -15 8 -9 C8 -4 5 0 0 0 Z', fill: '#FBF0DD' }, s)),
    h('path', { d: 'M0 -1 C-3 -1 -4 -4 -3 -6 C-2 -8 0 -9 0 -12 C3 -9 4 -6 3 -4 C3 -2 2 -1 0 -1 Z', fill: o.c })));
  const sprout = h('g', null, h('path', Object.assign({ d: 'M0 4 V-6', fill: 'none' }, s)),
    A(0, -6, anim('ta-sway', 3),
      h('path', Object.assign({ d: 'M0 0 C-9 -2 -11 -9 -9 -11 C-4 -11 0 -6 0 0 Z', fill: K.g100 }, s)),
      h('path', Object.assign({ d: 'M0 -2 C7 -4 10 -11 8 -13 C3 -13 0 -8 0 -2 Z', fill: K.g100 }, s))));
  let icon;
  if (k === 'compost') icon = h('g', null, h('path', Object.assign({ d: 'M-13 12 C-10 3 10 3 13 12 Z', fill: K.amber + '22' }, ST(K.i700))), h('g', { transform: 'translate(0,2)' }, sprout));
  if (k === 'plastic') icon = h('g', null,
    h('g', { style: anim('ta-spin', 9, 0, 'linear') }, h('circle', { r: 19, fill: 'none', stroke: o.c, strokeWidth: 1.2, strokeDasharray: '9 7', opacity: 0.55 })),
    h('path', Object.assign({ d: 'M-3 -12 H3 V-9 C6 -7 7 -5 7 -2 V10 C7 11 6 12 5 12 H-5 C-6 12 -7 11 -7 10 V-2 C-7 -5 -6 -7 -3 -9 Z', fill: '#E7F3FA' }, s)),
    h('path', Object.assign({ d: 'M-7 3 H7', fill: 'none' }, s)));
  if (k === 'rdf') icon = h('g', null,
    h('rect', Object.assign({ x: -11, y: -2, width: 22, height: 14, rx: 2, fill: '#FBF0DD' }, s)),
    h('path', Object.assign({ d: 'M-4 -2 V12 M4 -2 V12', fill: 'none' }, s)),
    h('g', { transform: 'translate(0,-3)' }, flame(0.55)));
  if (k === 'inert') icon = h('g', null,
    h('ellipse', Object.assign({ cx: -5, cy: 6, rx: 8, ry: 5.5, fill: K.i100 }, s)),
    h('ellipse', Object.assign({ cx: 6, cy: 7, rx: 6, ry: 4.5, fill: K.i050 }, s)),
    h('ellipse', Object.assign({ cx: 1, cy: -3, rx: 6.5, ry: 5, fill: '#fff' }, s)));
  if (k === 'soil') icon = h('g', null,
    h('path', Object.assign({ d: 'M-13 11 C-9 -1 9 -1 13 11 Z', fill: K.g100 }, s)),
    [[-5, 7], [0, 3], [5, 8], [-1, 9], [7, 4]].map((p, j) => h('circle', { key: j, cx: p[0], cy: p[1], r: 1.2, fill: o.c })),
    h('g', { transform: 'translate(0,-2) scale(0.7)' }, sprout));
  if (k === 'bio') icon = h('g', null,
    h('path', Object.assign({ d: 'M0 -13 L13 10 L-13 10 Z', fill: '#FBE9E6' }, s)),
    h('path', Object.assign({ d: 'M0 -4 V3', fill: 'none' }, s)), h('circle', { cx: 0, cy: 6.5, r: 1.3, fill: o.c }));
  if (k === 'metal') icon = h('g', null,
    h('defs', null, h('clipPath', { id: 'ta-can' }, h('rect', { x: -8, y: -9, width: 16, height: 21 }))),
    h('path', { d: 'M-8 -9 V9 A8 3 0 0 0 8 9 V-9 Z', fill: K.i100 }),
    h('g', { clipPath: 'url(#ta-can)' }, h('g', { style: anim('ta-glint', 2.6, 0, 'ease-in') }, h('rect', { x: -2, y: -12, width: 3, height: 26, fill: '#fff' }))),
    h('path', Object.assign({ d: 'M-8 -9 V9 A8 3 0 0 0 8 9 V-9', fill: 'none' }, s)),
    h('ellipse', Object.assign({ cx: 0, cy: -9, rx: 8, ry: 3, fill: '#fff' }, s)));
  return h('g', null, h('rect', { x: -26, y: -26, width: 52, height: 52, rx: 16, fill: '#fff', stroke: K.i200 }), icon);
}

const SIDETRUCK_OUT = (loadRef) => h('g', null,
  h('path', { ref: loadRef, d: 'M-30 -26 C-24 -39 -10 -41 3 -26 Z', fill: K.i300, opacity: 0 }),
  h('path', { d: 'M-32 -27 L6 -27 L4 -8 L-30 -8 Z', fill: K.g700 }),
  h('rect', { x: -28, y: -21, width: 30, height: 2.5, rx: 1.25, fill: K.g300 }),
  h('rect', { x: -33, y: -9, width: 64, height: 4, fill: K.i900 }), cab(), wheel(-21, -3), wheel(19, -3));
const TOPTRUCK = (body, loadRef) => h('g', null,
  [[-20, -14], [-20, 10], [-7, -14], [-7, 10], [20, -14], [20, 10]].map(([x, y], i) => h('rect', { key: i, x: x - 4, y, width: 8, height: 4, rx: 1, fill: K.i900 })),
  h('rect', { x: -31, y: -12, width: 42, height: 24, rx: 3, fill: body }),
  h('rect', { x: -31, y: -12, width: 42, height: 24, rx: 3, fill: 'none', stroke: K.i900, strokeOpacity: 0.25 }),
  h('rect', { ref: loadRef, x: -27, y: -8.5, width: 34, height: 17, rx: 2, fill: K.i300, opacity: 0 }),
  h('rect', { x: 13, y: -11, width: 18, height: 22, rx: 4, fill: K.i900 }),
  h('rect', { x: 15, y: -9, width: 7, height: 18, rx: 1.5, fill: K.i700 }),
  h('rect', { x: 24, y: -9, width: 4, height: 18, rx: 1.5, fill: '#E7F3FA' }));
const C_SEQ = [{ o: 0, x: 642 }, { o: 1, x: 557 }, { o: 2, x: 487 }, { o: 0, x: 642 }];
const D_SEQ = [{ o: 5, x: 493 }, { o: 3, x: 617 }, { o: 6, x: 651 }, { o: 4, x: 583 }, { o: 5, x: 493 }, { o: 2, x: 549 }, { o: 1, x: 434 }, { o: 2, x: 375 }];
function agentLegs(id, cyc) {
  if (id === 0) return [{ k: 'drive', R: mkRoute([[40, 228], [TX, 228], [TX, MR], [STOP, MR]]), dur: 5.0, fin: 1 }, { k: 'wait', dur: 1.4, ev: 'weigh' }, { k: 'drive', R: mkRoute([[STOP, MR], [CX, MR], [CX, UR], [785, UR]]), dur: 3.2 }, { k: 'wait', dur: 1.3, ev: 'tip' }, { k: 'fade', dur: 0.5 }];
  if (id === 1) return [{ k: 'drive', R: mkRoute([[40, 734], [TX, 734], [TX, MR], [STOP, MR]]), dur: 4.2, fin: 1 }, { k: 'wait', dur: 1.4, ev: 'weigh' }, { k: 'drive', R: mkRoute([[STOP, MR], [CX, MR], [CX, LR], [785, LR]]), dur: 3.2 }, { k: 'wait', dur: 1.3, ev: 'tip' }, { k: 'fade', dur: 0.5 }];
  const sq = id === 2 ? C_SEQ : D_SEQ, f = sq[((cyc % sq.length) + sq.length) % sq.length], ry = id === 2 ? UR : LR, R1 = mkRoute([[f.x, ry], [TX, ry], [TX, MR], [STOP, MR]]);
  return [{ k: 'wait', dur: 0.4, fin: 1, ev: 'load', pos: atRoute(R1, 0) }, { k: 'wait', dur: 1.4, ev: 'load' }, { k: 'drive', R: R1, dur: 5.0 }, { k: 'wait', dur: 1.4, ev: 'weigh' }, { k: 'drive', R: mkRoute([[STOP, MR], [EX, MR]]), dur: 3.6 }, { k: 'fade', dur: 0.5, ev: 'dump' }].map(l => Object.assign(l, { o: f.o }));
}
const AGENTS = [ { id: 0, target: 0, src: 'IN · LEGACY · TRK 07' }, { id: 1, target: 8, src: 'IN · HOUSEHOLD · TRK 12' }, { id: 2, target: 4, src: 'TRK 21' }, { id: 3, target: 12, src: 'TRK 24' } ];

function HeroFlow({ speed, density, showCounters, mini, vb }) {
  const svgRef = React.useRef(null), visRef = useVisibleRef(svgRef), vbT = React.useRef(vb || [0, 0, 1280, 870]); vbT.current = vb || [0, 0, 1280, 870]; const vbC = React.useRef(null);
  const dots = React.useRef([]), truckEls = React.useRef([]), topEls = React.useRef([]), sideEls = React.useRef([]), tipEls = React.useRef([]), loadEls = React.useRef([]);
  const refs = { weight: React.useRef(), plate: React.useRef(), deck: React.useRef() };
  const refIn = React.useRef(), refOut = React.useRef(), refCo = React.useRef(), refCh4 = React.useRef(), refEpr = React.useRef(), barRef = React.useRef();
  const spd = React.useRef(speed); spd.current = speed;
  const [tip, setTip] = React.useState(null);
  const POOL = 140, batch = Math.max(4, Math.min(40, Math.round((density | 0) / 4)));
  const bRef = React.useRef(batch); bRef.current = batch;
  React.useEffect(() => {
    const R = rng(11), c = { tin: 1284.6, tout: 1002.3, ch4: 23.1, epr: 142.3 }; let bar = 0;
    const parts = Array.from({ length: POOL }, () => ({ on: false }));
    const ags = AGENTS.map(a => ({ ...a, cyc: null, legs: null, li: -1, load: 0 }));
    let clock = 0, raf, last = performance.now(), lastTxt = 0;
    const emit = (load, o) => { const n = bRef.current, m = load / n; let k = 0;
      for (const p of parts) { if (k >= n) break; if (!p.on) { Object.assign(p, { on: true, t: -k * 0.06 - R() * 0.05, o, j: (R() - 0.5) * 14, v: 0.42 + R() * 0.1, m }); k++; } } };
    const step = (dt, now, force) => {
      clock += dt * spd.current;
      let weighing = null, near = false;
      ags.forEach((ag, ai) => {
        const el = truckEls.current[ai]; if (!el) return;
        if (!ag.legs) { ag.legs = agentLegs(ag.id, 0); let t = 0; ag.legs.forEach(l => { l.t0 = t; t += l.dur; }); }
        const wl = ag.legs.find(l => l.ev === 'weigh'), u = clock - ag.target + wl.t0 + T_CYC * 4, cyc = Math.floor(u / T_CYC), tau = u - cyc * T_CYC;
        if (cyc !== ag.cyc) { ag.cyc = cyc; ag.legs = agentLegs(ag.id, cyc); let t = 0, pos = null; ag.legs.forEach(l => { l.t0 = t; t += l.dur; if (l.k === 'drive') pos = atRoute(l.R, l.R.L); else l.pos = l.pos || pos; if (!pos && l.pos) pos = l.pos; }); ag.li = -1; }
        let li = ag.legs.findIndex(l => tau >= l.t0 && tau < l.t0 + l.dur);
        const L = ag.legs[li];
        if (li !== ag.li) {
          ag.li = li;
          if (L && L.ev === 'weigh' && ag.id < 2) { ag.load = 8 + R() * 6; c.tin += ag.load; c.ch4 += ag.load * (ag.id === 0 ? 0.008 : 0.026); }
          if (L && L.ev === 'load' && L.fin) ag.load = 6 + R() * 6;
          if (L && L.ev === 'dump') { emit(ag.load, L.o); }
        }
        let pos, op = 1, ld = 1;
        if (!L) { el.setAttribute('opacity', 0); if (tipEls.current[ai]) tipEls.current[ai].setAttribute('opacity', 0); return; }
        const f = (tau - L.t0) / L.dur;
        if (L.k === 'drive') { const sd = L.R.L * ease(f), pp = atRoute(L.R, sd), p0 = atRoute(L.R, sd - 14), p1 = atRoute(L.R, sd + 14); pos = [pp[0], pp[1], Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.5 ? Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) : pp[2]]; } else pos = L.pos;
        if (L.fin) op = Math.min(1, (tau - L.t0) / 0.3);
        if (L.k === 'fade') op = 1 - f;
        if (ag.id < 2) ld = L.ev === 'tip' ? 1 - f : L.k === 'fade' ? 0 : 1;
        if (ag.id >= 2) { const l0 = ag.legs[0], l1 = ag.legs[1]; ld = Math.max(0, Math.min(1, (tau - l0.t0) / (l0.dur + l1.dur))); if (L.ev === 'dump') ld = 1 - f; }
        if (L.ev === 'weigh') weighing = { ag, k: Math.min(1, (tau - L.t0) / 0.8), L };
        const ca = Math.cos(pos[2]), sw = Math.max(0, Math.min(1, (Math.abs(ca) - 0.97) / 0.03)), T = 'translate(' + pos[0].toFixed(1) + ',' + pos[1].toFixed(1) + ')';
        const te = topEls.current[ai], se = sideEls.current[ai];
        if (te) { te.setAttribute('transform', T + ' rotate(' + (pos[2] * 180 / Math.PI).toFixed(1) + ')'); te.setAttribute('opacity', (1 - sw).toFixed(2)); }
        if (se) { se.setAttribute('transform', T + (ca < 0 ? ' scale(-1,1)' : '') + ' translate(0,10)'); se.setAttribute('opacity', sw.toFixed(2)); }
        el.setAttribute('opacity', op.toFixed(2));
        if (op > 0.1 && Math.abs(pos[1] - MR) < 4 && pos[0] > 270 && pos[0] < 446) near = true;
        if (tipEls.current[ai]) tipEls.current[ai].setAttribute('opacity', L.ev === 'tip' ? 1 : 0);
        (loadEls.current[ai] || []).forEach(le => { if (!le) return; le.setAttribute('opacity', ld.toFixed(2)); le.setAttribute('fill', OUT[ag.legs[0].o] ? OUT[ag.legs[0].o].c : K.i300); });
      });
      parts.forEach((p, i) => {
        const el = dots.current[i]; if (!el) return;
        if (!p.on) { el.setAttribute('opacity', 0); return; }
        p.t += dt * p.v * spd.current;
        if (p.t < 0) { el.setAttribute('opacity', 0); return; }
        if (p.t >= 1) { p.on = false; c.tout += p.m * 0.98; if (OUT[p.o].k === 'rdf' || OUT[p.o].k === 'plastic') c.epr += p.m * 0.98; el.setAttribute('opacity', 0); return; }
        const pt = bez(FAN[p.o], p.t); pt[1] += p.j * Math.sin(Math.PI * p.t) * 0.6;
        el.setAttribute('cx', pt[0].toFixed(1)); el.setAttribute('cy', pt[1].toFixed(1)); el.setAttribute('fill', OUT[p.o].c);
        el.setAttribute('opacity', Math.min(1, p.t * 10, (1 - p.t) * 10).toFixed(2));
      });
      bar += ((near ? 1 : 0) - bar) * Math.min(1, dt * spd.current * 7);
      if (barRef.current) barRef.current.setAttribute('transform', 'rotate(' + (bar * -88).toFixed(1) + ' 0 21)');
      if (force || now - lastTxt > 100) {
        lastTxt = now;
        const w = weighing, plate = w ? (w.ag.id < 2 ? w.ag.src : 'OUT · ' + OUT[w.L.o].short + ' · ' + w.ag.src) : 'READY';
        if (refs.weight.current) refs.weight.current.textContent = (w ? w.ag.load * ease(w.k) : 0).toFixed(2) + ' t';
        if (refs.plate.current) refs.plate.current.textContent = plate;
        if (refs.deck.current) refs.deck.current.setAttribute('fill', w ? (w.ag.id < 2 ? K.g600 : K.sky) : K.i700);
        if (refIn.current) refIn.current.textContent = fmt(c.tin);
        if (refOut.current) refOut.current.textContent = fmt(c.tout);
        if (refCo.current) refCo.current.textContent = fmt(c.ch4 * 28);
        if (refCh4.current) refCh4.current.textContent = fmt(c.ch4);
        if (refEpr.current) refEpr.current.textContent = fmt(c.epr);
      }
    };
    const tick = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (visRef.current) step(dt, now);
      if (mini && svgRef.current) { const T = vbT.current, C = vbC.current || (vbC.current = T.slice()), k = Math.min(1, dt * 2.6); for (let j = 0; j < 4; j++) C[j] += (T[j] - C[j]) * k; svgRef.current.setAttribute('viewBox', C.map(v => v.toFixed(1)).join(' ')); }
      raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const cap = (x, y, s, anchor) => h('text', { x, y, textAnchor: anchor || 'start', style: { fontFamily: SERIF, fontSize: 11, letterSpacing: '0.14em', fill: K.i500 } }, s);
  const lbl = (x, y, t, sub) => h('g', null,
    h('text', { x, y, style: { fontFamily: SERIF, fontSize: 19, fill: K.i900 } }, t),
    h('text', { x, y: y + 20, style: { fontFamily: SERIF, fontSize: 14, fill: K.i500 } }, sub));
  const road = (d, k) => h('g', { key: k }, h('path', { d, fill: 'none', stroke: K.i050, strokeWidth: 30, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    h('path', { d, fill: 'none', stroke: K.i200, strokeWidth: 1, strokeDasharray: '6 6' }));
  const svg = h('svg', { ref: svgRef, viewBox: mini ? vbT.current.join(' ') : '0 0 1280 870', preserveAspectRatio: 'xMidYMid slice', style: mini ? { width: '100%', height: '100%', display: 'block' } : { width: '100%', height: 'auto', display: 'block', overflow: 'visible' } },
    cap(20, 24, 'INFLOW'), cap(585, 24, 'PROCESSING · WEIGHBRIDGE · CCTV', 'middle'), cap(OX - 26, 24, 'OUTWARD FRACTIONS'),
    ROAD_D.map(road),
    FAN.map((p, i) => h('path', { key: 'fo' + i, d: dOf(p), fill: 'none', stroke: K.i050, strokeWidth: 14, strokeLinecap: 'round' })),
    FAN.map((p, i) => h('path', { key: 'fl' + i, d: dOf(p), fill: 'none', stroke: K.i200, strokeWidth: 1, strokeDasharray: '2 6' })),
    h(Landfill), lbl(20, 268, 'Legacy landfills', 'Surveyed, mined, reclaimed'),
    h('g', { transform: 'translate(0,234)' }, h(Houses)), lbl(20, 772, 'Household waste', 'Collected door to door'),
    h(LegacyPlant),
    h('g', { transform: 'translate(0,170)' }, h(HouseholdPlant)),
    tag(614, 212, 'TROMMEL'), tag(625, 614, 'MANUAL PICKING'), tag(477, 664, 'TROMMEL'),
    tag(664, 325, 'SOIL & FINES', K.g800), tag(564, 325, 'STONES & INERTS', K.i700), tag(496, 325, 'RDF', K.amber),
    tag(664, 760, 'BIO WASTE', K.red), tag(630, 771, 'PLASTICS', K.sky), tag(596, 760, 'METALS', K.i700), tag(562, 771, 'MLP', K.amber),
    tag(506, 785, 'COMPOST', K.g700), tag(447, 785, 'INERTS', K.i700), tag(388, 785, 'RDF', K.amber),
    lbl(476, 166, 'Legacy line', 'Excavated waste, trommel screened'),
    lbl(372, 838, 'Household line', 'Hand-picked, then trommel screened'),
    h('g', { transform: 'translate(0,120)' }, h(SiteOffice, { refs })),
    h('g', { transform: 'translate(428,' + MR + ')' },
      h('rect', { x: -7, y: 14, width: 14, height: 14, rx: 2, fill: K.i900 }),
      h('rect', { x: -4, y: -27, width: 8, height: 8, rx: 2, fill: K.i500 }),
      h('g', { ref: barRef },
        h('line', { x1: 0, y1: 21, x2: 0, y2: -22, stroke: '#fff', strokeWidth: 5, strokeLinecap: 'round' }),
        h('line', { x1: 0, y1: 15, x2: 0, y2: -22, stroke: K.red, strokeWidth: 5, strokeDasharray: '6 6' }),
        h('line', { x1: 0, y1: 21, x2: 0, y2: -22, stroke: K.i700, strokeWidth: 0.6, strokeOpacity: 0.5 })),
      h('circle', { cx: 0, cy: 21, r: 3, fill: K.i500 }),
      h('text', { x: 0, y: 44, textAnchor: 'middle', style: { fontFamily: SERIF, fontSize: 9, letterSpacing: '0.14em', fill: K.i500 } }, 'BOOM BARRIER')),
    [[815, 296, 308], [815, 756, 768]].map((q, i) => h('g', { key: 'tip' + i, ref: el => tipEls.current[i] = el, opacity: 0 }, h(Fall, { x0: q[0] - 7, x1: q[0] + 7, y0: q[1], y1: q[2], n: 8, c: MIXC, r: 2.4, dur: 0.5, seed: 5 + i }))),
    AGENTS.map((ag, i) => h('g', { key: 't' + i, ref: el => truckEls.current[i] = el, opacity: 0 },
      h('g', { ref: el => topEls.current[i] = el, opacity: 0 }, TOPTRUCK([K.i500, K.g600, K.g700, K.g700][i], el => { (loadEls.current[i] = loadEls.current[i] || [])[0] = el; })),
      h('g', { ref: el => sideEls.current[i] = el }, i < 2 ? h(TRUCKS[i]) : SIDETRUCK_OUT(el => { (loadEls.current[i] = loadEls.current[i] || [])[1] = el; })))),
    Array.from({ length: POOL }, (_, i) => h('circle', { key: 'd' + i, ref: el => dots.current[i] = el, r: 3.4, opacity: 0 })),
    OUT.map((o, i) => h('g', { key: 'o' + i },
      h('g', { transform: 'translate(' + OX + ',' + o.y + ')' }, h(FractionIcon, { i })),
      h('text', { x: OX + 42, y: o.y - 2, style: { fontFamily: SERIF, fontSize: 18, fill: K.i900 } }, o.label),
      h('text', { x: OX + 42, y: o.y + 18, style: { fontFamily: MONO, fontSize: 12, fill: K.i500 } }, o.share + ' of outflow'),
      (o.cr || []).map((t, j) => { const w = t.length * 6.2 + 16, x0 = OX + 42 + (j ? (o.cr[0].length * 6.2 + 22) : 0), epr = t[0] === 'E', hz = t[0] === 'S';
        return h('g', { key: 'cr' + j }, h('rect', { x: x0, y: o.y + 27, width: w, height: 18, rx: 9, fill: hz ? '#FBE9E6' : epr ? '#E7F3FA' : K.g100 }),
          h('text', { x: x0 + w / 2, y: o.y + 39.5, textAnchor: 'middle', style: { fontFamily: SERIF, fontSize: 10.5, fontWeight: 700, fill: hz ? K.red : epr ? K.sky : K.g700 } }, t)); }))),
    mini ? null : HOT.map((q, i) => h('rect', { key: 'hs' + i, x: q.x, y: q.y, width: q.w, height: q.h, rx: 10, fill: tip === i ? 'rgba(15,161,78,0.06)' : 'rgba(0,0,0,0)', stroke: tip === i ? K.g600 : 'none', strokeDasharray: '4 4', style: { cursor: 'help', pointerEvents: 'all' },
      onPointerEnter: e => { if (e.pointerType === 'mouse') setTip(i); }, onPointerLeave: e => { if (e.pointerType === 'mouse') setTip(t => t === i ? null : t); },
      onClick: e => setTip(t => (t === i && e.nativeEvent.pointerType !== 'mouse') ? null : i) })));
  const tq = tip !== null ? HOT[tip] : null, below = tq && tq.y < 260;
  const tipBox = tq ? h('div', { style: { position: 'absolute', left: Math.max(14, Math.min(86, (tq.x + tq.w / 2) / 12.8)) + '%', top: ((below ? tq.y + tq.h : tq.y) / 8.7) + '%', transform: below ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 10px))', width: 'min(280px, 80%)', boxSizing: 'border-box', padding: '14px 16px', borderRadius: 16, background: '#fff', border: '1px solid ' + K.i100, boxShadow: 'var(--shadow-card)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 } },
    h('span', { style: { fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: K.g700 } }, tq.t),
    h('span', { style: { fontSize: 16, lineHeight: 1.45, color: K.i700, textWrap: 'pretty' } }, tq.d)) : null;

  const stat = (label, ref, unit, color, sub) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 16, borderTop: '1px solid ' + K.i100 } },
    h('span', { style: { fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: K.i500 } }, chem(label)),
    h('span', { style: { fontSize: 'clamp(26px,2.6vw,36px)', letterSpacing: '-0.02em', color, fontVariantNumeric: 'tabular-nums' } }, h('span', { ref }, '—'), h('span', { style: { fontSize: '0.5em', color: K.i500, marginLeft: 6 } }, chem(unit))),
    sub ? h('span', { style: { fontSize: 15, color: K.i500 } }, sub) : null);
  if (mini) return svg;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 24 } },
    h('div', { style: { fontSize: 15, color: K.i500, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, h('span', { style: { width: 8, height: 8, borderRadius: 4, background: K.g600 } }), (CAN_HOVER ? 'Hover any part of the site to learn more.' : 'Swipe across the site, and tap any part to learn more.'),
      h('span', { className: 'illustrative', style: { marginLeft: 'auto' } }, 'Illustrative figures')),
    h('div', { className: 'flow-scroll' }, h('div', { className: 'flow-inner' }, svg, tipBox)),
    showCounters ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,128px),1fr))', gap: 24 } },
      stat('Weighed in', refIn, 'MT', K.i900), stat('Dispatched', refOut, 'MT', K.i900),
      stat('Methane avoided', refCh4, 'MT CH₄', K.g700), stat('CO₂e avoided', refCo, 'MT', K.g700, 'Carbon credit potential'),
      stat('EPR eligible', refEpr, 'MT', K.sky, 'Plastics and RDF')) : null);
}

/* ---------- Mass balance ---------- */
const FR = [ { n: 'Compost', p: 60, c: K.g600 }, { n: 'Recycled plastics', p: 5, c: K.sky }, { n: 'RDF', p: 12, c: K.amber },
             { n: 'Glass and inerts', p: 12, c: K.i500 }, { n: 'Bio waste (hazardous)', p: 6, c: 'var(--red-100)', ring: K.red }, { n: 'Metals', p: 3, c: K.i700 }, { n: 'Unaccounted', p: 2, c: K.red } ];
function BalanceViz() {
  const [ref, v] = useInView(0.4);
  const row = (label, val, bar) => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) 1fr', gap: 20, alignItems: 'center' } },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h('span', { style: { fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: K.i500 } }, chem(label)),
      h('span', { style: { fontSize: 22, color: K.i900, letterSpacing: '-0.01em' } }, val)), bar);
  let acc = 0;
  return h('div', { ref, style: { display: 'flex', flexDirection: 'column', gap: 28 } },
    row('Inbound', '1,284.6 MT', h('div', { style: { height: 56, borderRadius: 14, background: K.i100, overflow: 'hidden' } },
      h('div', { style: { height: '100%', width: v ? '100%' : '0%', background: K.i900, borderRadius: 14, transition: `width 1.2s ${EASE}` } }))),
    row('Outbound', '1,258.9 MT', h('div', { style: { height: 56, borderRadius: 14, background: K.i050, position: 'relative', overflow: 'hidden' } },
      FR.map((f, i) => { const left = acc; acc += f.p;
        return h('div', { key: i, title: f.n, style: { position: 'absolute', top: 0, bottom: 0, left: left + '%', width: v ? f.p + '%' : '0%', background: f.c,
          borderRight: '2px solid #fff', boxShadow: f.ring ? 'inset 0 0 0 1.5px ' + f.ring : 'none', transition: `width .9s ${EASE} ${1.1 + i * 0.18}s` } }); }))),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) 1fr', gap: 20 } }, h('span'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px 28px' } },
        FR.map((f, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, color: K.i700, opacity: v ? 1 : 0, transition: `opacity .5s ${1.3 + i * 0.18}s` } },
          h('span', { style: { width: 10, height: 10, borderRadius: 99, background: f.c, boxShadow: f.ring ? 'inset 0 0 0 1.5px ' + f.ring : 'none' } }), f.n, h('span', { style: { fontFamily: MONO, fontSize: 13, color: K.i500 } }, f.p + '%'))))),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(90px,140px) 1fr', gap: 20 } }, h('span'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 14, background: 'var(--red-100)', color: K.red, fontSize: 15,
        opacity: v ? 1 : 0, transform: v ? 'none' : 'translateY(8px)', transition: `all .6s ${EASE} 2.6s`, alignSelf: 'flex-start', justifySelf: 'start' } },
        h('strong', null, '25.7 MT unaccounted'), h('span', { style: { color: K.i700 } }, 'Flagged for reconciliation at weighbridge 2.'))));
}

/* ---------- Forecast chart ---------- */
const ACT = [262,280,271,295,301,288,276,298,310,305,292,318,322,312];
const FC = [312,336,342,328,351,358,346];
function ForecastViz() {
  const [ref, v] = useInView(0.4);
  const W = 640, Hh = 240, n = ACT.length + FC.length - 1;
  const px = i => 36 + i / n * (W - 52), py = val => Hh - 28 - (val - 240) / 140 * (Hh - 48);
  const a = ACT.map((val, i) => [px(i), py(val)]), f = FC.map((val, i) => [px(i + ACT.length - 1), py(val)]);
  const band = f.map((p, i) => [p[0], p[1] - 6 - i * 4]).concat(f.slice().reverse().map((p, i) => [p[0], p[1] + 6 + (f.length - 1 - i) * 4]));
  return h('svg', { ref, viewBox: `0 0 ${W} ${Hh}`, style: { width: '100%', height: 'auto', display: 'block' } },
    [260, 300, 340].map(t => h('g', { key: t }, h('line', { x1: 36, x2: W - 16, y1: py(t), y2: py(t), stroke: K.i100 }),
      h('text', { x: 28, y: py(t) + 4, textAnchor: 'end', style: { fontFamily: MONO, fontSize: 10, fill: K.i500 } }, t))),
    h('line', { x1: px(ACT.length - 1), x2: px(ACT.length - 1), y1: 12, y2: Hh - 24, stroke: K.i200, strokeDasharray: '3 4' }),
    h('text', { x: px(ACT.length - 1) + 6, y: 20, style: { fontFamily: MONO, fontSize: 10, fill: K.i500 } }, 'TODAY'),
    h('polygon', { points: band.map(p => p.join(',')).join(' '), fill: 'var(--sky-100)', style: { opacity: v ? 1 : 0, transition: 'opacity .8s 1.6s' } }),
    h('path', { d: smooth(a), fill: 'none', stroke: K.g600, strokeWidth: 2.5, pathLength: 1, strokeDasharray: 1, style: { strokeDashoffset: v ? 0 : 1, transition: `stroke-dashoffset 1.6s ${EASE}` } }),
    h('path', { d: smooth(f), fill: 'none', stroke: K.sky, strokeWidth: 2.5, strokeDasharray: '5 5', style: { opacity: v ? 1 : 0, transition: 'opacity .8s 1.4s' } }),
    h('circle', { cx: a[a.length - 1][0], cy: a[a.length - 1][1], r: 5, fill: K.g600, style: { opacity: v ? 1 : 0, transition: 'opacity .3s 1.5s' } }),
    h('text', { x: 36, y: Hh - 6, style: { fontFamily: MONO, fontSize: 10, fill: K.i500 } }, '14 DAYS AGO'),
    h('text', { x: W - 16, y: Hh - 6, textAnchor: 'end', style: { fontFamily: MONO, fontSize: 10, fill: K.sky } }, '+7 DAY FORECAST'));
}

/* ---------- Legacy landfill: seven-step animation ---------- */
const LG_DUR = 6;
const HP = [[40,320],[80,262],[115,240],[140,206],[175,188],[215,160],[255,146],[300,140],[340,134],[380,160],[420,188],[460,212],[500,258],[530,292],[560,320]];
const HEAP_D = smooth(HP) + ' Z';
function heapTop(x) { for (let i = 0; i < HP.length - 1; i++) { const a = HP[i], b = HP[i + 1]; if (x >= a[0] && x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 320; }
const RAMP = [K.g100, K.g200, K.g400, K.g600, K.g800];
const DSM_PTS = (() => { const r = rng(7), o = []; for (let x = 46; x < 556; x += 10) { const top = heapTop(x); for (let y = top + 4; y < 318; y += 10) o.push([x + r() * 4 - 2, y + r() * 4 - 2, r()]); } return o; })();
const cl = x => Math.max(0, Math.min(1, x));
const N = n => Math.round(n).toLocaleString('en-US');
const SG = 'translate(0,121.6) scale(.62)';
const tx = (x, y, s, o) => h('text', { x, y, style: Object.assign({ fontFamily: MONO, fontSize: 11, fill: K.i700 }, o) }, s);
const caps = (x, y, s, o) => tx(x, y, s.toUpperCase(), Object.assign({ fontFamily: SERIF, fontSize: 10, letterSpacing: '0.14em', fill: K.i500 }, o));
const big = (x, y, s, o) => h('text', { x, y, style: Object.assign({ fontFamily: SERIF, fontSize: 22, fill: K.i900, letterSpacing: '-0.015em' }, o) }, s);
const heap = (fill) => h('path', { d: HEAP_D, fill: fill || K.i200, stroke: K.i500, strokeWidth: 1.4, strokeLinejoin: 'round' });
const ground = () => h('line', { x1: 0, x2: 640, y1: 320, y2: 320, stroke: K.i300 });
const strip = (items, y) => items.map((it, i) => h('g', { key: 's' + i, transform: 'translate(' + (24 + i * 205) + ',' + (y || 352) + ')' }, caps(0, 0, it[0]), big(0, 26, it[1])));
function along(pts, q) {
  const L = []; let tot = 0; for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); L.push(d); tot += d; }
  let d = q * tot; const vis = [pts[0]];
  for (let i = 0; i < L.length; i++) { if (d <= L[i]) { const f = d / L[i], p = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; vis.push(p); return [p, vis]; } d -= L[i]; vis.push(pts[i + 1]); }
  return [pts[pts.length - 1], vis];
}
const drone = (x, y) => h('g', { transform: 'translate(' + x + ',' + y + ')' },
  h('line', Object.assign({ x1: -16, x2: 16, y1: 0, y2: 0 }, ST(K.i900, 2))),
  h('ellipse', { cx: -16, cy: -3, rx: 8, ry: 1.6, fill: K.i500 }), h('ellipse', { cx: 16, cy: -3, rx: 8, ry: 1.6, fill: K.i500 }),
  h('rect', { x: -7, y: -4, width: 14, height: 8, rx: 3, fill: K.g700 }), h('circle', { cx: 0, cy: 6, r: 2.4, fill: K.i900 }));
const panelRow = (y, label, value, show) => h('g', { key: label, transform: 'translate(0,' + y + ')', style: { opacity: show, transition: 'opacity 400ms ' + EASE } }, caps(0, 0, label), big(0, 26, value));

function SceneDrone(t) {
  const q = cl(t / 5.4), pts = [[70,60],[570,60],[570,84],[70,84],[70,108],[570,108]];
  const [p, vis] = along(pts, q), bx = p[0];
  const gcps = [60, 180, 330, 470, 556];
  return [ground(), heap(),
    h('path', { key: 'beam', d: 'M' + bx + ' ' + (p[1] + 8) + ' L' + (bx - 34) + ' ' + heapTop(bx - 34) + ' L' + (bx + 34) + ' ' + heapTop(bx + 34) + ' Z', fill: K.g300, opacity: 0.22 }),
    h('polyline', { key: 'trail', points: vis.map(v => v.join(',')).join(' '), fill: 'none', stroke: K.g600, strokeWidth: 1.4, strokeDasharray: '4 4' }),
    gcps.map((x, i) => { const y = heapTop(x) - 2, on = q > i / gcps.length; return h('g', { key: 'g' + i, transform: 'translate(' + x + ',' + y + ')', style: { opacity: on ? 1 : 0.15, transition: 'opacity 300ms' } },
      h('rect', { x: -5, y: -5, width: 10, height: 10, fill: '#fff', stroke: K.i900, strokeWidth: 1.2, transform: 'rotate(45)' }), h('circle', { r: 1.8, fill: K.red })); }),
    drone(bx, p[1]),
    strip([['Images captured', N(412 * q)], ['Flight altitude', '120 m AGL'], ['Ground control', Math.min(5, Math.ceil(q * 5)) + ' / 5 points']])];
}
function SceneDSM(t) {
  const p = cl(t / 4.6), pb = ease(cl((p - 0.45) / 0.5));
  return [ground(), h('path', { key: 'hs', d: HEAP_D, fill: K.i100, stroke: K.i300, strokeWidth: 1 }),
    h('g', { key: 'bands', clipPath: 'url(#lg-clip)', opacity: pb }, RAMP.map((c, k) => h('rect', { key: k, x: 0, y: 320 - (k + 1) * 37, width: 640, height: 37, fill: c })),
      [1, 2, 3, 4].map(k => h('line', { key: 'c' + k, x1: 0, x2: 640, y1: 320 - k * 37, y2: 320 - k * 37, stroke: '#fff', strokeWidth: 1, opacity: 0.7 }))),
    h('g', { key: 'pts', opacity: 1 - pb * 0.7 }, DSM_PTS.map((d, i) => d[2] < p * 1.25 ? h('circle', { key: i, cx: d[0], cy: d[1], r: 1.4, fill: RAMP[Math.min(4, Math.floor((320 - d[1]) / 37))] === K.g100 ? K.g400 : RAMP[Math.min(4, Math.floor((320 - d[1]) / 37))] }) : null)),
    h('path', { key: 'hl', d: HEAP_D, fill: 'none', stroke: K.i700, strokeWidth: 1.2, opacity: pb }),
    h('g', { key: 'leg', transform: 'translate(598,135)', opacity: pb }, RAMP.slice().reverse().map((c, k) => h('rect', { key: k, x: 0, y: k * 37, width: 10, height: 37, fill: c })),
      tx(16, 8, '+42 m', { fontSize: 10 }), tx(16, 185, '0 m', { fontSize: 10 })),
    strip([['Point cloud', (p * 18.4).toFixed(1) + ' M pts'], ['Resolution', '5 cm / px'], ['Peak elevation', '+' + (pb * 42).toFixed(1) + ' m']])];
}
function SceneQuant(t) {
  const e = ease(cl(t / 4.4)), PIT = 'M40 320 C150 344 450 344 560 320 Z';
  return [h('path', { key: 'pit', d: PIT, fill: K.i300 }), heap(),
    h('defs', { key: 'df' }, h('pattern', { id: 'lg-hatch', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, h('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: K.g700, strokeWidth: 3 })),
      h('clipPath', { id: 'lg-clip2' }, h('path', { d: HEAP_D }), h('path', { d: PIT }))),
    h('g', { key: 'fill', clipPath: 'url(#lg-clip2)' }, h('rect', { x: 40, y: 120, width: 520 * e, height: 240, fill: 'url(#lg-hatch)', opacity: 0.45 })),
    h('line', { key: 'sw', x1: 40 + 520 * e, x2: 40 + 520 * e, y1: 110, y2: 338, stroke: K.g600, strokeWidth: 1.5, opacity: e < 1 ? 1 : 0 }),
    h('path', { key: 'dtm', d: 'M0 320 L40 320 C150 344 450 344 560 320 L640 320', fill: 'none', stroke: K.i900, strokeWidth: 1.2, strokeDasharray: '5 4' }),
    tx(352, 124, 'DSM surface', { fontSize: 10 }), tx(8, 312, 'Original ground', { fontSize: 10 }),
    strip([['Volume', N(1240000 * e) + ' m³'], ['Bulk density', '0.85 MT / m³'], ['Waste in place', N(1054000 * e) + ' MT']])];
}
const COMP = [['Soil-like fines', 52, K.g400], ['Combustibles / RDF', 24, K.amber], ['Inerts and C&D', 16, K.i300], ['Plastics', 6, K.sky], ['Metals', 2, K.i700]];
function SceneComp(t) {
  const pits = [140, 300, 420], eb = ease(cl((t - 1.6) / 2.6)); let acc = 0;
  return [ground(), h('g', { key: 'hp', transform: SG }, heap(),
      pits.map((x, i) => { const on = cl((t - i * 0.45) / 0.4); return h('g', { key: i, style: { opacity: on } },
        h('rect', { x: x - 7, y: heapTop(x), width: 14, height: 70 * on, fill: K.i700 }),
        tx(x - 20, heapTop(x) - 12, 'TP-0' + (i + 1), { fontSize: 16, fill: K.i900 })); })),
    h('g', { key: 'pn', transform: 'translate(384,46)' }, caps(0, 0, 'Composition by weight'),
      h('rect', { x: 0, y: 14, width: 232, height: 12, rx: 6, fill: K.i100 }),
      COMP.map((c, i) => { const w = 232 * c[1] / 100 * eb, x = acc; acc += w; return h('rect', { key: 'b' + i, x, y: 14, width: w, height: 12, fill: c[2] }); }),
      COMP.map((c, i) => h('g', { key: 'r' + i, transform: 'translate(0,' + (54 + i * 24) + ')', style: { opacity: cl((t - 1.6 - i * 0.3) / 0.4) } },
        h('rect', { x: 0, y: -9, width: 10, height: 10, rx: 2, fill: c[2] }), tx(18, 0, c[0], { fontFamily: SERIF, fontSize: 14, fill: K.i900 }), tx(232, 0, c[1] + '%', { textAnchor: 'end', fontSize: 12 }))),
      h('line', { x1: 0, x2: 232, y1: 176, y2: 176, stroke: K.i100 }),
      h('g', { style: { opacity: cl((t - 3.6) / 0.5) } }, caps(0, 200, 'Moisture'), big(0, 226, '28%'), caps(120, 200, 'Calorific value'), big(120, 226, '1,900 kcal/kg', { fontSize: 18 })))];
}
function SceneBase(t) {
  const plumes = [175, 300, 420].map(x => [x * 0.62, heapTop(x) * 0.62 + 121.6]);
  const rows = [['Methane, surface', '48% v/v'], ['Leachate COD', '12,400 mg/L'], ['Groundwater TDS', '1,850 mg/L'], ['Ambient PM10', '94 µg/m³']];
  return [h('rect', { key: 'aq', x: 0, y: 362, width: 640, height: 38, fill: K.sky, opacity: 0.1 }),
    h('path', { key: 'wt', d: 'M0 362 C40 358 80 366 120 362 C160 358 200 366 240 362 C280 358 320 366 360 362', fill: 'none', stroke: K.sky, strokeWidth: 1.6 }),
    tx(250, 388, 'Water table', { fontSize: 10, fill: K.sky }),
    ground(), h('g', { key: 'hp', transform: SG }, heap()),
    plumes.map((p, i) => h('g', { key: 'pl' + i }, h('line', { x1: p[0], x2: p[0], y1: p[1], y2: p[1] - 10, stroke: K.i900, strokeWidth: 2 }),
      A(p[0], p[1] - 12, anim('ta-rise', 3.6, i * 1.1, 'ease-out'), h('path', Object.assign({ d: 'M0 0 c-4 -6 4 -10 0 -16', fill: 'none' }, ST(K.amber, 1.8)))))),
    tx(plumes[1][0] - 10, plumes[1][1] - 52, 'CH₄', { fontSize: 11, fill: K.amber }),
    [70, 150, 230].map((x, i) => { const f = (t * 0.55 + i * 0.33) % 1; return h('path', { key: 'd' + i, d: 'M0 -4 C2 -1 3 1 0 3 C-3 1 -2 -1 0 -4 Z', transform: 'translate(' + x + ',' + (324 + f * 36) + ')', fill: K.amber, opacity: 1 - f }); }),
    h('g', { key: 'well' }, h('rect', { x: 340, y: 296, width: 6, height: 84, fill: K.i500 }), h('rect', { x: 336, y: 290, width: 14, height: 8, rx: 2, fill: K.i900 }), tx(318, 282, 'Well MW-1', { fontSize: 10 })),
    h('g', { key: 'pn', transform: 'translate(400,40)' }, rows.map((r, i) => panelRow(i * 56, r[0], r[1], cl((t - 0.4 - i * 0.6) / 0.5))),
      h('g', { style: { opacity: cl((t - 3.2) / 0.5) } }, h('rect', { x: 0, y: 222, width: 172, height: 26, rx: 13, fill: K.g100 }), tx(14, 239, 'Day 0 · before reclamation', { fontFamily: SERIF, fontSize: 12, fill: K.g800 })))];
}
function SceneTrack(t) {
  const c = (t % 3) / 3, trip = Math.floor(t / 3), r = rng(trip + 11); r();
  const x = c < 0.35 ? 286 + 128 * ease(c / 0.35) : c < 0.62 ? 414 : 414 + 82 * ease((c - 0.62) / 0.38);
  const op = c > 0.9 ? (1 - c) / 0.1 : 1, wt = (11 + r() * 6).toFixed(1);
  const onBridge = c >= 0.38 && c < 0.62;
  return [ground(), h('g', { key: 'hp', transform: 'translate(-10,160) scale(.5)' }, heap()),
    h('g', { key: 'ex', transform: 'translate(262,320) scale(-1,1)' }, h('rect', { x: -18, y: -8, width: 40, height: 8, rx: 4, fill: K.i900 }),
      h('rect', { x: -14, y: -26, width: 30, height: 18, rx: 3, fill: K.g600 }), h('rect', { x: -2, y: -23, width: 10, height: 8, rx: 1.5, fill: '#fff' }),
      A(16, -20, anim('ta-dig', 3.2), h('path', Object.assign({ d: 'M0 0 L22 -16', fill: 'none' }, ST(K.i700, 4))), h('path', Object.assign({ d: 'M22 -16 L34 2', fill: 'none' }, ST(K.i700, 3))), h('path', { d: 'M31 0 L41 5 L33 12 Z', fill: K.i700 }))),
    h('rect', { key: 'deck', x: 380, y: 318, width: 72, height: 5, rx: 1, fill: K.i500 }),
    h('line', { key: 'dp', x1: 416, x2: 416, y1: 276, y2: 318, stroke: K.i500, strokeWidth: 2 }),
    h('rect', { key: 'disp', x: 388, y: 252, width: 56, height: 24, rx: 4, fill: K.i900 }),
    tx(416, 268, onBridge ? wt + ' MT' : '— —', { textAnchor: 'middle', fill: K.g300, fontSize: 12 }),
    h('g', { key: 'cam' }, h('line', { x1: 466, x2: 466, y1: 256, y2: 320, stroke: K.i500, strokeWidth: 2 }),
      A(466, 258, anim('ta-cam', 4), h('rect', { x: -2, y: -5, width: 16, height: 9, rx: 2, fill: K.i700 }), h('circle', { cx: 14, cy: 0, r: 2, fill: K.red }))),
    h('g', { key: 'tr', transform: 'translate(' + x + ',320)', opacity: op }, TRUCKS[0]()),
    h('path', { key: 'hop', d: 'M500 246 L532 246 L524 266 L508 266 Z', fill: K.i500 }),
    h('g', { key: 'drum', transform: 'translate(568,270) rotate(-8)' }, h('rect', { x: -46, y: -15, width: 92, height: 30, rx: 8, fill: K.g700 }),
      [-28, -8, 12, 32].map(k => h('line', { key: k, x1: k, x2: k, y1: -15, y2: 15, stroke: K.g400, strokeWidth: 1.5 })),
      A(-46, 0, anim('ta-spin', 2, 0, 'linear'), h('line', { x1: 0, y1: -10, x2: 0, y2: 10, stroke: '#fff', strokeWidth: 1.5 }))),
    [[528, 320], [610, 320]].map((l, i) => h('line', { key: 'lg' + i, x1: l[0], x2: l[0], y1: 282 - i * 10, y2: l[1], stroke: K.i500, strokeWidth: 2 })),
    [[548, K.g400], [578, K.amber], [606, K.i300]].map((p, i) => { const hh = 8 + cl(t / LG_DUR) * 10; return h('path', { key: 'pi' + i, d: 'M' + (p[0] - 12) + ' 320 Q' + p[0] + ' ' + (320 - hh * 2) + ' ' + (p[0] + 12) + ' 320 Z', fill: p[1] }); }),
    strip([['Trips today', String(128 + trip)], ['Last load', wt + ' MT'], ['Route', 'C-04 → Trommel 2']], 64), h('line', { key: 'sep', x1: 24, x2: 616, y1: 116, y2: 116, stroke: K.i100 }), tx(24, 150, 'Every load weighed, seen on camera, and logged against its source cell.', { fontFamily: SERIF, fontSize: 14, fill: K.i500 })];
}
function SceneAudit(t) {
  const e = ease(cl(t / 4.2)), ok = cl((t - 4.3) / 0.5);
  const fr = [[0.52, K.g400], [0.24, K.amber], [0.16, K.i300], [0.06, K.sky], [0.012, K.i700]]; let acc = 0;
  return [ground(), h('g', { key: 'hp', transform: SG },
      h('g', { transform: 'translate(0,320) scale(1,' + (1 - 0.85 * e) + ') translate(0,-320)' }, heap()),
      h('path', { d: HEAP_D, fill: 'none', stroke: K.i500, strokeWidth: 1.6, strokeDasharray: '6 5' }),
      h('line', { x1: 40, x2: 560, y1: 320, y2: 320, stroke: K.g400, strokeWidth: 5, opacity: ok })),
    tx(150, 196, 'Survey 01', { fontSize: 10 }), tx(150, 300, 'Survey 06', { fontSize: 10, opacity: e }),
    h('g', { key: 'pn', transform: 'translate(384,46)' },
      caps(0, 0, 'Quantified in place'), big(0, 26, '1,054,000 MT'), h('rect', { x: 0, y: 38, width: 232, height: 10, rx: 5, fill: K.i300 }),
      caps(0, 84, 'Recovered and routed'), big(0, 110, N(1045600 * e) + ' MT'), h('rect', { x: 0, y: 122, width: 232, height: 10, rx: 5, fill: K.i100 }),
      fr.map((f, i) => { const w = 232 * f[0] * e, x = acc; acc += w; return h('rect', { key: i, x, y: 122, width: w, height: 10, fill: f[1] }); }),
      caps(0, 168, 'Unaccounted'), big(0, 194, (0.8 + 99.2 * (1 - e)).toFixed(1) + '%'),
      h('g', { style: { opacity: ok } }, h('rect', { x: 0, y: 214, width: 116, height: 28, rx: 14, fill: K.g600 }),
        h('path', Object.assign({ d: 'M14 228 l5 5 l9 -10', fill: 'none' }, ST('#fff', 2))), tx(36, 233, 'Reconciled', { fontFamily: SERIF, fontSize: 13, fill: '#fff' })))];
}
const SCENES = [SceneDrone, SceneDSM, SceneQuant, SceneComp, SceneBase, SceneTrack, SceneAudit];
function LegacyViz({ step, onNext, halted }) {
  const [t, setT] = React.useState(0);
  const next = React.useRef(onNext); next.current = onNext;
  const hz = React.useRef(halted); hz.current = halted;
  React.useEffect(() => {
    setT(0);
    let raf, last = performance.now(), e = 0, done = false;
    const tick = now => { const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!hz.current) { e += dt; setT(e); }
      if (e > LG_DUR && !done) { done = true; next.current(); return; }
      raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [step]);
  return h('div', { style: { borderRadius: 24, border: '1px solid ' + K.i100, padding: 20, background: '#fff', boxShadow: 'var(--shadow-card)' } },
    h('svg', { role: 'img', 'aria-label': 'Step ' + (step + 1) + ' of 7: ' + LEGACY[step].label, viewBox: '0 0 640 400', style: { width: '100%', height: 'auto', display: 'block' } },
      h('defs', null, h('clipPath', { id: 'lg-clip' }, h('path', { d: HEAP_D }))),
      h('g', { key: step, style: { animation: 'lg-in 500ms ' + EASE } }, SCENES[step](t))),
    h('div', { style: { display: 'flex', gap: 6, marginTop: 14 } }, SCENES.map((_, i) => h('div', { key: i, style: { flex: 1, height: 3, borderRadius: 2, background: K.i100, overflow: 'hidden' } },
      h('div', { style: { height: '100%', background: K.g600, width: (i < step ? 100 : i === step ? cl(t / LG_DUR) * 100 : 0) + '%' } })))));
}

const SCAT = [K.sky, K.amber, K.i500, K.g600, K.i300, K.g400, K.i700, K.red];
const WORDS = [{ w: 'Recovery.', m: 'recover' }, { w: 'Processing.', m: 'process' }, { w: 'Sorting.', m: 'sort' }, { w: 'Reclaiming.', m: 'reclaim' }, { w: 'Remediating.', m: 'remediate' }];
const SORTC = [K.sky, K.amber, K.g600, K.i500];
function ScatterWord() {
  if (REDUCED) return h('span', null, 'Recovery.');
  const [st, setSt] = React.useState({ wi: 0, ph: 'pre' });
  const refs = React.useRef([]), [lefts, setLefts] = React.useState({});
  React.useEffect(() => {
    const tms = []; let alive = true;
    const run = (wi) => { if (!alive) return; setSt({ wi, ph: 'pre' });
      tms.push(setTimeout(() => setSt({ wi, ph: 'a' }), 60), setTimeout(() => setSt({ wi, ph: 'on' }), 850),
        setTimeout(() => setSt({ wi, ph: 'out' }), 4600), setTimeout(() => run((wi + 1) % WORDS.length), 5500)); };
    run(0); return () => { alive = false; tms.forEach(clearTimeout); };
  }, []);
  const { wi, ph } = st, W = WORDS[wi], w = W.w, m = W.m, n = w.length, R = rng(wi * 37 + 11);
  React.useLayoutEffect(() => { if (m === 'sort' && ph === 'pre') setLefts({ wi, l: refs.current.slice(0, n).map(e => e ? e.offsetLeft : 0) }); }, [wi, ph]);
  const perm = (() => { const p = [...Array(n).keys()], r2 = rng(wi * 13 + 5); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r2() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return p; })();
  const L = lefts.wi === wi ? lefts.l : null;
  const vis = ph === 'a' || ph === 'on', on = ph === 'on';
  const letter = (ch, i) => {
    const rx = (R() - 0.5) * 5, ry = (R() - 0.5) * 1.6, rr = (R() - 0.5) * 240, c = SCAT[Math.floor(R() * SCAT.length)], ox = (R() - 0.5) * 6, oy = 0.6 + R() * 0.8;
    let st2 = { display: 'inline-block', willChange: 'transform' };
    if (m === 'recover') {
      const d = i * 55;
      st2.transform = on ? 'none' : ph === 'out' ? 'translate(' + ox.toFixed(2) + 'em,' + oy.toFixed(2) + 'em) rotate(' + (rr * 0.7).toFixed(0) + 'deg) scale(0.4)' : 'translate(' + rx.toFixed(2) + 'em,' + ry.toFixed(2) + 'em) rotate(' + rr.toFixed(0) + 'deg) scale(0.55)';
      st2.color = on ? K.i900 : c; st2.opacity = vis ? 1 : 0;
      st2.transition = ph === 'pre' ? 'none' : ph === 'a' ? 'opacity 400ms ease ' + d * 0.4 + 'ms' : on ? 'transform 1100ms ' + EASE + ' ' + d + 'ms, color 700ms ease ' + (d + 650) + 'ms' : 'transform 800ms cubic-bezier(0.55,0,0.8,0.4) ' + d * 0.6 + 'ms, opacity 600ms ease ' + (d * 0.6 + 200) + 'ms';
    } else if (m === 'process') {
      const d = 250 + i * 85;
      st2.transform = on ? 'none' : ph === 'out' ? 'translateY(0.9em) scaleY(0.6)' : 'translate(' + (rx * 0.12).toFixed(2) + 'em,-1.25em) rotate(' + (rr * 0.15).toFixed(0) + 'deg)';
      st2.color = on ? K.i900 : c; st2.opacity = vis ? 1 : 0;
      st2.transition = ph === 'pre' ? 'none' : ph === 'a' ? 'opacity 300ms ease ' + i * 30 + 'ms' : on ? 'transform 900ms cubic-bezier(0.34,1.45,0.64,1) ' + d + 'ms, color 600ms ease ' + (d + 700) + 'ms' : 'transform 700ms ease-in ' + i * 40 + 'ms, opacity 500ms ease ' + (i * 40 + 200) + 'ms';
    } else if (m === 'sort') {
      const dx = L ? L[perm[i]] - L[i] : 0, d = 200 + i * 70;
      st2.transform = on ? 'none' : ph === 'out' ? 'translateY(-0.35em)' : 'translate(' + dx + 'px,' + (ph === 'a' ? (perm[i] % 2 ? -0.28 : 0.28) : 0) + 'em)';
      st2.color = on ? K.i900 : SORTC[i % SORTC.length]; st2.opacity = vis ? 1 : 0;
      st2.transition = ph === 'pre' ? 'none' : ph === 'a' ? 'opacity 300ms ease, transform 500ms ' + EASE : on ? 'transform 1000ms ' + EASE + ' ' + d + 'ms, color 500ms ease ' + (d + 800) + 'ms' : 'transform 600ms ease ' + i * 30 + 'ms, opacity 500ms ease ' + i * 30 + 'ms';
    } else if (m === 'reclaim') {
      const d = 150 + i * 95;
      const inner = h('span', { style: { display: 'inline-block', transformOrigin: '50% 100%', transform: on ? 'none' : ph === 'out' ? 'translateY(105%)' : 'translateY(105%) rotate(' + (i % 2 ? 8 : -8) + 'deg)', color: on ? K.i900 : K.g600,
        transition: ph === 'pre' || ph === 'a' ? 'none' : on ? 'transform 1000ms cubic-bezier(0.34,1.3,0.64,1) ' + d + 'ms, color 800ms ease ' + (d + 900) + 'ms' : 'transform 700ms ease-in ' + i * 40 + 'ms' } }, ch);
      return h('span', { key: wi + '_' + i, ref: e => refs.current[i] = e, 'aria-hidden': true, style: { display: 'inline-block', overflow: 'hidden', paddingBottom: '0.26em', marginBottom: '-0.26em', paddingTop: '0.1em', marginTop: '-0.1em' } }, inner);
    } else {
      const d = 300 + i * 85;
      st2.color = on ? K.i900 : '#8A978F'; st2.opacity = vis ? 1 : ph === 'out' ? 0 : 0;
      st2.filter = on ? 'blur(0)' : 'blur(0.07em)'; st2.transform = on ? 'none' : ph === 'out' ? 'scale(0.96)' : 'translate(' + (rx * 0.03).toFixed(2) + 'em,' + (ry * 0.05).toFixed(2) + 'em) rotate(' + (rr * 0.03).toFixed(1) + 'deg)';
      st2.transition = ph === 'pre' ? 'none' : ph === 'a' ? 'opacity 500ms ease' : on ? 'filter 450ms ease ' + d + 'ms, color 450ms ease ' + d + 'ms, transform 450ms ' + EASE + ' ' + d + 'ms' : 'opacity 600ms ease ' + i * 40 + 'ms, transform 600ms ease';
    }
    return h('span', { key: wi + '_' + i, ref: e => refs.current[i] = e, 'aria-hidden': true, style: st2 }, ch);
  };
  const extras = [];
  if (m === 'process') extras.push(h('span', { key: 'sv', 'aria-hidden': true, style: { position: 'absolute', left: '-4%', right: '-4%', top: '-0.06em', height: 0, borderTop: '0.045em dashed ' + K.i500, opacity: ph === 'a' || (on) ? 1 : 0, transition: on ? 'opacity 500ms ease ' + (250 + n * 85 + 600) + 'ms' : 'opacity 300ms ease', animation: 'adv-shake 0.18s linear infinite' } }),
    h('span', { key: 'sv2', 'aria-hidden': true, style: { position: 'absolute', left: '-4%', right: '-4%', top: '0.02em', height: 0, borderTop: '0.02em solid ' + K.i300, opacity: ph === 'a' || on ? 1 : 0, transition: on ? 'opacity 500ms ease ' + (250 + n * 85 + 600) + 'ms' : 'opacity 300ms ease' } }));
  if (m === 'reclaim') extras.push(h('span', { key: 'gr', 'aria-hidden': true, style: { position: 'absolute', left: 0, right: 0, bottom: '0.02em', height: '0.04em', borderRadius: 99, background: K.g600, transformOrigin: 'left', transform: vis ? 'scaleX(1)' : 'scaleX(0)', opacity: on ? 0 : 1, transition: ph === 'a' ? 'transform 600ms ' + EASE : on ? 'opacity 600ms ease ' + (150 + n * 95 + 900) + 'ms' : 'none' } }));
  if (m === 'remediate') { const T = 300 + n * 85; extras.push(h('span', { key: 'sw', 'aria-hidden': true, style: { position: 'absolute', top: '0.05em', bottom: '0.05em', width: '0.05em', borderRadius: 99, background: K.g600, left: on ? '100%' : '0%', opacity: on ? 0 : vis ? 1 : 0, transition: on ? 'left ' + (T - 200) + 'ms linear 300ms, opacity 300ms ease ' + (T + 150) + 'ms' : 'opacity 300ms ease' } })); }
  return h('span', { role: 'img', 'aria-label': w, style: { display: 'inline-flex', justifyContent: 'center', whiteSpace: 'nowrap', position: 'relative' } }, [...w].map(letter), extras);
}
function StepBar({ dur, paused, halted, onResume }) {
  return h('div', { className: 'stepbar' },
    h('div', { className: 'stepbar-track' },
      h('div', { className: 'stepbar-fill', style: { animation: 'adv-prog ' + dur + 's linear forwards', animationPlayState: halted ? 'paused' : 'running' } })),
    h('button', { type: 'button', className: 'paused', onClick: onResume, tabIndex: paused ? 0 : -1, 'aria-hidden': !paused, style: CAN_HOVER ? { opacity: paused ? 1 : 0, pointerEvents: paused ? 'auto' : 'none' } : { display: paused ? 'inline' : 'none' } }, CAN_HOVER ? 'Paused' : 'Paused · tap to resume'));
}
const HH_DUR = 7;
const HH = [
  { label: 'Door-to-door collection', title: 'Every bin, every route.', body: 'Collection trucks run fixed routes through wards and housing societies. Each pickup is logged by vehicle, route and time, so missed bins and overloaded routes show up the same day.', vb: [0, 560, 480, 300],
    details: [['What we capture', 'Vehicle, route, pickup time and segregation at source.'], ['Deliverable', 'Route coverage and collection efficiency by ward.'], ['On the ledger', 'Expected inbound metric tonnes for the day.']],
    tags: ['Route tracking', 'Source segregation', 'Ward reports'], info: { 'Route tracking': 'GPS on each collection vehicle, matched against its planned route.', 'Source segregation': 'Households separating wet, dry and sanitary waste before pickup.', 'Ward reports': 'Daily collection coverage and tonnage for each municipal ward.' } },
  { label: 'Boom barrier, weighbridge and CCTV', title: 'Weighed in, on camera.', body: 'At the gate each truck waits at the boom barrier, then crosses the weighbridge. Gross weight, number plate and a CCTV clip are recorded against the trip.', vb: [300, 390, 480, 300],
    details: [['What we capture', 'Gross weight in MT, number plate, timestamp and CCTV clip.'], ['Deliverable', 'A weighbridge ticket for every inbound trip.'], ['On the ledger', 'Inbound tonnage by vehicle, route and supplier.']],
    tags: ['Boom barrier', 'Weighbridge', 'ANPR'], info: { 'Boom barrier': 'Holds each vehicle until the weighbridge is clear, so trucks are weighed one at a time.', 'Weighbridge': 'A platform scale that weighs each truck in metric tonnes.', 'ANPR': 'Automatic number plate recognition: cameras read the plate and attach it to the weight.' } },
  { label: 'Manual picking and segregation', title: 'Hands on the belt, hazards out first.', body: 'Waste rides the feed conveyor to the picking station. Workers pull hazardous sanitary waste first, then recyclable plastics, metals and multi-layer plastics into separate bins.', vb: [520, 600, 330, 206],
    details: [['What we capture', 'Bin weights by fraction, by shift and by picker line.'], ['Deliverable', 'Segregation efficiency for each stream.'], ['On the ledger', 'Recyclables recovered and hazardous waste isolated.']],
    tags: ['Picking belt', 'Sanitary waste', 'MLP'], info: { 'Picking belt': 'A slow conveyor where trained workers pick materials by hand, with protective gear.', 'Sanitary waste': 'Hazardous items such as sanitary pads and diapers, kept apart for secure incineration.', 'MLP': 'Multi-layer plastic, like chip packets: hard to recycle, so it becomes RDF.' } },
  { label: 'Trommel processing', title: 'Screened into clean fractions.', body: 'What remains goes into the trommel. Fine organics fall through to compost, mid-size grit to inerts, and the light overs become RDF.', vb: [350, 640, 320, 200],
    details: [['What we capture', 'Throughput in MT per hour, run hours and downtime.'], ['Deliverable', 'Output split by screen section.'], ['On the ledger', 'Compost, inerts and RDF produced per shift.']],
    tags: ['Trommel', 'Organic fines', 'RDF'], info: { 'Trommel': 'A rotating drum screen; holes of different sizes separate material by size.', 'Organic fines': 'Small wet organics that pass the finest holes and go to aerobic composting.', 'RDF': 'Refuse-derived fuel: light combustibles co-processed in cement kilns.' } },
  { label: 'Weigh-out and disposal', title: 'Every fraction leaves on the record.', body: 'Each fraction is loaded, weighed out across the same weighbridge and dispatched: compost to farms, recyclables to recyclers, RDF to cement kilns, and hazardous waste to secure incineration.', vb: [690, 420, 600, 375],
    details: [['What we capture', 'Outbound weight, fraction, vehicle and destination.'], ['Deliverable', 'Dispatch manifests with chain of custody.'], ['On the ledger', 'Outbound tonnage by fraction and offtaker.']],
    tags: ['Dispatch', 'Secure disposal', 'Offtakers'], info: { 'Dispatch': 'Each outbound load is weighed and logged before it leaves the site.', 'Secure disposal': 'Hazardous sanitary waste sent to an authorised incinerator, with records kept.', 'Offtakers': 'Buyers of recovered material: farms, recyclers and cement plants.' } },
  { label: 'Reconcile and earn credits', title: 'In equals out, then it earns.', body: 'Inbound and outbound weights are reconciled every day. Methane avoided by composting and plastics recovered are measured and documented, ready for carbon and EPR credits.', vb: [0, 0, 1280, 870],
    details: [['What we capture', 'Daily mass balance, moisture loss and gaps.'], ['Deliverable', 'Audit-ready reports for the municipality.'], ['On the ledger', 'Methane avoided, CO\u2082e and EPR-eligible tonnage.']],
    tags: ['Mass balance', 'Carbon credits', 'EPR credits'], info: { 'Mass balance': 'Tonnes in must equal tonnes out plus moisture loss. Any gap is flagged.', 'Carbon credits': 'Tradable credits for verified emissions avoided, such as methane from composting.', 'EPR credits': 'Extended producer responsibility: producers buy proof that plastic was recovered.' } }
];
function HHViz({ step, onNext, halted }) {
  const next = React.useRef(onNext); next.current = onNext;
  const hz = React.useRef(halted); hz.current = halted;
  React.useEffect(() => { let raf, last = performance.now(), e = 0;
    const tick = now => { const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!hz.current) e += dt; if (e >= HH_DUR) { next.current(); return; } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [step]);
  return h('div', { style: { borderRadius: 24, border: '1px solid ' + K.i100, padding: 20, background: '#fff', boxShadow: 'var(--shadow-card)' } },
    h('div', { role: 'img', 'aria-label': 'Step ' + (step + 1) + ' of 6: ' + HH[step].label, style: { position: 'relative', aspectRatio: '1.6', borderRadius: 14, overflow: 'hidden', background: '#fff' } },
      h(HeroFlow, { mini: true, vb: HH[step].vb, speed: 1, density: 60, showCounters: false }),
      h('div', { key: step, style: { position: 'absolute', left: 12, top: 12, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.92)', border: '1px solid ' + K.i100, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: K.g700, animation: 'lg-in 500ms ' + EASE } }, String(step + 1).padStart(2, '0') + ' · ' + HH[step].label)),
    h('div', { style: { display: 'flex', gap: 6, marginTop: 14 } }, HH.map((_, i) => h('div', { key: i, style: { flex: 1, height: 3, borderRadius: 2, background: K.i100, overflow: 'hidden' } },
      i < step ? h('div', { style: { height: '100%', background: K.g600 } }) : i === step ? h('div', { key: 's' + step, style: { height: '100%', background: K.g600, transformOrigin: 'left', animation: 'adv-prog ' + HH_DUR + 's linear forwards', animationPlayState: halted ? 'paused' : 'running' } }) : null))));
}
const LEGACY = [
  { label: 'Drone study', title: 'Fly the site before anything moves.', body: 'Survey drones capture overlapping imagery of the whole landfill, tied to ground control points for centimetre-level accuracy. The result is a georeferenced orthomosaic of the site as it stands today.', tags: ['Photogrammetry', 'Ground control points', 'Orthomosaic'], placeholder: 'Drone survey flight or orthomosaic' },
  { label: 'DSM model generation', title: 'A surface model of the mound.', body: 'Drone imagery is processed into a dense point cloud and a digital surface model. Compared against the original ground level, it gives the true shape and depth of the heap.', tags: ['Point cloud', 'DSM / DTM', 'Contours'], placeholder: 'DSM render or elevation heatmap' },
  { label: 'Waste quantification', title: 'Volume becomes tonnage.', body: 'Cut-and-fill analysis on the surface model gives the volume of waste in place. Bulk density from field tests converts it into tonnes, cell by cell.', tags: ['Volume', 'Bulk density', 'Tonnage by cell'], placeholder: 'Volume calculation or cell map' },
  { label: 'Waste composition and characteristics', title: 'Know what the mound is made of.', body: 'Trial pits and boreholes are sampled and sorted by fraction — soil-like material, plastics, RDF, inerts, metals. Moisture, calorific value, and contaminants are tested in the lab.', tags: ['Trial pits', 'Fraction sorting', 'Lab analysis'], placeholder: 'Trial pit, sampling, or sorting photo' },
  { label: 'Baseline study', title: 'A reference point for every claim.', body: 'Methane, leachate, groundwater, and air quality are recorded before reclamation begins. This baseline is what recovery, emissions avoided, and land reclaimed are measured against.', tags: ['Methane', 'Leachate', 'Groundwater'], placeholder: 'Baseline monitoring or gas sampling photo' },
  { label: 'Tracking from excavation to processing', title: 'Every trip, from cell to trommel.', body: 'Excavation zones are mapped against the plan. Each load is weighed at the weighbridge, seen on CCTV, and logged into processing — so every tonne has a source cell and a destination.', tags: ['Weighbridge', 'CCTV', 'Chain of custody'], placeholder: 'Excavator, weighbridge, or trommel photo' },
  { label: 'Auditing and reconciling outputs', title: 'Close the books on the landfill.', body: 'Outward fractions are reconciled against the quantified tonnage, and repeat drone surveys confirm the volume removed. Gaps are flagged; the final record is ready for auditors and regulators.', tags: ['Mass balance', 'Repeat surveys', 'Audit-ready reports'], placeholder: 'Reconciliation dashboard or before/after survey' },
];
const LEGACY_X = [
  { details: [['What we capture', 'RGB imagery at 2\u20133 cm resolution, ground control coordinates and flight logs.'], ['Deliverable', 'Georeferenced orthomosaic and surveyed site boundary.'], ['On the ledger', 'Survey date, area in hectares, and the baseline image every later survey is compared with.']],
    info: { 'Photogrammetry': 'Taking measurements and 3D models from overlapping photographs.', 'Ground control points': 'Surveyed markers on the ground that pin drone images to exact coordinates.', 'Orthomosaic': 'A single, distortion-free aerial map stitched from hundreds of drone photos.' } },
  { details: [['What we capture', 'A dense point cloud built from the overlapping drone images.'], ['Deliverable', 'Digital surface and terrain models, with 1 m contours.'], ['On the ledger', 'Heap height, footprint and original ground level.']],
    info: { 'Point cloud': 'Millions of 3D points describing the surface of the heap.', 'DSM / DTM': 'Digital surface model (top of the waste) and digital terrain model (ground beneath it).', 'Contours': 'Lines of equal height, used to read slopes and plan excavation benches.' } },
  { details: [['What we capture', 'Cut-and-fill volumes and field bulk-density tests.'], ['Deliverable', 'Waste in place, in m\u00b3 and metric tonnes, cell by cell.'], ['On the ledger', 'Opening tonnage that every excavated load is drawn down against.']],
    info: { 'Volume': 'Space the waste occupies, from the difference between surface and ground models, in m\u00b3.', 'Bulk density': 'Mass per cubic metre of waste in place, measured in the field, used to convert m\u00b3 to MT.', 'Tonnage by cell': 'The site divided into a grid, with metric tonnes estimated for each cell.' } },
  { details: [['What we capture', 'Trial pit samples, sieve fractions, moisture, calorific value and contaminants.'], ['Deliverable', 'Composition profile by depth and cell.'], ['On the ledger', 'Expected shares of soil, inerts, RDF, plastics and hazardous waste \u2014 the target for processing.']],
    info: { 'Trial pits': 'Excavated pits that expose the waste profile at depth for sampling.', 'Fraction sorting': 'Separating samples by weight into soil, inerts, plastics, RDF, metals and hazardous waste.', 'Lab analysis': 'Moisture, calorific value and contaminant tests on the samples.' } },
  { details: [['What we capture', 'Methane flux, leachate, groundwater and ambient air readings.'], ['Deliverable', 'Baseline report with every sampling location.'], ['On the ledger', 'Reference for methane avoided and carbon credit claims.']],
    info: { 'Methane': 'Landfill gas from rotting organics, with over 80 times the warming effect of CO\u2082 over 20 years.', 'Leachate': 'Contaminated liquid that drains through waste and can reach groundwater.', 'Groundwater': 'Monitoring wells sampled before and after reclamation to prove no new harm.' } },
  { details: [['What we capture', 'Excavation cell, truck number, gross and tare weight in MT, CCTV clip and timestamp.'], ['Deliverable', 'Trip-by-trip chain of custody, from cell to trommel to dispatch.'], ['On the ledger', 'Running tonnage excavated against the opening quantity.']],
    info: { 'Weighbridge': 'A platform scale that weighs each truck in metric tonnes, loaded and empty.', 'CCTV': 'Cameras recording number plates and loads, so every weight has visual evidence.', 'Chain of custody': 'An unbroken record of where each load came from and where it went.' } },
  { details: [['What we capture', 'Outward weights by fraction, dispatch destinations, and repeat drone surveys.'], ['Deliverable', 'Mass-balance report and before-and-after volume comparison.'], ['On the ledger', 'Audit-ready record for regulators, and for carbon and EPR credits.']],
    info: { 'Mass balance': 'Tonnes in must equal tonnes out plus moisture loss. Any gap is flagged.', 'Repeat surveys': 'Drone flights after excavation that confirm the volume removed.', 'Audit-ready reports': 'Records structured for regulators, auditors and credit registries.' } }
];
LEGACY.forEach((l, i) => Object.assign(l, LEGACY_X[i]));

/* ---------- Platform section (replaces the design tool's Component class) ---------- */
const ARMS = [
  { id: 'legacy', num: 'Platform 01', title: 'Clean up legacy landfills', sub: 'Survey, excavate, process and reclaim old dump sites, with every metric tonne accounted for.',
    kicker: 'Legacy landfill remediation · 7 steps', heading: 'From survey to audit, in seven steps.' },
  { id: 'household', num: 'Platform 02', title: 'Manage household waste', sub: 'Collection, processing, segregation and disposal of fresh municipal waste, on one ledger.',
    kicker: 'Household waste management · 6 steps', heading: 'From doorstep to disposal, in six steps.' }
];
const pad2 = n => String(n).padStart(2, '0');

function Platform() {
  const [arm, setArm] = React.useState('legacy');
  const [steps, setSteps] = React.useState({ legacy: 0, household: 0 });
  const [tagTip, setTagTip] = React.useState(null);
  const [hover, setHover] = React.useState(false); // mouse over, or keyboard focus inside
  const [hold, setHold] = React.useState(false);   // touch: the visitor picked a step to read
  const gridRef = React.useRef(null), ptr = React.useRef('mouse');
  const vis = useVisible(gridRef);
  const A = ARMS.find(a => a.id === arm), isL = arm === 'legacy', SL = isL ? LEGACY : HH, cur = steps[arm];
  const paused = hover || hold, halted = paused || !vis;
  const go = i => { setSteps(s => Object.assign({}, s, { [arm]: i })); setTagTip(null); };
  const next = () => { setSteps(s => Object.assign({}, s, { [arm]: (s[arm] + 1) % SL.length })); setTagTip(null); };
  const resume = () => { setHold(false); setHover(false); };
  const isTouch = () => ptr.current === 'touch' || ptr.current === 'pen';

  const grid = {
    ref: gridRef, className: 'steps-grid',
    onPointerDown: e => { ptr.current = e.pointerType; },
    onPointerEnter: e => { if (e.pointerType === 'mouse') setHover(true); },
    onPointerLeave: e => { if (e.pointerType === 'mouse') setHover(false); },
    onFocus: e => { try { if (e.target.matches(':focus-visible')) setHover(true); } catch (_) {} },
    onBlur: e => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); }
  };

  const card = (st, i) => {
    const on = i === cur, id = 'step-' + arm + '-' + i, tip = on && tagTip && st.info[tagTip];
    return h('div', { key: arm + i, className: 'step-card' + (on ? ' is-on' : '') },
      h('button', { type: 'button', className: 'step-head', 'aria-expanded': on, 'aria-controls': id,
        onClick: () => { go(i); if (isTouch()) setHold(true); } },
        h('span', { className: 'mono-n' }, pad2(i + 1)),
        h('span', { className: 'step-label' }, st.label),
        h('span', { className: 'step-chev', 'aria-hidden': true }, '+')),
      h('div', { id, className: 'step-body', 'aria-hidden': !on, inert: on ? undefined : '' },
        h('div', { className: 'step-clip' }, h('div', { className: 'step-inner' },
          on ? h(StepBar, { key: arm + i, dur: isL ? LG_DUR : HH_DUR, paused, halted, onResume: resume }) : null,
          h('span', { className: 'step-title' }, st.title),
          h('p', { className: 'step-text' }, st.body),
          h('div', { className: 'details' }, st.details.map(([k, v], j) => h('div', { key: j }, h('span', { className: 'caps' }, k), h('span', { className: 'v' }, chem(v))))),
          h('div', { className: 'tags' },
            st.tags.map(tg => h('button', { key: tg, type: 'button', className: 'tagbtn' + (tagTip === tg ? ' is-on' : ''), 'aria-pressed': tagTip === tg,
              onPointerEnter: e => { if (e.pointerType === 'mouse') setTagTip(tg); },
              onPointerLeave: e => { if (e.pointerType === 'mouse') setTagTip(t => t === tg ? null : t); },
              onClick: () => setTagTip(t => (t === tg && ptr.current !== 'mouse') ? null : tg) }, tg)),
            h('span', { className: 'hint' }, (CAN_HOVER ? 'Hover' : 'Tap') + ' to learn more')),
          tip ? h('div', { className: 'tip', role: 'status' }, h('span', { className: 'caps' }, tagTip), h('span', null, chem(tip))) : null))));
  };

  return h(React.Fragment, null,
    h('div', { className: 'arms' }, ARMS.map(o => { const on = o.id === arm;
      return h('button', { key: o.id, type: 'button', className: 'arm' + (on ? ' is-on' : ''), 'aria-pressed': on,
        onClick: () => { setArm(o.id); setTagTip(null); setHold(false); } },
        h('span', { className: 'arm-top' }, h('span', { className: 'mono-n' }, o.num), h('span', { className: 'arm-pill' }, on ? 'Showing' : 'Explore')),
        h('span', { className: 'arm-title' }, o.title),
        h('span', { className: 'arm-sub' }, o.sub)); })),
    h('div', { className: 'arm-head' }, h('span', { className: 'caps' }, A.kicker), h('h3', { className: 'h-sub' }, A.heading)),
    h('div', grid,
      h('div', { className: 'steps' }, SL.map(card)),
      h('div', { className: 'viz-col' }, isL ? h(LegacyViz, { step: cur, onNext: next, halted }) : h(HHViz, { step: cur, onNext: next, halted }))),
    isL ? h(React.Fragment, null,
      h('div', { className: 'live-head' },
        h('div', { className: 'caps' }, 'Live on site · Processing · Weighbridge · CCTV'),
        h('h3', { className: 'h-sub' }, 'Every metric tonne in. Every fraction out.'),
        h('p', { className: 'lede' }, 'Legacy and household lines run side by side. Each truck stops at the boom barrier, is weighed and recorded on CCTV, tips at its line, and processed fractions cross the weighbridge again before dispatch.')),
      h('div', { className: 'live-card' }, h(HeroFlow, { speed: 1, density: 70, showCounters: true }))) : null);
}

/* One failing island must not take the page down with it. */
class Island extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e) { if (window.console) console.error('[landing] island failed:', e); }
  render() { return this.state.err ? (this.props.fallback || null) : this.props.children; }
}
function mount(id, el, fallback) {
  const node = document.getElementById(id); if (!node) return;
  ReactDOM.createRoot(node).render(h(Island, { fallback }, el));
}
mount('hero-word', h(ScatterWord), 'Recovery.');
mount('platform-app', h(Platform));
mount('balance-viz', h(BalanceViz));
mount('forecast-viz', h(ForecastViz));
})();
