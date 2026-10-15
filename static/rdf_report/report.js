/* RDF disposal report — Save as PDF + gear panel (upload / list / remove daily trackers). */
(function () {
  "use strict";
  var cfg = JSON.parse(document.getElementById("rdf-report-config").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("panel"), input = $("files"), drop = $("drop"), msgs = $("msgs"), daysEl = $("days");
  var changed = false;

  $("print").addEventListener("click", function () { window.print(); });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function say(text, ok) { msgs.appendChild(el("div", "msg " + (ok ? "msg--ok" : "msg--err"), text)); }

  function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "X-Requested-With": "rdf-report" }, opts.headers || {});
    opts.credentials = "same-origin";
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "Unexpected reply from the server (" + r.status + ")." }; })
        .then(function (j) { if (j.auth === false) location.reload(); return j; });
    }, function () { return { ok: false, error: "Network error. Check the connection and try again." }; });
  }

  function loadDays() {
    api(cfg.api.trackers).then(function (j) {
      daysEl.textContent = "";
      if (!j.ok) { daysEl.appendChild(el("small", "c5", j.error || "Could not load.")); return; }
      if (!j.days.length) { daysEl.appendChild(el("small", "c5", "None yet.")); return; }
      j.days.forEach(function (d) {
        var row = el("div", "day");
        var left = el("span");
        left.appendChild(el("span", "c9", d.label + " "));
        left.appendChild(el("small", null, "· " + d.sites + " sites" + (d.uploaded ? " · uploaded " + d.uploaded : "")));
        row.appendChild(left);
        row.appendChild(el("span"));
        var rm = el("button", null, "Remove");
        rm.type = "button";
        rm.addEventListener("click", function () {
          if (!confirm("Remove the " + d.label + " tracker from the report? The graphs will drop this day.")) return;
          api(cfg.api["delete"], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: d.date }) })
            .then(function (r) { if (r.ok) { changed = true; loadDays(); } else say(r.error || "Could not remove.", false); });
        });
        row.appendChild(rm);
        daysEl.appendChild(row);
      });
    });
  }

  function upload(files) {
    if (!files || !files.length) return;
    var total = 0, fd = new FormData();
    Array.prototype.forEach.call(files, function (f) { total += f.size; fd.append("files", f, f.name); });
    if (total > cfg.maxBytes) { say("Files are too large (8 MB max per upload).", false); return; }
    msgs.textContent = "";
    say("Uploading " + files.length + " file" + (files.length > 1 ? "s" : "") + "…", true);
    api(cfg.api.upload, { method: "POST", body: fd }).then(function (j) {
      msgs.textContent = "";
      if (!j.results) { say(j.error || "Upload failed.", false); return; }
      j.results.forEach(function (r) {
        if (r.ok) { changed = true; say(r.file + ": " + r.label + ", " + r.sites + " sites" + (r.replaced ? " (replaced that day)" : " added") + ".", true); }
        else say(r.file + ": " + r.error, false);
      });
      loadDays();
    });
    input.value = "";
  }

  $("gear").addEventListener("click", function () {
    msgs.textContent = "";
    loadDays();
    if (panel.showModal) panel.showModal(); else panel.setAttribute("open", "");
  });
  $("panel-close").addEventListener("click", function () { panel.close ? panel.close() : panel.removeAttribute("open"); });
  // Rebuild the report with the new day(s) once the panel is closed.
  panel.addEventListener("close", function () { if (changed) location.reload(); });

  input.addEventListener("change", function () { upload(input.files); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
  });
  drop.addEventListener("drop", function (e) { upload(e.dataTransfer && e.dataTransfer.files); });
})();
