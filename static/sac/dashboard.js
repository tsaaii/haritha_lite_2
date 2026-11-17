/* /sac public display: rotates all phases -> each phase; pills hold a phase;
   hovering the desktop display pauses it. Also runs the PIN + captcha popup. */
(function () {
  "use strict";
  var CFG = window.SAC_CFG || {};
  var DATA = JSON.parse(document.getElementById("sacData").textContent);
  var slides = DATA.slides || [];
  var state = { i: 0, paused: false, hold: false };

  var MATS = [["Soil", "var(--green-300)"], ["Inert", "var(--ink-200)"], ["RDF", "var(--amber-600)"], ["CnD", "var(--sky-400)"]];
  var inr = function (v) { return Math.round(v).toLocaleString("en-IN"); };
  var num = function (v) { return v >= 1e7 ? (v / 1e7).toFixed(2) : v >= 1e5 ? (v / 1e5).toFixed(1) : inr(v); };
  var unitOf = function (v) { return v >= 1e7 ? "Crore MT" : v >= 1e5 ? "Lakh MT" : "MT"; };
  var lk = function (v) { return (v / 1e5).toFixed(v < 1e6 ? 2 : 1); };
  var pctOf = function (a, b) { return b > 0 ? Math.floor(a / b * 100) : 0; };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function each(key, fn) { document.querySelectorAll('[data-k="' + key + '"]').forEach(fn); }
  function setText(key, v) { each(key, function (e) { e.textContent = v; }); }

  // ---- desktop stage scaling -------------------------------------------
  var stage = document.getElementById("stage");
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var s = Math.min(w / 1440, h / 810);
    stage.style.width = (w / s) + "px";
    stage.style.height = (h / s) + "px";
    stage.style.transform = "scale(" + s + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  // ---- render -----------------------------------------------------------
  function agencyRow(a, maxA, big, mobile) {
    var t = a[1], r = a[2];
    var trackW = Math.max(maxA > 0 ? t / maxA * 100 : 0, 1.5) + "%";
    var fillW = (t > 0 ? Math.min(r / t, 1) * 100 : 0) + "%";
    var over = r - t >= 1000;
    var fs = ["19px", "24px", "30px"][big], bar = ["18px", "24px", "30px"][big], xs = ["15px", "18px", "21px"][big];
    var track = el("div", "track"); track.style.width = trackW;
    var fill = el("div"); fill.style.width = fillW; track.appendChild(fill);
    var vals = el("span");
    vals.appendChild(el("span", "wd", lk(r)));
    vals.appendChild(document.createTextNode(" / " + lk(t)));
    var u = el("span", "unit", " Lakh MT");
    vals.appendChild(u);
    var x = over ? el("div", "xtra", "+" + lk(r - t) + " extra") : null;
    if (mobile) {
      var c = el("div", "mcard"), top = el("div", "mcard__t");
      top.appendChild(el("span", "", a[0])); top.appendChild(vals); c.appendChild(top);
      if (x) c.appendChild(x);
      c.appendChild(track);
      return c;
    }
    var row = el("div", "agr");
    var n = el("div", "agr__n", a[0]); n.style.fontSize = fs; row.appendChild(n);
    track.style.height = bar;
    var tw = el("div"); tw.appendChild(track); row.appendChild(tw);
    var v = el("div", "agr__v"), line = el("div");
    line.style.fontSize = fs; u.style.fontSize = xs;
    line.appendChild(vals); v.appendChild(line);
    if (x) { x.style.fontSize = xs; v.appendChild(x); }
    row.appendChild(v);
    return row;
  }

  function render() {
    var s = slides[state.i];
    if (!s) return;
    var p = pctOf(s.c, s.t);
    setText("name", s.label);
    setText("pct", p);
    each("bar", function (e) { e.style.width = p + "%"; });
    setText("weighed", num(s.c)); setText("wUnit", unitOf(s.c));
    setText("left", num(s.t - s.c)); setText("lUnit", unitOf(s.t - s.c));
    setText("done", s.done); setText("sites", s.sites);

    var mSum = s.m.reduce(function (a, b) { return a + b; }, 0) || 1;
    each("segs", function (box) {
      box.textContent = "";
      MATS.forEach(function (m, i) { var d = el("div"); d.style.width = (s.m[i] / mSum * 100) + "%"; d.style.background = m[1]; box.appendChild(d); });
    });
    each("mlist", function (box) {
      box.textContent = "";
      MATS.forEach(function (m, i) {
        var it = el("div", "mi"), dot = el("span", "dot"); dot.style.background = m[1];
        it.appendChild(dot); it.appendChild(el("span", "mi__n", m[0]));
        var v = el("span", "mi__v", lk(s.m[i])); v.appendChild(el("span", "", " · " + Math.round(s.m[i] / mSum * 100) + "%"));
        it.appendChild(v); box.appendChild(it);
      });
    });

    var ag = s.agencies || [], nR = ag.length;
    var maxA = Math.max.apply(null, ag.map(function (a) { return a[1]; }).concat([0]));
    var big = nR <= 3 ? 2 : nR <= 5 ? 1 : 0;
    var list = document.getElementById("agList"), listM = document.getElementById("agListM");
    list.textContent = ""; listM.textContent = "";
    list.classList.toggle("is-scroll", nR > 8);
    ag.forEach(function (a) { list.appendChild(agencyRow(a, maxA, big, false)); listM.appendChild(agencyRow(a, maxA, 0, true)); });
    list.scrollTop = 0; listM.scrollTop = 0;
    setText("more", nR > 8 ? "Scroll to see all " + nR + " agencies" : "");
    setText("moreM", nR > 5 ? "Scroll to see all " + nR + " agencies" : "");

    each("pills", function (box) {
      box.textContent = "";
      slides.forEach(function (sl, i) {
        var b = el("button", "pill" + (i === state.i ? " is-on" : ""), sl.label);
        b.type = "button";
        b.setAttribute("aria-pressed", i === state.i ? "true" : "false");
        b.addEventListener("click", function () { state.i = i; state.hold = true; render(); });
        box.appendChild(b);
      });
      if (box.classList.contains("mtabs")) {
        var on = box.children[state.i];
        if (on) box.scrollTo({ left: on.offsetLeft - 16, behavior: "smooth" });
      }
    });
    setText("hold", state.hold ? "Resume rotation" : "Hold this phase");
  }

  document.querySelectorAll('[data-k="hold"]').forEach(function (b) {
    b.addEventListener("click", function () { state.hold = !state.hold; render(); });
  });
  stage.addEventListener("mouseenter", function () { state.paused = true; });
  stage.addEventListener("mouseleave", function () { state.paused = false; });
  setInterval(function () {
    if (state.paused || state.hold || document.hidden || !loginHidden() || slides.length < 2) return;
    state.i = (state.i + 1) % slides.length;
    render();
  }, CFG.rotationMs || 6000);
  render();

  // ---- login popup --------------------------------------------------------
  var scrim = document.getElementById("login");
  function loginHidden() { return !scrim || scrim.hidden; }
  if (!scrim) return;
  var boxes = Array.prototype.slice.call(document.querySelectorAll("#pin input"));
  var err = document.getElementById("loginErr"), pinWrap = document.getElementById("pin");
  var capQ = document.getElementById("capQ"), capA = document.getElementById("capA"), capN = document.getElementById("capN");
  var go = document.getElementById("loginGo");
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    scrim.hidden = false;
    setTimeout(function () { boxes[0].focus(); }, 0);
  }
  function close() {
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (/[?&]login=1/.test(location.search)) history.replaceState(null, "", location.pathname);
  }
  function showErr(msg) {
    err.textContent = msg || ""; err.hidden = !msg;
    pinWrap.classList.toggle("is-bad", !!msg && /PIN/.test(msg));
  }
  function newQuestion(q, n) {
    if (q) { capQ.textContent = q; capN.value = n; capA.value = ""; return; }
    fetch(CFG.captcha, { credentials: "same-origin" }).then(function (r) { return r.json(); })
      .then(function (d) { capQ.textContent = d.question; capN.value = d.nonce; capA.value = ""; capA.focus(); });
  }

  document.querySelectorAll("[data-login]").forEach(function (a) {
    if (CFG.signedIn) return;
    a.addEventListener("click", function (e) { e.preventDefault(); open(); });
  });
  document.getElementById("loginClose").addEventListener("click", close);
  scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !scrim.hidden) close(); });
  document.getElementById("capNew").addEventListener("click", function () { newQuestion(); });

  boxes.forEach(function (b, i) {
    b.addEventListener("input", function () {
      var d = b.value.replace(/\D/g, "");
      if (d.length > 1) {          // pasted or autofilled: spread the digits
        d.split("").slice(0, boxes.length - i).forEach(function (ch, k) { boxes[i + k].value = ch; });
        (boxes[Math.min(i + d.length, boxes.length - 1)]).focus();
        return;
      }
      b.value = d;
      if (d) (i < boxes.length - 1 ? boxes[i + 1] : capA).focus();
    });
    b.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !b.value && i > 0) boxes[i - 1].focus();
    });
  });

  document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var pin = boxes.map(function (b) { return b.value; }).join("");
    if (pin.length !== boxes.length) { showErr("Enter all " + boxes.length + " digits of your PIN."); boxes[pin.length].focus(); return; }
    if (!capA.value.trim()) { showErr("Answer the sum first."); capA.focus(); return; }
    go.disabled = true;
    fetch(CFG.login, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "sac" },
      body: JSON.stringify({ pin: pin, captcha_answer: capA.value.trim(), captcha_nonce: capN.value, next: CFG.next || "" })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { location.assign(d.next); return; }
      go.disabled = false;
      showErr(d.error || "Something went wrong. Try again.");
      newQuestion(d.question, d.nonce);
      if (/PIN/.test(d.error || "")) { boxes.forEach(function (b) { b.value = ""; }); boxes[0].focus(); } else { capA.focus(); }
    }).catch(function () { go.disabled = false; showErr("Could not reach the server. Try again."); });
  });

  if (!scrim.hidden) open();
})();
