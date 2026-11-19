/* RDF disposal dashboard.
   Tabs (Overview, Agencies, Sites, Date range, Report), site filters/sort, date-range
   progress, WhatsApp summary, and the gear panel. Picking (or dropping) a tracker CSV
   is the only action needed: it uploads, the server re-renders every tab, the page
   swaps them in, and the export-ready PDF downloads. Handlers are delegated from
   document so they keep working after the tabs are swapped. */
(function () {
  "use strict";
  var cfg = JSON.parse(document.getElementById("rdf-report-config").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("panel"), input = $("files"), drop = $("drop"), msgs = $("msgs"), daysEl = $("days");
  var sheetSlot = $("sheet-slot"), dashSlot = $("dash-slot"), pdfBtn = $("pdf"), toast = $("toast");
  var busy = false, toastTimer = null;
  var state = { tab: "overview", filter: "all", sort: null, dir: -1, q: "" };
  var phase = cfg.phase || "all";
  var editDlg = $("edit"), editForm = $("edit-form"), editing = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function say(text, ok) { msgs.appendChild(el("div", "msg " + (ok ? "msg--ok" : "msg--err"), text)); }
  function notify(text, ok) {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.className = "toast" + (ok ? "" : " toast--err");
    toast.hidden = false;
    toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  }
  function openPanel() { if (panel.showModal) { if (!panel.open) panel.showModal(); } else panel.setAttribute("open", ""); }
  function closePanel() { if (panel.close) { if (panel.open) panel.close(); } else panel.removeAttribute("open"); }

  function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "X-Requested-With": "rdf-report" }, opts.headers || {});
    opts.credentials = "same-origin";
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "Unexpected reply from the server (" + r.status + ")." }; })
        .then(function (j) { if (j.auth === false) location.reload(); return j; });
    }, function () { return { ok: false, error: "Network error. Check the connection and try again." }; });
  }

  // ---------------------------------------------------------------- tabs
  var TABS = ["overview", "agencies", "sites", "range", "report"];
  function showTab(name, push) {
    if (TABS.indexOf(name) < 0) name = "overview";
    state.tab = name;
    document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === name)); });
    document.querySelectorAll(".tabpanel").forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    if (push !== false && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }

  // ---------------------------------------------------------------- sites table
  function applySites() {
    var table = $("site-table");
    if (!table) return;
    var rows = Array.prototype.slice.call(table.tBodies[0].rows), shown = 0, q = state.q.trim().toLowerCase();
    rows.forEach(function (tr) {
      var f = " " + tr.dataset.f + " ";
      var ok = (state.filter === "all" || f.indexOf(" " + state.filter + " ") >= 0) && (!q || tr.dataset.site.indexOf(q) >= 0);
      tr.hidden = !ok;
      if (ok) shown++;
    });
    if (state.sort) {
      var k = state.sort, dir = state.dir, text = k === "site" || k === "agency";
      rows.sort(function (a, b) {
        var x = a.dataset["v" + k[0].toUpperCase() + k.slice(1)], y = b.dataset["v" + k[0].toUpperCase() + k.slice(1)];
        if (text) return dir * x.localeCompare(y);
        return dir * (parseFloat(x) - parseFloat(y));
      }).forEach(function (tr) { table.tBodies[0].appendChild(tr); });
    }
    table.querySelectorAll("th[data-sort]").forEach(function (th) {
      th.setAttribute("aria-sort", th.dataset.sort === state.sort ? (state.dir > 0 ? "ascending" : "descending") : "none");
    });
    document.querySelectorAll("#site-chips .chip").forEach(function (c) { c.classList.toggle("is-on", c.dataset.filter === state.filter); });
    var chip = document.querySelector('#site-chips .chip[data-filter="' + state.filter + '"]');
    var label = chip ? chip.textContent.replace(/\s+\d+\s*$/, "").trim() : "all";
    var note = $("site-note");
    if (note) note.textContent = "Showing " + shown + " site" + (shown === 1 ? "" : "s") +
      (state.filter === "all" ? "" : " · " + label) + (q ? " matching “" + state.q + "”" : "") + ". Click a column to sort.";
    var search = $("site-search");
    if (search && search.value !== state.q) search.value = state.q;
  }
  function gotoSites(filter) {
    state.filter = filter;
    // Sensible default order per list.
    state.sort = { quick: "bal", long: "bal", stalled: "bal", active: "today" }[filter] || state.sort;
    state.dir = filter === "quick" ? 1 : -1;
    showTab("sites");
    applySites();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------------------------------------------------------- date range
  function runRange() {
    var f = $("range-from").value, t = $("range-to").value, out = $("range-out");
    if (!f || !t) return;
    out.classList.add("is-busy");
    api(cfg.api.range + "?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t) + "&phase=" + phase).then(function (j) {
      out.classList.remove("is-busy");
      if (j.html != null) out.innerHTML = j.html;
      else out.innerHTML = "", out.appendChild(el("div", "card empty", j.error || "Could not load."));
    });
  }
  function quickRange(days) {
    var to = $("range-to"), from = $("range-from");
    to.value = to.max;
    if (days === "all") from.value = from.min;
    else {
      var d = new Date(to.max + "T00:00:00");
      d.setDate(d.getDate() - (parseInt(days, 10) - 1));
      var iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      from.value = iso < from.min ? from.min : iso;
    }
    runRange();
  }

  // ---------------------------------------------------------------- swap in fresh render
  function applyAll(j) {
    if (j.sheet_html == null) return;
    sheetSlot.innerHTML = j.sheet_html;
    if (j.dash_html != null) dashSlot.innerHTML = j.dash_html;
    if (j.pdf_url) { pdfBtn.href = j.pdf_url; pdfBtn.hidden = false; } else pdfBtn.hidden = true;
    document.title = "RDF disposal dashboard" + (j.rep_label ? " · " + j.rep_label : "");
    if (j.range && j.range.max) {
      ["range-from", "range-to"].forEach(function (id) { $(id).min = j.range.min; $(id).max = j.range.max; });
      if (!$("range-to").value || $("range-to").value > j.range.max || $("range-to").value === $("range-to").dataset.lastMax)
        $("range-to").value = j.range.max;
      $("range-to").dataset.lastMax = j.range.max;
      runRange();
    }
    (j.phases || []).forEach(function (p) {
      var a = document.querySelector('.phase[data-phase="' + p.code + '"] small');
      if (a) a.textContent = p.count;
    });
    showTab(state.tab, false);
    applySites();
  }
  function postJSON(url, body) {
    body.phase = phase;
    return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  // ---------------------------------------------------------------- details (site / agency / phase, all phases)
  var detailDlg = $("detail"), detailStack = [];
  function openDetail(kind, key, back) {
    var body = $("detail-body");
    if (!back) detailStack.push([kind, key]);
    $("detail-back").hidden = detailStack.length < 2;
    body.classList.add("is-busy");
    if (!detailDlg.open) { if (detailDlg.showModal) detailDlg.showModal(); else detailDlg.setAttribute("open", ""); }
    api(cfg.api.detail + "?kind=" + encodeURIComponent(kind) + "&key=" + encodeURIComponent(key)).then(function (j) {
      body.classList.remove("is-busy");
      $("detail-title").textContent = j.ok ? ({ site: "Site", agency: "Agency", phase: "Phase" }[kind] + ": " + j.title) : "Details";
      if (j.ok) body.innerHTML = j.html;
      else { body.textContent = ""; body.appendChild(el("div", "msg msg--err", j.error || "Could not load.")); }
    });
  }
  function closeDetail() { detailStack = []; if (detailDlg.close) { if (detailDlg.open) detailDlg.close(); } else detailDlg.removeAttribute("open"); }

  // ---------------------------------------------------------------- quick edit
  var NUM = ["today", "cum", "bal"], FIELDS = ["site", "agency", "phase"].concat(NUM);
  function openEdit(b) {
    editing = { sid: b.dataset.edit, tracked: !!b.dataset.eTracked, orig: {} };
    FIELDS.forEach(function (f) {
      var v = b.dataset["e" + f[0].toUpperCase() + f.slice(1)] || "";
      editing.orig[f] = v;
      editForm.elements[f].value = v;
    });
    editForm.querySelectorAll("[data-tracked]").forEach(function (l) { l.hidden = !editing.tracked; });
    $("edit-title").textContent = "Edit " + editing.orig.site;
    $("edit-note").textContent = editing.tracked
      ? "Figures change the latest report day only; uploading that day's sheet again replaces them. Name, agency and phase apply to every day."
      : "This site isn't in the daily tracker: its 'To date' is the final figure from the phase sheet.";
    $("edit-msg").textContent = "";
    if (editDlg.showModal) editDlg.showModal(); else editDlg.setAttribute("open", "");
    editForm.elements.site.focus();
  }
  function closeEdit() { if (editDlg.close) { if (editDlg.open) editDlg.close(); } else editDlg.removeAttribute("open"); editing = null; }
  function saveEdit(e) {
    e.preventDefault();
    if (!editing) return;
    var changes = {}, n = 0;
    FIELDS.forEach(function (f) {
      if (!editing.tracked && (f === "today" || f === "bal")) return;
      var v = editForm.elements[f].value.trim();
      var same = NUM.indexOf(f) >= 0 ? Math.abs(parseFloat(v.replace(/,/g, "")) - parseFloat(editing.orig[f])) < 0.005 : v === editing.orig[f];
      if (!same) { changes[f] = v; n++; }
    });
    if (!n) { closeEdit(); return; }
    var msg = $("edit-msg");
    msg.textContent = "Saving…";
    postJSON(cfg.api.edit, { sid: editing.sid, changes: changes }).then(function (j) {
      if (!j.ok) { msg.textContent = ""; msg.appendChild(el("div", "msg msg--err", j.error || "Could not save.")); return; }
      closeEdit();
      applyAll(j);
      notify("Saved. Undo it from the gear panel if needed.", true);
    });
  }

  // ---------------------------------------------------------------- master sheet (gear panel)
  function loadEdits() {
    var box = $("edits"), un = $("unassigned");
    api(cfg.api.edits).then(function (j) {
      box.textContent = ""; un.textContent = "";
      if (!j.ok) { box.appendChild(el("small", "c5", j.error || "Could not load.")); return; }
      $("sheet-src").textContent = j.sheet;
      if (j.unassigned && j.unassigned.length) {
        var w = el("div", "msg msg--err");
        w.appendChild(el("b", null, j.unassigned.length + " tracker row" + (j.unassigned.length > 1 ? "s" : "") + " could not be matched to a phase: "));
        w.appendChild(document.createTextNode(j.unassigned.map(function (u) { return u.site + " (" + u.agency + ", " + u.awarded + " MT awarded)"; }).join("; ") +
          ". Open the 'Needs a phase' tab and use the pencil to pick one."));
        un.appendChild(w);
      }
      if (!j.edits.length) { box.appendChild(el("small", "c5", "No edits yet.")); return; }
      j.edits.forEach(function (e) {
        var row = el("div", "day" + (e.undone ? " is-undone" : "")), left = el("span");
        left.appendChild(el("span", "c9", e.site + " "));
        left.appendChild(el("small", null, "· " + e.field + ": " + e.old + " → " + e.new + (e.day ? " (" + e.day + ")" : "") + " · " + e.at));
        row.appendChild(left);
        row.appendChild(el("span"));
        if (e.undone) { row.appendChild(el("small", "c5", "undone")); box.appendChild(row); return; }
        var b = el("button", null, "Undo");
        b.type = "button";
        b.addEventListener("click", function () {
          postJSON(cfg.api.undo, { id: e.id }).then(function (r) {
            if (!r.ok) { say(r.error || "Could not undo.", false); return; }
            applyAll(r); loadEdits(); notify("Edit undone.", true);
          });
        });
        row.appendChild(b);
        box.appendChild(row);
      });
    });
  }
  function uploadSheet(file) {
    if (!file) return;
    var fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("phase", phase);
    msgs.textContent = "";
    say("Reading the phase sheet…", true);
    api(cfg.api.sheet, { method: "POST", body: fd }).then(function (j) {
      msgs.textContent = "";
      if (!j.ok) { say(j.error || "Could not use that file.", false); return; }
      say("Phase sheet replaced: " + j.rows + " rows.", true);
      applyAll(j); loadEdits();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {          // http://localhost fallback
      var ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(e); }
      ta.remove();
    });
  }

  // Fetch the PDF as a blob and save it — works after an async upload, and errors are visible.
  function downloadPdf(url, name) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("PDF " + r.status);
      return r.blob();
    }).then(function (b) {
      var u = URL.createObjectURL(b), a = el("a");
      a.href = u; a.download = name || "Daily_RDF_tracker.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
    });
  }

  // ---------------------------------------------------------------- gear panel
  function renderDays(days) {
    daysEl.textContent = "";
    if (!days.length) { daysEl.appendChild(el("small", "c5", "None yet.")); return; }
    days.forEach(function (d) {
      var row = el("div", "day"), left = el("span");
      left.appendChild(el("span", "c9", d.label + " "));
      left.appendChild(el("small", null, "· " + d.sites + " sites" +
        (d.builtin ? " · built-in history" : d.uploaded ? " · uploaded " + d.uploaded : "") +
        (d.overrides_builtin ? " (replaces built-in)" : "")));
      row.appendChild(left);
      row.appendChild(el("span"));
      if (d.builtin) { row.appendChild(el("span")); daysEl.appendChild(row); return; }
      var rm = el("button", null, "Remove");
      rm.type = "button";
      rm.addEventListener("click", function () {
        if (!confirm(d.overrides_builtin
          ? "Remove your " + d.label + " upload? The built-in sheet for that day will be used again."
          : "Remove the " + d.label + " tracker from the report? The graphs will drop this day.")) return;
        postJSON(cfg.api["delete"], { date: d.date })
          .then(function (r) {
            if (!r.ok) { say(r.error || "Could not remove.", false); return; }
            applyAll(r);
            loadDays();
          });
      });
      row.appendChild(rm);
      daysEl.appendChild(row);
    });
  }
  function loadDays() {
    api(cfg.api.trackers).then(function (j) {
      if (!j.ok) { daysEl.textContent = ""; daysEl.appendChild(el("small", "c5", j.error || "Could not load.")); return; }
      renderDays(j.days);
    });
  }

  function upload(files) {
    if (!files || !files.length || busy) return;
    var total = 0, fd = new FormData();
    Array.prototype.forEach.call(files, function (f) { total += f.size; fd.append("files", f, f.name); });
    fd.append("phase", phase);
    input.value = "";
    msgs.textContent = "";
    if (total > cfg.maxBytes) { say("Files are too large (8 MB max per upload).", false); return; }

    busy = true;
    drop.classList.add("is-over");
    dashSlot.classList.add("is-busy");
    sheetSlot.classList.add("is-busy");
    say("Processing " + files.length + " file" + (files.length > 1 ? "s" : "") + "…", true);

    api(cfg.api.upload, { method: "POST", body: fd }).then(function (j) {
      msgs.textContent = "";
      var failed = (j.results || []).filter(function (r) { return !r.ok; });
      if (!j.ok) {
        if (!j.results) say(j.error || "Upload failed.", false);
        failed.forEach(function (r) { say(r.file + ": " + r.error, false); });
        return null;
      }
      applyAll(j);
      loadDays();
      (j.results || []).forEach(function (r) {
        say(r.ok ? r.file + " (" + r.kind + "): filed under " + r.label + ", " + r.sites + " rows" +
                   (r.replaced ? ". It REPLACED the " + r.label + " already on file; if that's the wrong day, check the date in the 'Disposed on' column." : ", added.")
                 : r.file + ": " + r.error, r.ok);
      });
      if (!failed.length) closePanel();          // all good: show the updated dashboard
      window.scrollTo({ top: 0, behavior: "smooth" });
      return downloadPdf(j.pdf_url, j.pdf_name).then(function () {
        notify("Dashboard updated to " + j.rep_label + " · PDF downloaded", true);
      }, function () {
        notify("Dashboard updated to " + j.rep_label + ". The PDF did not download. Use Save as PDF.", false);
      });
    }).then(function () {
      busy = false;
      drop.classList.remove("is-over");
      dashSlot.classList.remove("is-busy");
      sheetSlot.classList.remove("is-busy");
    });
  }

  // ---------------------------------------------------------------- events (delegated)
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-detail], [data-tab], [data-goto], [data-filter], th[data-sort], #gist-copy, [data-days], [data-edit], a[data-phase]");
    if (!t) return;
    if (t.dataset.detail) { e.preventDefault(); e.stopPropagation(); return openDetail(t.dataset.detail, t.dataset.key); }
    if (t.dataset.edit) return openEdit(t);
    if (t.dataset.phase) { e.preventDefault(); location.href = "?phase=" + t.dataset.phase + "#" + state.tab; return; }
    if (t.dataset.tab) return showTab(t.dataset.tab);
    if (t.dataset.goto) return gotoSites(t.dataset.goto);
    if (t.dataset.filter) { state.filter = t.dataset.filter; return applySites(); }
    if (t.dataset.days) return quickRange(t.dataset.days);
    if (t.dataset.sort) {
      var k = t.dataset.sort;
      state.dir = state.sort === k ? -state.dir : (k === "site" || k === "agency" ? 1 : -1);
      state.sort = k;
      return applySites();
    }
    if (t.id === "gist-copy") {
      var txt = $("gist-text");
      copyText(txt ? txt.textContent : "").then(function () { notify("Summary copied. Paste it in WhatsApp.", true); },
        function () { notify("Could not copy. Select the text and copy it.", false); });
    }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "site-search") { state.q = e.target.value; applySites(); }
  });
  $("range-form").addEventListener("change", runRange);
  $("range-form").addEventListener("submit", function (e) { e.preventDefault(); runRange(); });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest(".tbl--click tr[data-goto]") && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); gotoSites(e.target.closest("tr").dataset.goto);
    }
  });
  window.addEventListener("hashchange", function () { showTab(location.hash.slice(1), false); });

  $("gear").addEventListener("click", function () { if (!busy) msgs.textContent = ""; loadDays(); loadEdits(); openPanel(); });
  $("sheet-file").addEventListener("change", function () { uploadSheet(this.files[0]); this.value = ""; });
  editForm.addEventListener("submit", saveEdit);
  $("detail-close").addEventListener("click", closeDetail);
  $("detail-back").addEventListener("click", function () {
    detailStack.pop();
    var prev = detailStack[detailStack.length - 1];
    if (prev) openDetail(prev[0], prev[1], true);
  });
  detailDlg.addEventListener("close", function () { detailStack = []; });
  detailDlg.addEventListener("click", function (e) { if (e.target === detailDlg) closeDetail(); });
  $("edit-close").addEventListener("click", closeEdit);
  $("edit-cancel").addEventListener("click", closeEdit);
  $("panel-close").addEventListener("click", closePanel);
  input.addEventListener("change", function () { upload(input.files); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); if (!busy) drop.classList.remove("is-over"); });
  });
  drop.addEventListener("drop", function (e) { upload(e.dataTransfer && e.dataTransfer.files); });

  // Ctrl/Cmd+P prints the Report tab (the PDF layout), whatever tab is open.
  var before = null;
  window.addEventListener("beforeprint", function () { before = state.tab; showTab("report", false); });
  window.addEventListener("afterprint", function () { if (before) showTab(before, false); });

  showTab(location.hash.slice(1) || "overview", false);
  applySites();
})();
