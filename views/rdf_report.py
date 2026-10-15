"""
RDF disposal report — the daily, printable report for Swachha Andhra Corporation.

    GET  /rdf_report/                 -> the report (PIN page if not signed in)
    POST /rdf_report/login            -> {pin} form post
    GET  /rdf_report/logout
    GET  /rdf_report/api/trackers     -> days on file (gear panel)
    POST /rdf_report/api/upload       -> multipart "files": one or more daily tracker CSVs
    POST /rdf_report/api/delete       -> {date: "YYYY-MM-DD"}

On the rdf.* host (rdf.advitiaum.com) the report is also served at "/".

One shared PIN (hash in RDF_TRACKER_DIR/pin_hash, see data/rdf_tracker.py).
Wrong PINs use the same per-IP lockout as the main login (captcha.py).
Data lives in RDF_TRACKER_DIR; see data/rdf_tracker.py and docs/rdf-report.md.
"""
from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, jsonify, make_response, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

import captcha
from data import rdf_report, rdf_tracker

logger = logging.getLogger(__name__)
bp = Blueprint("rdf_report", __name__, template_folder="../templates")

URL_PREFIX = "/rdf_report"
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
def root():
    return redirect(url_for("rdf_report.report_view"), code=301)


@bp.route(URL_PREFIX + "/")
def report_view():
    if not _signed_in():
        return _login_page()
    try:
        hist = rdf_tracker.history()
    except Exception:
        logger.exception("rdf_report: could not load trackers")
        hist = []
        load_error = "Could not read the uploaded trackers. Try again in a minute."
    else:
        load_error = ""
    return _no_cache(render_template(
        "rdf_report/report.html", r=rdf_report.build(hist), load_error=load_error,
        cfg={"api": {k: url_for(f"rdf_report.api_{k}") for k in ("trackers", "upload", "delete")},
             "maxBytes": MAX_UPLOAD_BYTES},
    ))


def _login_page(error: str = "", status: int = 200):
    configured = bool(rdf_tracker.pin_hash())
    if not configured and not error:
        error = "The report PIN has not been set up yet (python -m data.rdf_tracker set-pin)."
    return _no_cache(render_template("rdf_report/login.html", error=error, configured=configured)), status


@bp.route(URL_PREFIX + "/login", methods=["POST"])
def login():
    ip = captcha.client_ip()
    blocked, retry = captcha.is_blocked(ip)
    if blocked:
        resp, _ = _login_page(f"Too many wrong PINs. Try again in {max(1, retry // 60)} minute(s).", 429)
        resp.headers["Retry-After"] = str(retry)
        return resp, 429

    pin = (request.form.get("pin") or "").strip()
    h = rdf_tracker.pin_hash()
    ok = False
    if h and pin:
        try:
            ok = check_password_hash(h, pin)
        except Exception:
            ok = False
    if not ok:
        count, just_blocked = captcha.register_failure(ip)
        logger.info("rdf_report wrong PIN ip=%s count=%d", ip, count)
        if just_blocked:
            return _login_page(f"Too many wrong PINs. Try again in {captcha.BLOCK_SECONDS // 60} minute(s).", 429)
        left = max(0, captcha.MAX_FAILURES - count)
        msg = "Incorrect PIN." + (f" {left} attempt(s) left." if left and left <= 2 else "")
        return _login_page(msg, 401)

    captcha.clear_failures(ip)
    session[SESSION_KEY] = True
    session.permanent = True
    # Back to wherever the PIN page was shown ("/" on rdf.*, else /rdf_report/).
    nxt = request.form.get("next") or ""
    return redirect(nxt if nxt in ("/", URL_PREFIX + "/") else url_for("rdf_report.report_view"))


@bp.route(URL_PREFIX + "/logout")
def logout():
    session.pop(SESSION_KEY, None)
    return redirect("/" if request.host.lower().startswith(HOST_PREFIX) else url_for("rdf_report.report_view"))


# ---------------------------------------------------------------------------
# Gear panel API
# ---------------------------------------------------------------------------

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
    return jsonify(ok=any(r["ok"] for r in results), results=results)


@bp.route(URL_PREFIX + "/api/delete", methods=["POST"])
@_api
def api_delete():
    d = str((request.get_json(silent=True) or {}).get("date") or "")
    try:
        rdf_tracker.remove(d)
    except rdf_tracker.TrackerError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    return jsonify(ok=True)
