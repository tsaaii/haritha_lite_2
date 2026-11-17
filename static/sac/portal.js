/* /sac/portal. Rows come from the published phase sheet (data/phase_data.py):
   [location, site_name, phase, agency, cluster, target, weighed, inert, rdf, cnd,
    soil, rdf_remaining, start, deadline, status, processing_power]
   The view lives in the URL hash (#/agency/<agency>/<site>) so Back works. */
(function () {
  "use strict";
  var CFG = window.SAC_CFG || {};
  var ROWS = JSON.parse(document.getElementById("sacRows").textContent);
  var PHASES = JSON.parse(document.getElementById("sacPhases").textContent);
  var PH = {}, PORDER = [];
  PHASES.forEach(function (p) { PH[p[0]] = p[1]; PORDER.push(p[0]); });
  var LEVELS = { agency: ["agency", "site"], phase: ["phase", "agency", "site"], site: ["site"] };
  var NOUN = { agency: ["agency", "agencies"], phase: ["phase", "phases"], site: ["site", "sites"] };
  var TITLE = { agency: "Agencies", phase: "Phases", site: "Sites" };
  var KEY = { agency: function (r) { return r[3] || "Agency not named"; }, phase: function (r) { return r[2]; }, site: function (r) { return r[0]; } };
  var MAT = [["Soil", 10, "var(--green-300)", "var(--green-600)"], ["Inert", 7, "var(--ink-200)", "var(--ink-500)"],
             ["RDF", 8, "var(--amber-600)", "var(--amber-600)"], ["CnD", 9, "var(--sky-400)", "var(--sky-600)"]];
  var app = document.getElementById("app");
  var ui = { q: "", fPhase: "", fAgency: "" };
  var upload = null;   // {file, name, total, issues:[{line,title,msg,locked,skip}]}
  var uploadError = "";

  // ---------------------------------------------------------------- helpers
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); };
  var fmt = function (v) { return v >= 1e5 ? (v / 1e5).toFixed(2) + " Lakh MT" : Math.round(v).toLocaleString("en-IN") + " MT"; };
  var label = function (lv, k) { return lv === "phase" ? (PH[k] || k) : k; };
  var uniq = function (rs, f) { return new Set(rs.map(f)).size; };
  var plural = function (n, lv) { return n + " " + NOUN[lv][n === 1 ? 0 : 1]; };
  var ICON = {
    chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>',
    up: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m17 8-5-5-5 5"></path><path d="M12 3v12"></path></svg>',
    cam: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>'
  };
  var TILE_ICON = {
    agency: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    phase: '<path d="m12 2 10 5-10 5L2 7z"></path><path d="m2 12 10 5 10-5"></path><path d="m2 17 10 5 10-5"></path>',
    site: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle>',
    rdf: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>'
  };
  var svg = function (p) { return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; };

  function agg(rs) {
    var t = 0, r = 0, c = 0, m = [0, 0, 0, 0];
    rs.forEach(function (x) { t += x[5]; r += x[6]; c += Math.min(x[5], x[6]); MAT.forEach(function (d, i) { m[i] += x[d[1]]; }); });
    var pct = t > 0 ? Math.floor(c / t * 100) : 0, left = t - c, ms = m.reduce(function (a, b) { return a + b; }, 0) || 1;
    return { t: t, pct: pct, awarded: fmt(t), weighed: fmt(r), left: fmt(left), leftColor: left >= 1 ? "var(--red-600)" : "var(--ink-500)",
      mats: MAT.map(function (d, i) { return { name: d[0], dark: d[2], light: d[3], val: fmt(m[i]), pct: Math.round(m[i] / ms * 100) + "%", w: (m[i] / ms * 100) + "%" }; }) };
  }

  // ------------------------------------------------------------------ route
  function route() {
    var parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    var mode = parts[0] || "home";
    if (!LEVELS[mode] && mode !== "upload") mode = "home";
    if (mode === "upload" && !window.SAC_ADMIN) mode = "home";
    return { mode: mode, path: LEVELS[mode] ? parts.slice(1, 1 + LEVELS[mode].length) : [] };
  }
  function href(mode, path) { return "#/" + [mode].concat(path || []).map(encodeURIComponent).join("/"); }
  function go(mode, path) {
    var h = mode === "home" ? "#/" : href(mode, path);
    if (location.hash === h) render(); else location.hash = h;
  }
  window.addEventListener("hashchange", function () { ui.q = ""; render(); window.scrollTo(0, 0); });
  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function (e) { e.preventDefault(); if (b.dataset.go === "home") { ui = { q: "", fPhase: "", fAgency: "" }; } go(b.dataset.go, []); });
  });

  // ------------------------------------------------------------------- home
  function homeHtml() {
    var tile = function (mode, title, sub) {
      return '<a class="tile" href="' + href(mode, []) + '"><div class="tile__i">' + svg(TILE_ICON[mode]) + '</div><div><div class="tile__t">' + title +
        '</div><div class="tile__s">' + sub + "</div></div></a>";
    };
    return '<div class="home"><h1 class="h1">What would you like to see?</h1><div class="tiles">' +
      tile("agency", "Agency data", uniq(ROWS, KEY.agency) + " agencies") +
      tile("phase", "Phase data", uniq(ROWS, KEY.phase) + " phases") +
      tile("site", "Site data", uniq(ROWS, KEY.site) + " sites") +
      '<a class="tile tile--dark" href="' + esc(window.SAC_RDF) + '" target="_blank" rel="noopener"><div class="tile__i">' + svg(TILE_ICON.rdf) +
      '</div><div><div class="tile__t">RDF data</div><div class="tile__s">Opens RDF report<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg></div></div></a>' +
      "</div></div>";
  }

  // ------------------------------------------------------------- drill-down
  function bandHtml(s) {
    var mats = s.mats.map(function (m) { return '<div style="width:' + m.w + ';background:' + m.dark + '"></div>'; }).join("");
    var list = s.mats.map(function (m) {
      return '<div class="mi"><span class="dot" style="background:' + m.dark + '"></span><span class="mi__n">' + m.name + '</span><span class="mi__v">' + m.val + "<span> · " + m.pct + "</span></span></div>";
    }).join("");
    return '<section class="band"><div class="band__g">' +
      '<div><div class="band__pct">' + s.pct + '<span>%</span></div><div class="band__l">weighed in</div></div>' +
      '<div><div class="band__v">' + s.awarded + '</div><div class="band__l">awarded</div></div>' +
      '<div><div class="band__v"><span class="dot" style="background:var(--green-300)"></span>' + s.weighed + '</div><div class="band__l">weighed in</div></div>' +
      '<div><div class="band__v"><span class="dot" style="background:var(--red-600)"></span>' + s.left + '</div><div class="band__l">left out</div></div>' +
      '</div><div class="band__bar"><div style="width:' + s.pct + '%"></div></div>' +
      '<div class="band__mh caps">Material split</div><div class="segs">' + mats + '</div><div class="mgrid">' + list + "</div></section>";
  }

  function selectHtml(id, opts, val) {
    return '<select class="ds-select" id="' + id + '">' + opts.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === val ? " selected" : "") + ">" + esc(o.label) + "</option>";
    }).join("") + "</select>";
  }

  function viewHtml(mode, path) {
    var levels = LEVELS[mode];
    path = path.slice(0, levels.length);
    var scope = ROWS.filter(function (r) { return path.every(function (p, i) { return KEY[levels[i]](r) === p; }); });
    var usePhase = mode !== "phase", useAgency = mode === "site";
    if (usePhase && ui.fPhase) scope = scope.filter(function (r) { return r[2] === ui.fPhase; });
    if (useAgency && ui.fAgency) scope = scope.filter(function (r) { return KEY.agency(r) === ui.fAgency; });
    var isDetail = path.length >= levels.length, lv = levels[path.length];
    var crumbs = [{ label: "Home", h: "#/" }, { label: TITLE[mode], h: href(mode, []) }]
      .concat(path.map(function (p, i) { return { label: label(levels[i], p), h: href(mode, path.slice(0, i + 1)) }; }));
    var title = crumbs[crumbs.length - 1].label;
    var out = '<nav class="crumbs" aria-label="Breadcrumb">' + crumbs.map(function (c, i) {
      var last = i === crumbs.length - 1;
      return '<span><a class="crumb' + (last ? " is-last" : "") + '" href="' + esc(c.h) + '"' + (last ? ' aria-current="page"' : "") + ">" + esc(c.label) + "</a>" +
        (last ? "" : '<span class="sep">/</span>') + "</span>";
    }).join("") + "</nav>";

    var countLabel, body;
    if (isDetail) {
      var recs = scope.slice().sort(function (a, b) { return PORDER.indexOf(a[2]) - PORDER.indexOf(b[2]); });
      countLabel = plural(recs.length, "phase") + " on record";
      body = '<div class="recs">' + recs.map(function (r) {
        var a = agg([r]);
        var meta = [["Site name", r[1]], ["Start", r[12] || "—"], ["Deadline", r[13] || "—"], ["Status", r[14] || "—"],
          ["Processing power", r[15] ? r[15].toLocaleString("en-IN") : "—"], ["RDF remaining in site", r[11] ? fmt(r[11]) : "—"]];
        return '<article class="card"><div class="card__h"><h2>' + esc(PH[r[2]]) + '</h2><div class="card__s">' + esc(KEY.agency(r)) + " · " + esc(r[4] || "No package") + "</div></div>" +
          '<div class="kv"><div><div class="k">Awarded</div><div class="v">' + a.awarded + '</div></div><div><div class="k">Weighed in</div><div class="v" style="color:var(--green-700)">' + a.weighed +
          '</div></div><div><div class="k">Left out</div><div class="v" style="color:' + a.leftColor + '">' + a.left + '</div></div><div><div class="k">Done</div><div class="v">' + a.pct + "%</div></div></div>" +
          '<div class="bar"><div style="width:' + a.pct + '%"></div></div>' +
          '<div class="mgrid">' + a.mats.map(function (m) {
            return '<div class="mi"><span class="dot" style="background:' + m.light + '"></span><span class="mi__n">' + m.name + '</span><span class="mi__v">' + m.val + "<span> · " + m.pct + "</span></span></div>";
          }).join("") + "</div>" +
          '<div class="meta">' + meta.map(function (f) { return '<div><div class="k">' + f[0] + '</div><div class="v">' + esc(f[1]) + "</div></div>"; }).join("") + "</div></article>";
      }).join("") + liveHtml() + "</div>";
    } else {
      var groups = new Map();
      scope.forEach(function (r) { var k = KEY[lv](r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
      var rows = Array.from(groups).map(function (g) {
        var k = g[0], rs = g[1], a = agg(rs);
        a.k = k; a.name = label(lv, k);
        a.sub = lv === "agency" ? plural(uniq(rs, KEY.site), "site") + " · " + plural(uniq(rs, KEY.phase), "phase")
          : lv === "phase" ? plural(uniq(rs, KEY.site), "site") + " · " + plural(uniq(rs, KEY.agency), "agency")
          : Array.from(new Set(rs.map(KEY.agency))).slice(0, 2).join(", ") + " · " + plural(uniq(rs, KEY.phase), "phase");
        return a;
      });
      rows.sort(lv === "phase" ? function (a, b) { return PORDER.indexOf(a.k) - PORDER.indexOf(b.k); } : function (a, b) { return b.t - a.t; });
      var total = rows.length, needle = ui.q.trim().toLowerCase();
      if (needle) rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(needle) >= 0; });
      countLabel = needle ? rows.length + " of " + plural(total, lv) : plural(total, lv);
      body = '<div class="rows">' + rows.map(function (r) {
        return '<a class="row" href="' + esc(href(mode, path.concat([r.k]))) + '"><div class="row__n"><div class="row__name">' + esc(r.name) + '</div><div class="row__sub">' + esc(r.sub) + "</div></div>" +
          '<div class="row__nums"><div><div class="k">Awarded</div><div class="v">' + r.awarded + '</div></div><div><div class="k">Weighed in</div><div class="v" style="color:var(--green-700)">' + r.weighed +
          '</div></div><div><div class="k">Left out</div><div class="v" style="color:' + r.leftColor + '">' + r.left + "</div></div></div>" +
          '<div class="row__bar"><div class="bar"><div style="width:' + r.pct + '%"></div></div><div class="row__pct">' + r.pct + "%</div>" + ICON.chev + "</div></a>";
      }).join("") + "</div>" + (rows.length ? "" : '<div class="empty">Nothing matches these filters.</div>');
    }

    var filters = "";
    if (!isDetail) filters += '<div><label class="sr-only" for="fq">Search by name</label><input class="ds-input" id="fq" placeholder="Search by name" value="' + esc(ui.q) + '"></div>';
    if (usePhase) filters += '<div><label class="sr-only" for="fp">Phase</label>' + selectHtml("fp", [{ value: "", label: "All phases" }].concat(PORDER.map(function (k) { return { value: k, label: PH[k] }; })), ui.fPhase) + "</div>";
    if (useAgency) filters += '<div><label class="sr-only" for="fa">Agency</label>' + selectHtml("fa", [{ value: "", label: "All agencies" }].concat(Array.from(new Set(ROWS.map(KEY.agency))).sort().map(function (a) { return { value: a, label: a }; })), ui.fAgency) + "</div>";

    return out + '<div class="vhead"><div><h1 class="h1">' + esc(title) + '</h1><div class="count" id="countLabel">' + esc(countLabel) + "</div></div>" +
      '<div class="filters">' + filters + "</div></div>" + bandHtml(agg(scope)) + body;
  }

  // ---------------------------------------------------------- live tickets
  // One portal site <-> one weighbridge site name. The best guess is picked
  // from the /filters list; the choice is remembered per site in this browser.
  var live = { sites: null, loading: false, error: "", site: "", from: "", to: "", data: null, shown: 20, req: 0 };
  var norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
  var core = function (s) { return norm(s).replace(/^tharuni/, "").replace(/v\d+$/, "").replace(/\d+$/, "").replace(/(a|u)$/, ""); };
  function matches(loc, siteName) {
    var keys = [loc, siteName].filter(Boolean);
    return (live.sites || []).map(function (api) {
      var score = 0;
      keys.forEach(function (k) {
        if (norm(api) === norm(k)) score = Math.max(score, 3);
        else if (core(api) && core(api) === core(k)) score = Math.max(score, 2);
        else if (core(api).length >= 5 && core(k).length >= 5 && (core(api).indexOf(core(k)) >= 0 || core(k).indexOf(core(api)) >= 0)) score = Math.max(score, 1);
      });
      return { api: api, score: score };
    }).filter(function (m) { return m.score > 0; }).sort(function (a, b) { return b.score - a.score || a.api.localeCompare(b.api); }).map(function (m) { return m.api; });
  }
  function remembered(loc) { try { return localStorage.getItem("sac.live." + loc) || ""; } catch (e) { return ""; } }
  function remember(loc, v) { try { localStorage.setItem("sac.live." + loc, v); } catch (e) { /* private mode */ } }

  function liveHtml() {
    return '<article class="card" id="live" aria-live="polite"></article>';
  }
  function liveRender(loc, siteName) {
    var box = document.getElementById("live");
    if (!box) return;
    var head = '<div class="card__h"><h2>Live from the weighbridge</h2><div class="card__s">Tickets and camera pictures</div></div>';
    if (live.sites === null) { box.innerHTML = head + '<p class="live__note">' + (live.error ? esc(live.error) : "Loading weighbridge sites…") + "</p>"; return; }
    var best = matches(loc, siteName);
    var html = '<select class="ds-select" id="lvSite"><option value="">Choose a weighbridge site</option>';
    if (best.length) html += '<optgroup label="Best matches">' + best.map(function (s) { return '<option value="' + esc(s) + '"' + (s === live.site ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</optgroup>";
    html += '<optgroup label="All weighbridge sites">' + live.sites.filter(function (s) { return best.indexOf(s) < 0; }).map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === live.site ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</optgroup></select>";
    var ctl = '<div class="live__ctl"><div class="wide"><label class="k" for="lvSite">Weighbridge site</label>' + html + "</div>" +
      '<div><label class="k" for="lvFrom">From</label><input class="ds-input" type="date" id="lvFrom" value="' + esc(live.from) + '" max="' + esc(CFG.today) + '"></div>' +
      '<div><label class="k" for="lvTo">To</label><input class="ds-input" type="date" id="lvTo" value="' + esc(live.to) + '" max="' + esc(CFG.today) + '"></div></div>';
    var res = "";
    if (!live.site) res = '<p class="live__note">' + (best.length ? "" : "No weighbridge site has a name like this one. ") + "Pick the weighbridge site to see its tickets.</p>";
    else if (live.loading) res = '<p class="live__note">Loading tickets…</p>';
    else if (live.error) res = '<div class="alert" role="alert" style="margin-top:16px">' + esc(live.error) + "</div>";
    else if (live.data) {
      var d = live.data;
      res = '<div class="live__sum"><div><div class="v">' + d.trips.toLocaleString("en-IN") + '</div><div class="l">' + (d.trips === 1 ? "trip" : "trips") + '</div></div>' +
        '<div><div class="v">' + d.total_mt.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + '</div><div class="l">MT net weight</div></div></div>';
      if (!d.records.length) res += '<p class="live__note">No tickets on these dates.</p>';
      else {
        var shown = d.records.slice(0, live.shown);
        res += '<div class="tix"><div class="tk tk--h"><div class="k">Date</div><div class="k">Vehicle</div><div class="k">Material</div><div class="k num">Net</div><div class="k" style="text-align:right">Photos</div></div>' +
          shown.map(function (r) {
            var url = (CFG.images || "").replace("SITE", encodeURIComponent(r.site_name)).replace("DATE", encodeURIComponent(r.date)).replace("TICKET", encodeURIComponent(r.ticket_no));
            var ph = r.image_slots && r.image_slots.length
              ? '<a class="ph" href="' + esc(url) + '" target="_blank" rel="noopener">' + ICON.cam + "Photos</a>"
              : '<span class="ph is-none">No photos</span>';
            return '<div class="tk"><div>' + esc(r.date) + ' <span class="sub">' + esc(r.time) + '</span><div class="sub">Ticket ' + esc(r.ticket_no) + "</div></div>" +
              '<div class="c-veh">' + esc(r.vehicle_no || "—") + '</div><div class="c-mat">' + esc(r.material_type || "—") + '</div><div class="num">' +
              r.net_weight_mt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MT</div>" + ph + "</div>";
          }).join("") + "</div>";
        if (d.records.length > live.shown) res += '<div class="more"><button type="button" class="ds-btn ds-btn--ghost" id="lvMore">Show more</button></div>';
        if (d.capped) res += '<p class="live__note">Showing the latest 500 tickets. Narrow the dates to see older ones.</p>';
      }
    }
    box.innerHTML = head + ctl + res;
    document.getElementById("lvSite").addEventListener("change", function (e) { live.site = e.target.value; remember(loc, live.site); liveLoad(loc, siteName); });
    ["lvFrom", "lvTo"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function (e) { live[id === "lvFrom" ? "from" : "to"] = e.target.value; liveLoad(loc, siteName); });
    });
    var more = document.getElementById("lvMore");
    if (more) more.addEventListener("click", function () { live.shown += 20; liveRender(loc, siteName); });
  }
  function liveLoad(loc, siteName) {
    live.data = null; live.error = ""; live.shown = 20;
    if (!live.site) { liveRender(loc, siteName); return; }
    live.loading = true; liveRender(loc, siteName);
    var my = ++live.req;
    var q = "?site=" + encodeURIComponent(live.site) + "&from=" + encodeURIComponent(live.from) + "&to=" + encodeURIComponent(live.to);
    fetch(CFG.liveRecords + q, { credentials: "same-origin" }).then(function (r) {
      if (r.status === 401) { location.assign(CFG.login); throw new Error("auth"); }
      return r.json();
    }).then(function (d) {
      if (my !== live.req) return;
      live.loading = false;
      if (d.ok) live.data = d; else live.error = d.error || "Could not load tickets.";
      liveRender(loc, siteName);
    }).catch(function (e) {
      if (my !== live.req || e.message === "auth") return;
      live.loading = false; live.error = "Could not reach the server. Try again."; liveRender(loc, siteName);
    });
  }
  function liveStart(loc, siteName) {
    live.from = live.from || CFG.today; live.to = live.to || CFG.today;
    var boot = function () {
      var best = matches(loc, siteName), saved = remembered(loc);
      live.site = saved && live.sites.indexOf(saved) >= 0 ? saved : (best[0] || "");
      liveLoad(loc, siteName);
    };
    if (live.sites !== null) { boot(); return; }
    liveRender(loc, siteName);
    fetch(CFG.liveSites, { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { live.sites = d.sites; boot(); }
      else { live.error = d.error || "The weighbridge server did not answer."; liveRender(loc, siteName); }
    }).catch(function () { live.error = "Could not reach the server. Try again."; liveRender(loc, siteName); });
  }

  // ----------------------------------------------------------------- upload
  function uploadHtml() {
    var h = '<div class="up"><a class="crumb" href="#/">Home</a><h1 class="h1">Update the data.</h1><p class="up__lead">Upload today\'s sheet. It replaces everything shown now.</p>';
    if (!upload) {
      h += '<label class="drop" id="drop"><div class="drop__i">' + ICON.up + '</div><div class="drop__t">Choose a CSV file</div><div class="drop__s">or drop it here</div>' +
        '<input type="file" accept=".csv,text/csv" id="file"></label>';
      if (uploadError) h += '<div class="alert" role="alert">' + esc(uploadError) + "</div>";
      return h + "</div>";
    }
    var flagged = upload.issues.length, skipped = upload.issues.filter(function (x) { return x.skip; }).length, keep = upload.total - skipped;
    h += '<section class="upsum"><div class="upsum__f">' + esc(upload.name) + '</div><div class="upsum__g">' +
      '<div><div class="v" style="color:var(--ink-900)">' + upload.total + '</div><div class="l">rows read</div></div>' +
      '<div><div class="v" style="color:var(--amber-600)">' + flagged + '</div><div class="l">need a look</div></div>' +
      '<div><div class="v" style="color:var(--green-700)">' + keep + '</div><div class="l">will be published</div></div></div></section>';
    if (flagged) {
      h += '<div class="uph caps">Rows that need a look</div><div class="issues">' + upload.issues.map(function (it, i) {
        return '<div class="issue' + (it.skip ? " is-skip" : "") + '"><div class="issue__t"><div class="issue__n">' + esc(it.title) + '</div><div class="issue__m">' + esc(it.msg) + "</div></div>" +
          '<label class="ds-switch' + (it.locked ? " is-disabled" : "") + '"><button type="button" role="switch" aria-checked="' + it.skip + '" data-skip="' + i + '"' + (it.locked ? " disabled" : "") +
          '><span></span></button>Skip this row</label></div>';
      }).join("") + "</div>";
    }
    if (uploadError) h += '<div class="alert" role="alert" style="margin-top:20px">' + esc(uploadError) + "</div>";
    h += '<div class="upgo"><button type="button" class="ds-btn ds-btn--lg" id="publish"' + (keep ? "" : " disabled") + ">Publish " + keep + ' rows</button><button type="button" class="ds-btn ds-btn--ghost ds-btn--lg" id="another">Choose another file</button></div>';
    return h + "</div>";
  }
  function post(url, fd) {
    return fetch(url, { method: "POST", body: fd, credentials: "same-origin", headers: { "X-Requested-With": "sac" } }).then(function (r) {
      if (r.status === 401) { location.assign(CFG.login); throw new Error("auth"); }
      return r.json();
    });
  }
  function readFile(f) {
    if (!f) return;
    if (f.size > CFG.maxBytes) { uploadError = "This file is too large (4 MB max)."; render(); return; }
    var fd = new FormData(); fd.append("file", f);
    uploadError = "";
    post(CFG.preview, fd).then(function (d) {
      if (!d.ok) { uploadError = d.error; upload = null; render(); return; }
      upload = { file: f, name: d.name, total: d.total, issues: d.issues }; render();
    }).catch(function (e) { if (e.message !== "auth") { uploadError = "Could not reach the server. Try again."; render(); } });
  }
  function bindUpload() {
    var input = document.getElementById("file"), drop = document.getElementById("drop");
    if (input) input.addEventListener("change", function () { readFile(input.files[0]); input.value = ""; });
    if (drop) {
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("is-over"); });
      drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("is-over"); readFile(e.dataTransfer.files[0]); });
    }
    app.querySelectorAll("[data-skip]").forEach(function (b) {
      b.addEventListener("click", function () { var it = upload.issues[+b.dataset.skip]; if (!it.locked) { it.skip = !it.skip; render(); } });
    });
    var another = document.getElementById("another");
    if (another) another.addEventListener("click", function () { upload = null; uploadError = ""; render(); });
    var pub = document.getElementById("publish");
    if (pub) pub.addEventListener("click", function () {
      pub.disabled = true; pub.textContent = "Publishing…";
      var fd = new FormData(); fd.append("file", upload.file);
      fd.append("skip", JSON.stringify(upload.issues.filter(function (x) { return x.skip; }).map(function (x) { return x.line; })));
      post(CFG.publish, fd).then(function (d) {
        if (!d.ok) { uploadError = d.error; render(); return; }
        ROWS = d.rows; upload = null; uploadError = "";
        document.getElementById("updated").textContent = d.updated || "";
        toast(d.published + " rows published.");
        go("home", []);
      }).catch(function (e) { if (e.message !== "auth") { uploadError = "Could not reach the server. Try again."; render(); } });
    });
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200);
  }

  // ----------------------------------------------------------------- render
  function render() {
    var r = route();
    if (r.mode === "home") { app.innerHTML = homeHtml(); document.title = "SAC portal · Swachha Andhra Corporation"; return; }
    if (r.mode === "upload") { app.innerHTML = uploadHtml(); bindUpload(); return; }
    app.innerHTML = viewHtml(r.mode, r.path);
    var fq = document.getElementById("fq");
    if (fq) fq.addEventListener("input", function () {
      ui.q = fq.value; var pos = fq.selectionStart; render();
      var n = document.getElementById("fq"); n.focus(); n.setSelectionRange(pos, pos);
    });
    var fp = document.getElementById("fp"); if (fp) fp.addEventListener("change", function () { ui.fPhase = fp.value; render(); });
    var fa = document.getElementById("fa"); if (fa) fa.addEventListener("change", function () { ui.fAgency = fa.value; render(); });
    if (r.path.length >= LEVELS[r.mode].length) {
      var loc = r.path[r.path.length - 1];
      var row = ROWS.filter(function (x) { return x[0] === loc; })[0];
      if (live.loc !== loc) { live.loc = loc; live.site = ""; live.data = null; }
      liveStart(loc, row ? row[1] : "");
    }
  }
  render();
})();
