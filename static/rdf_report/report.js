/* RDF disposal report — gear panel.
   Picking (or dropping) a tracker CSV is the only action: it uploads, the server
   re-renders the report, the page swaps in the new sheet, and the export-ready
   PDF downloads — no second click. */
(function () {
  "use strict";
  var cfg = JSON.parse(document.getElementById("rdf-report-config").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("panel"), input = $("files"), drop = $("drop"), msgs = $("msgs"), daysEl = $("days");
  var slot = $("sheet-slot"), pdfBtn = $("pdf"), toast = $("toast");
  var busy = false, toastTimer = null;

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

  // Swap in the server-rendered sheet and point "Save as PDF" at the new day.
  function applySheet(j) {
    if (j.sheet_html == null) return;
    slot.innerHTML = j.sheet_html;
    if (j.pdf_url) { pdfBtn.href = j.pdf_url; pdfBtn.hidden = false; } else pdfBtn.hidden = true;
    document.title = "RDF disposal report" + (j.rep_label ? " · " + j.rep_label : "");
  }

  // Fetch the PDF as a blob and save it — works after an async upload, and errors are visible.
  function downloadPdf(url, name) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("PDF " + r.status);
      return r.blob();
    }).then(function (b) {
      var u = URL.createObjectURL(b), a = el("a");
      a.href = u; a.download = name || "RDF_disposal_report.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
    });
  }

  function renderDays(days) {
    daysEl.textContent = "";
    if (!days.length) { daysEl.appendChild(el("small", "c5", "None yet.")); return; }
    days.forEach(function (d) {
      var row = el("div", "day"), left = el("span");
      left.appendChild(el("span", "c9", d.label + " "));
      left.appendChild(el("small", null, "· " + d.sites + " sites" + (d.uploaded ? " · uploaded " + d.uploaded : "")));
      row.appendChild(left);
      row.appendChild(el("span"));
      var rm = el("button", null, "Remove");
      rm.type = "button";
      rm.addEventListener("click", function () {
        if (!confirm("Remove the " + d.label + " tracker from the report? The graphs will drop this day.")) return;
        api(cfg.api["delete"], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: d.date }) })
          .then(function (r) {
            if (!r.ok) { say(r.error || "Could not remove.", false); return; }
            applySheet(r);
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
    input.value = "";
    msgs.textContent = "";
    if (total > cfg.maxBytes) { say("Files are too large (8 MB max per upload).", false); return; }

    busy = true;
    drop.classList.add("is-over");
    slot.classList.add("is-busy");
    say("Processing " + files.length + " file" + (files.length > 1 ? "s" : "") + "…", true);

    api(cfg.api.upload, { method: "POST", body: fd }).then(function (j) {
      msgs.textContent = "";
      var failed = (j.results || []).filter(function (r) { return !r.ok; });
      if (!j.ok) {
        if (!j.results) say(j.error || "Upload failed.", false);
        failed.forEach(function (r) { say(r.file + ": " + r.error, false); });
        return null;
      }
      applySheet(j);
      loadDays();
      (j.results || []).forEach(function (r) {
        say(r.ok ? r.file + ": " + r.label + ", " + r.sites + " sites" + (r.replaced ? " (replaced that day)." : " added.")
                 : r.file + ": " + r.error, r.ok);
      });
      if (!failed.length) closePanel();          // all good: show the updated report
      window.scrollTo({ top: 0, behavior: "smooth" });
      return downloadPdf(j.pdf_url, j.pdf_name).then(function () {
        notify("Report updated to " + j.rep_label + " · PDF downloaded", true);
      }, function () {
        notify("Report updated to " + j.rep_label + ". The PDF did not download. Use Save as PDF.", false);
      });
    }).then(function () {
      busy = false;
      drop.classList.remove("is-over");
      slot.classList.remove("is-busy");
    });
  }

  $("gear").addEventListener("click", function () { if (!busy) msgs.textContent = ""; loadDays(); openPanel(); });
  $("panel-close").addEventListener("click", closePanel);
  input.addEventListener("change", function () { upload(input.files); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); if (!busy) drop.classList.remove("is-over"); });
  });
  drop.addEventListener("drop", function (e) { upload(e.dataTransfer && e.dataTransfer.files); });
})();
