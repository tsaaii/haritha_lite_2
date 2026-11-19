"""
RDF disposal dashboard — tabs Overview / Agencies / Sites / Date range / Report,
where Report is the daily printable sheet (and its PDF) for Swachha Andhra Corporation.

    GET  /rdf/                 -> the report (PIN + captcha page if not signed in)
    POST /rdf/login            -> {pin, captcha_answer, captcha_nonce} form post
    GET  /rdf/logout
    GET  /rdf/report.pdf       -> export-ready A4 PDF: Daily_RDF_tracker_DD-MM-YYYY.pdf
    GET  /rdf/api/gist         -> {text}: WhatsApp summary of who sent RDF on the report day
    GET  /rdf/api/range        -> ?from&to: agency progress between two dates (HTML fragment)
    GET  /rdf/api/trackers     -> days on file (gear panel)
    POST /rdf/api/upload       -> multipart "files": one or more daily tracker CSVs;
                                  replies with the re-rendered report sheet, gist + PDF link
                                  so one upload updates the page and downloads the PDF
    POST /rdf/api/delete       -> {date: "YYYY-MM-DD"}
    POST /rdf/api/edit         -> {sid, changes: {today|cum|bal|agency|phase|site: value}}: quick edit
    POST /rdf/api/undo         -> {id}: undo one quick edit
    GET  /rdf/api/edits        -> recent quick edits + rows that still need a phase (gear panel)
    GET  /rdf/api/master.csv   -> the master sheet ("true copy"): every site of every phase, latest day
    POST /rdf/api/phase-sheet  -> multipart "file": replace the phase sheet (data/rdf_master.py)

Every page and API takes ?phase=all|p3|p2|p1x|p1|old (default all): the same tabs, charts and
PDF for one phase, or for all phases together. See data/rdf_master.py for how phases are built.

Also /RDF, and the old /rdf_report/ address redirects here. On the rdf.* host
(rdf.advitiaum.com) the report is also served at "/".

Sign-in: the shared PIN book (pins.py, also used by /sac and /reports) + the math captcha
and per-IP lockout from captcha.py (5 wrong tries -> 15 minutes). Until pin.yaml exists the
built-in PIN in pins.py is the one PIN.
Data lives in RDF_TRACKER_DIR; see data/rdf_tracker.py and docs/rdf-report.md.
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from functools import wraps

from flask import Blueprint, Response, jsonify, make_response, redirect, render_template, request, session, url_for

import captcha
import pins
from data import rdf_dashboard, rdf_master, rdf_report, rdf_report_pdf, rdf_tracker

logger = logging.getLogger(__name__)
bp = Blueprint("rdf_report", __name__, template_folder="../templates")

URL_PREFIX = "/rdf"
SESSION_KEY = "rdf_report_ok"
HOST_PREFIX = "rdf."
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


def _signed_in() -> bool:
    return bool(session.get(SESSION_KEY))


def _api(view):
    """JSON endpoints: signed in, and called from our own page (blocks plain cross-site form posts)."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not _signed_in():
            return jsonify(ok=False, auth=False, error="Please sign in again."), 401
        if request.method == "POST" and request.headers.get("X-Requested-With") != "rdf-report":
            return jsonify(ok=False, error="Bad request."), 400
        return view(*args, **kwargs)
    return wrapped


def _no_cache(body):
    resp = make_response(body)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Robots-Tag"] = "noindex"
    return resp


# ---------------------------------------------------------------------------
# rdf.advitiaum.com -> report at "/"
# ---------------------------------------------------------------------------

@bp.before_app_request
def _rdf_host_root():
    if request.path == "/" and request.host.lower().startswith(HOST_PREFIX):
        return report_view()
    return None


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@bp.route(URL_PREFIX)
@bp.route("/RDF")
@bp.route("/RDF/")
@bp.route("/rdf_report")
@bp.route("/rdf_report/")
def root():
    return redirect(url_for("rdf_report.report_view"), code=301)


def _load() -> tuple[list, str]:
    try:
        return rdf_tracker.history(), ""
    except Exception:
        logger.exception("rdf_report: could not load trackers")
        return [], "Could not read the uploaded trackers. Try again in a minute."


PHASE_CODES = [k for k, _ in rdf_master.PHASES]


def _phase(value: str | None = None) -> str:
    p = (value if value is not None else request.args.get("phase") or "").strip().lower()
    return p if p in PHASE_CODES or p == "un" else "all"


def _extras(phase: str) -> list[str] | None:
    """Agencies listed before they reach the tracker belong to the current phase only."""
    return None if phase in ("all", "p3") else []


def _book(hist):
    return rdf_master.book(hist)


def _phase_view(hist, phase: str, b=None):
    """(phase history, report, latest all-phases day for the WhatsApp summary)."""
    b = b or _book(hist)
    v = rdf_master.view(hist, phase, b)
    all_last = rdf_master.view(hist[-1:], "all", b)[0] if hist else None
    r = rdf_report.build(v, rdf_master.PHASE_LABEL.get(phase, ""), _extras(phase), all_last) if v else None
    return v, r, b


def _report(phase: str) -> tuple[dict | None, str]:
    """(report view model or None if no days on file, error message)."""
    hist, err = _load()
    if not hist:
        return None, err
    try:
        return _phase_view(hist, phase)[1], err
    except Exception:
        logger.exception("rdf_report: could not build the %s view", phase)
        return None, "Could not build the report. Try again in a minute."


def _views(phase: str) -> dict:
    """Everything the page needs: report sheet (r), dashboard tabs (d), default date range (g)."""
    hist, err = _load()
    empty = {"r": None, "d": None, "g": None, "load_error": err, "range_min": "", "range_max": "",
             "range_from": "", "range_to": "", "phase": phase, "phases": [], "unassigned": 0}
    if not hist:
        return empty
    try:
        v, r, b = _phase_view(hist, phase)
        counts = rdf_master.phase_counts(hist, b)
    except Exception:
        logger.exception("rdf_report: could not build the %s view", phase)
        return dict(empty, load_error="Could not build the dashboard (phase sheet or edits unreadable). "
                                      "Try again, or check the gear panel.")
    first, last = v[0].date, v[-1].date
    start = max(first, last - timedelta(days=6))
    phases = [{"code": k, "label": lbl, "count": counts.get(k, 0)} for k, lbl in rdf_master.PHASES]
    if counts.get("un"):
        phases.append({"code": "un", "label": rdf_master.PHASE_LABEL["un"], "count": counts["un"]})
    return {"r": r, "d": rdf_dashboard.build(v, _extras(phase)), "g": rdf_dashboard.date_range(v, start, last),
            "load_error": err, "range_min": first.isoformat(), "range_max": last.isoformat(),
            "range_from": start.isoformat(), "range_to": last.isoformat(), "phase": phase, "phases": phases,
            "unassigned": counts.get("un", 0), "phase_options": [p for p in phases if p["code"] not in ("all", "un")]}


def _pdf_url(r: dict, phase: str) -> str:
    # ?d= makes each day's PDF a distinct URL so nothing serves a stale cached copy.
    return url_for("rdf_report.report_pdf", d=r["rep_iso"], phase=phase)


@bp.route(URL_PREFIX + "/")
def report_view():
    if not _signed_in():
        return _login_page()
    phase = _phase()
    v = _views(phase)
    return _no_cache(render_template(
        "rdf_report/report.html", **v, pdf_url=_pdf_url(v["r"], phase) if v["r"] else "",
        cfg={"api": {k: url_for(f"rdf_report.api_{k}") for k in
                     ("trackers", "upload", "delete", "gist", "range", "edit", "undo", "edits", "master", "sheet")},
             "maxBytes": MAX_UPLOAD_BYTES, "phase": phase},
    ))


def _login_page(error: str = "", status: int = 200):
    return _no_cache(render_template(
        "rdf_report/login.html", error=error,
        captcha_question=captcha.current_question(), captcha_nonce=captcha.current_nonce())), status


@bp.route(URL_PREFIX + "/login", methods=["POST"])
def login():
    ip = captcha.client_ip()
    blocked, retry = captcha.is_blocked(ip)
    if blocked:
        resp, _ = _login_page(f"Too many wrong tries. Try again in {max(1, retry // 60)} minute(s).", 429)
        resp.headers["Retry-After"] = str(retry)
        return resp, 429

    # Captcha first: it is cheap, and it keeps bots off the PIN check entirely.
    if not captcha.verify(request.form.get("captcha_answer", ""), nonce=request.form.get("captcha_nonce", "")):
        return _login_page("The security check answer was wrong. Try the new one.", 400)

    # One PIN for /sac, /reports and /rdf (pins.py); a good PIN signs in to all three.
    from views import sac
    p = pins.verify(request.form.get("pin") or "")
    if p is None:
        count, just_blocked = captcha.register_failure(ip)
        logger.info("rdf_report wrong PIN ip=%s count=%d", ip, count)
        if just_blocked:
            return _login_page(f"Too many wrong tries. Try again in {captcha.BLOCK_SECONDS // 60} minute(s).", 429)
        left = max(0, captcha.MAX_FAILURES - count)
        msg = "Incorrect PIN." + (f" {left} attempt(s) left." if left and left <= 2 else "")
        return _login_page(msg, 401)

    captcha.clear_failures(ip)
    sac.sign_in(p)
    # Back to wherever the PIN page was shown ("/" on rdf.*, else /rdf/).
    nxt = request.form.get("next") or ""
    return redirect(nxt if nxt in ("/", URL_PREFIX + "/") else url_for("rdf_report.report_view"))


@bp.route(URL_PREFIX + "/logout")
def logout():
    session.clear()     # one sign-in for /sac, /reports and /rdf, so one sign-out too
    return redirect("/" if request.host.lower().startswith(HOST_PREFIX) else url_for("rdf_report.report_view"))


@bp.route(URL_PREFIX + "/report.pdf")
def report_pdf():
    if not _signed_in():
        return redirect(url_for("rdf_report.report_view"))
    r, err = _report(_phase())
    if not r:
        return (err or "No daily trackers uploaded yet."), 404
    resp = Response(rdf_report_pdf.build_pdf(r), mimetype="application/pdf")
    resp.headers["Content-Disposition"] = f'attachment; filename="{rdf_report_pdf.filename(r)}"'
    return _no_cache(resp)


# ---------------------------------------------------------------------------
# Gear panel API
# ---------------------------------------------------------------------------

@bp.route(URL_PREFIX + "/api/gist")
@_api
def api_gist():
    r, err = _report("all")
    return _no_cache(jsonify(ok=bool(r), text=r["gist"] if r else "", error=err))


@bp.route(URL_PREFIX + "/api/range")
@_api
def api_range():
    """?from=YYYY-MM-DD&to=YYYY-MM-DD -> agency progress between the two dates (HTML fragment)."""
    try:
        start = date.fromisoformat(request.args.get("from", ""))
        end = date.fromisoformat(request.args.get("to", ""))
    except ValueError:
        return jsonify(ok=False, error="Pick both dates."), 400
    hist, err = _load()
    if hist:
        g = rdf_dashboard.date_range(rdf_master.view(hist, _phase(), _book(hist)), start, end)
    else:
        g = {"ok": False, "error": err or "No trackers on file."}
    return _no_cache(jsonify(ok=g["ok"], html=render_template("rdf_report/_range.html", g=g),
                             **{k: g.get(k) for k in ("from_iso", "to_iso")}))


@bp.route(URL_PREFIX + "/api/trackers")
@_api
def api_trackers():
    return _no_cache(jsonify(ok=True, days=rdf_tracker.listing()))


@bp.route(URL_PREFIX + "/api/upload", methods=["POST"])
@_api
def api_upload():
    if (request.content_length or 0) > MAX_UPLOAD_BYTES:
        return jsonify(ok=False, error="Files are too large (8 MB max per upload)."), 413
    files = request.files.getlist("files")
    if not files:
        return jsonify(ok=False, error="Choose at least one CSV file."), 400
    results = []
    for f in files:
        name = f.filename or "upload.csv"
        try:
            t, replaced = rdf_tracker.store(f.read(), name)
        except rdf_tracker.TrackerError as exc:
            results.append({"file": name, "ok": False, "error": str(exc)})
            continue
        except Exception:
            logger.exception("rdf_report upload failed for %s", name)
            results.append({"file": name, "ok": False, "error": "Could not save the file. Try again."})
            continue
        results.append({"file": name, "ok": True, "date": t.date.isoformat(),
                        "label": rdf_report.day(t.date) + f" {t.date.year}",
                        "sites": len(t.sites), "replaced": replaced})
    ok = any(x["ok"] for x in results)
    out = {"ok": ok, "results": results}
    if ok:
        out.update(_sheet_payload(_phase(request.form.get("phase"))))
        _snapshot()
    return jsonify(out)


def _snapshot():
    hist, _ = _load()
    if hist:
        rdf_master.save_snapshot(hist)


def _sheet_payload(phase: str) -> dict:
    """Fresh report sheet + dashboard tabs HTML + where to fetch the PDF, for in-place page updates."""
    v = _views(phase)
    r = v["r"]
    return {"sheet_html": render_template("rdf_report/_sheet.html", r=r),
            "dash_html": render_template("rdf_report/_dashboard.html", **v),
            "range": {"min": v["range_min"], "max": v["range_max"]},
            "rep_label": r["rep_label"] if r else "", "pdf_url": _pdf_url(r, phase) if r else "",
            "gist": r["gist"] if r else "", "gist_day": r["rep_day"] if r else "",
            "pdf_name": rdf_report_pdf.filename(r) if r else "", "unassigned": v["unassigned"],
            "phases": v["phases"]}


@bp.route(URL_PREFIX + "/api/delete", methods=["POST"])
@_api
def api_delete():
    body = request.get_json(silent=True) or {}
    d = str(body.get("date") or "")
    try:
        rdf_tracker.remove(d)
    except rdf_tracker.TrackerError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    _snapshot()
    return jsonify(ok=True, **_sheet_payload(_phase(str(body.get("phase") or ""))))


# ---------------------------------------------------------------------------
# Master sheet: quick edits, phase sheet, download
# ---------------------------------------------------------------------------

def _row(hist, sid: str):
    """The master row `sid` on the latest day, as currently shown (edits applied)."""
    b = _book(hist)
    for s in rdf_master.rows_for_day(b, hist[-1]):
        if s.sid == sid:
            return s
    return None


@bp.route(URL_PREFIX + "/api/edit", methods=["POST"])
@_api
def api_edit():
    body = request.get_json(silent=True) or {}
    sid, changes = str(body.get("sid") or ""), body.get("changes") or {}
    if not isinstance(changes, dict) or not changes:
        return jsonify(ok=False, error="Nothing to change."), 400
    hist, err = _load()
    if not hist:
        return jsonify(ok=False, error=err or "No trackers on file."), 400
    s = _row(hist, sid)
    if s is None:
        return jsonify(ok=False, error="That site is not on the latest day any more. Reload the page."), 404
    current = {"today": f"{s.today:.2f}", "cum": f"{s.cum:.2f}", "bal": f"{s.bal:.2f}", "agency": s.agency,
               "phase": s.phase, "site": s.site, "tracked": s.tracked}
    for f in ("today", "cum", "bal"):
        if f in changes:
            try:
                if abs(float(str(changes[f]).replace(",", "")) - float(current[f])) < 0.005:
                    changes.pop(f)
            except ValueError:
                pass
    try:
        made = rdf_master.add_edits(sid, changes, hist[-1].date, captcha.client_ip(), current)
    except rdf_master.EditError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except Exception:
        logger.exception("rdf_report: could not save edit")
        return jsonify(ok=False, error="Could not save the change. Try again."), 500
    _snapshot()
    return jsonify(ok=True, made=len(made), **_sheet_payload(_phase(str(body.get("phase") or ""))))


@bp.route(URL_PREFIX + "/api/undo", methods=["POST"])
@_api
def api_undo():
    body = request.get_json(silent=True) or {}
    try:
        rdf_master.undo_edit(str(body.get("id") or ""))
    except rdf_master.EditError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    _snapshot()
    return jsonify(ok=True, **_sheet_payload(_phase(str(body.get("phase") or ""))))


_FIELD = {"today": "Today", "cum": "To date", "bal": "Left", "agency": "Agency", "phase": "Phase", "site": "Site name"}


@bp.route(URL_PREFIX + "/api/edits")
@_api
def api_edits():
    hist, _ = _load()
    names = {}
    if hist:
        for s in rdf_master.rows_for_day(_book(hist), hist[-1]):
            names[s.sid] = f"{s.site} · {s.agency} · {rdf_master.PHASE_LABEL.get(s.phase, s.phase)}"
    items = []
    for e in reversed(rdf_master.edits()[-60:]):
        fmt_v = (lambda v: rdf_master.PHASE_LABEL.get(v, v)) if e["field"] == "phase" else (lambda v: v)
        items.append({"id": e["id"], "undone": e.get("undone", False), "field": _FIELD.get(e["field"], e["field"]),
                      "site": names.get(e["sid"], e["sid"]), "old": fmt_v(e.get("old", "")), "new": fmt_v(e.get("new", "")),
                      "day": e.get("day") or "", "at": e.get("at", "")[:16].replace("T", " ") + " UTC"})
    un = [{"sid": s.sid, "site": s.src, "agency": s.agency, "awarded": rdf_report.fmt(s.awarded)}
          for s in (rdf_master.unassigned(hist) if hist else [])]
    _, where = rdf_master.sheet_raw()
    return _no_cache(jsonify(ok=True, edits=items, unassigned=un, sheet=where))


@bp.route(URL_PREFIX + "/api/master.csv")
@_api
def api_master():
    hist, err = _load()
    body = rdf_master.master_csv(hist)
    stamp = hist[-1].date.strftime("%d-%m-%Y") if hist else "empty"
    resp = Response(body, mimetype="text/csv")
    resp.headers["Content-Disposition"] = f'attachment; filename="RDF_master_{stamp}.csv"'
    return _no_cache(resp)


@bp.route(URL_PREFIX + "/api/phase-sheet", methods=["POST"])
@_api
def api_sheet():
    f = request.files.get("file")
    if not f:
        return jsonify(ok=False, error="Choose the phase sheet CSV."), 400
    raw = f.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        return jsonify(ok=False, error="File is too large (8 MB max)."), 413
    try:
        n = rdf_master.store_sheet(raw)
    except rdf_master.SheetError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except Exception:
        logger.exception("rdf_report: could not save the phase sheet")
        return jsonify(ok=False, error="Could not save the file. Try again."), 500
    _snapshot()
    return jsonify(ok=True, rows=n, **_sheet_payload(_phase(request.form.get("phase"))))
