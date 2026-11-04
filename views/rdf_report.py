"""
RDF disposal report — the daily, printable report for Swachha Andhra Corporation.

    GET  /rdf/                 -> the report (PIN + captcha page if not signed in)
    POST /rdf/login            -> {pin, captcha_answer, captcha_nonce} form post
    GET  /rdf/logout
    GET  /rdf/report.pdf       -> export-ready A4 PDF: Daily_RDF_tracker_DD-MM-YYYY.pdf
    GET  /rdf/api/gist         -> {text}: WhatsApp summary of who sent RDF on the report day
    GET  /rdf/api/trackers     -> days on file (gear panel)
    POST /rdf/api/upload       -> multipart "files": one or more daily tracker CSVs;
                                  replies with the re-rendered report sheet, gist + PDF link
                                  so one upload updates the page and downloads the PDF
    POST /rdf/api/delete       -> {date: "YYYY-MM-DD"}

Also /RDF, and the old /rdf_report/ address redirects here. On the rdf.* host
(rdf.advitiaum.com) the report is also served at "/".

Sign-in: hardcoded PIN (as requested) + the math captcha and per-IP lockout
from captcha.py (5 wrong tries -> 15 minutes). RDF_REPORT_PIN_HASH overrides the PIN.
Data lives in RDF_TRACKER_DIR; see data/rdf_tracker.py and docs/rdf-report.md.
"""
from __future__ import annotations

import logging
import os
from functools import wraps

from flask import Blueprint, Response, jsonify, make_response, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

import captcha
from data import rdf_report, rdf_report_pdf, rdf_tracker

logger = logging.getLogger(__name__)
bp = Blueprint("rdf_report", __name__, template_folder="../templates")

URL_PREFIX = "/rdf"
# Hash of the hardcoded 5-digit report PIN (the PIN itself is not written in this public repo).
_DEFAULT_PIN_HASH = "scrypt:32768:8:1$AVK4XUVlP4GM18Ep$b1821cf0f055e77e1eb4c46b73c8d203c073763f1c16c242bdc3e5e6c92bcc74ca6d7b7a4fb2b9a6d197156eb388427e4ef8e0d32f961d3fbc0762d69e242708"
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


def _pin_hash() -> str:
    return os.environ.get("RDF_REPORT_PIN_HASH", "").strip() or _DEFAULT_PIN_HASH


def _report() -> tuple[dict | None, str]:
    """(report view model or None if no days on file, error message)."""
    try:
        return rdf_report.build(rdf_tracker.history()), ""
    except Exception:
        logger.exception("rdf_report: could not load trackers")
        return None, "Could not read the uploaded trackers. Try again in a minute."


def _pdf_url(r: dict) -> str:
    # ?d= makes each day's PDF a distinct URL so nothing serves a stale cached copy.
    return url_for("rdf_report.report_pdf", d=r["rep_iso"])


@bp.route(URL_PREFIX + "/")
def report_view():
    if not _signed_in():
        return _login_page()
    r, load_error = _report()
    return _no_cache(render_template(
        "rdf_report/report.html", r=r, load_error=load_error, pdf_url=_pdf_url(r) if r else "",
        cfg={"api": {k: url_for(f"rdf_report.api_{k}") for k in ("trackers", "upload", "delete", "gist")},
             "maxBytes": MAX_UPLOAD_BYTES},
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

    pin = (request.form.get("pin") or "").strip()
    try:
        ok = bool(pin) and check_password_hash(_pin_hash(), pin)
    except Exception:
        ok = False
    if not ok:
        count, just_blocked = captcha.register_failure(ip)
        logger.info("rdf_report wrong PIN ip=%s count=%d", ip, count)
        if just_blocked:
            return _login_page(f"Too many wrong tries. Try again in {captcha.BLOCK_SECONDS // 60} minute(s).", 429)
        left = max(0, captcha.MAX_FAILURES - count)
        msg = "Incorrect PIN." + (f" {left} attempt(s) left." if left and left <= 2 else "")
        return _login_page(msg, 401)

    captcha.clear_failures(ip)
    session[SESSION_KEY] = True
    session.permanent = True
    # Back to wherever the PIN page was shown ("/" on rdf.*, else /rdf/).
    nxt = request.form.get("next") or ""
    return redirect(nxt if nxt in ("/", URL_PREFIX + "/") else url_for("rdf_report.report_view"))


@bp.route(URL_PREFIX + "/logout")
def logout():
    session.pop(SESSION_KEY, None)
    return redirect("/" if request.host.lower().startswith(HOST_PREFIX) else url_for("rdf_report.report_view"))


@bp.route(URL_PREFIX + "/report.pdf")
def report_pdf():
    if not _signed_in():
        return redirect(url_for("rdf_report.report_view"))
    r, err = _report()
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
    r, err = _report()
    return _no_cache(jsonify(ok=bool(r), text=r["gist"] if r else "", error=err))


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
        out.update(_sheet_payload())
    return jsonify(out)


def _sheet_payload() -> dict:
    """Fresh report sheet HTML + where to fetch its PDF, for in-place page updates."""
    r, _ = _report()
    return {"sheet_html": render_template("rdf_report/_sheet.html", r=r),
            "rep_label": r["rep_label"] if r else "", "pdf_url": _pdf_url(r) if r else "",
            "gist": r["gist"] if r else "", "gist_day": r["rep_day"] if r else "",
            "pdf_name": rdf_report_pdf.filename(r) if r else ""}


@bp.route(URL_PREFIX + "/api/delete", methods=["POST"])
@_api
def api_delete():
    d = str((request.get_json(silent=True) or {}).get("date") or "")
    try:
        rdf_tracker.remove(d)
    except rdf_tracker.TrackerError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    return jsonify(ok=True, **_sheet_payload())
