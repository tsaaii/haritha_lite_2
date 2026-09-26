"""
RDF_planning — mobile form agencies use to report RDF generated, where it was
sent, and the co-processing certificates cement / WtE plants issue for it.

    GET  /rdf_planning                  -> 301 to /rdf_planning/
    GET  /rdf_planning/                 -> the form (PIN login until signed in)
    GET  /rdf_planning/api/agencies     -> agency names for the login dropdown
    POST /rdf_planning/api/login        -> {agency, pin}; signs the agency in
    POST /rdf_planning/api/logout
    GET  /rdf_planning/api/me           -> this agency's sites / phases / destinations
    GET  /rdf_planning/api/pending      -> ?site=  earlier entries missing a certificate
    POST /rdf_planning/api/submit       -> one RDF_plan row + one RDF_dispatch row per destination
    POST /rdf_planning/api/certificate  -> late co-processing certificate for a pending entry
    GET  /rdf_planning/api/csv          -> <Agency>_RDF_data.csv (the same file kept in Drive)

Same shape as views/field.py: Flask is a thin proxy and the Apps Script
(apps_script/rdf_planning/Code.gs) owns the sheet and the Drive folders.
One difference: the PIN is checked once at login, then the agency lives in
the signed Flask session — the browser never keeps the PIN, and one agency
cannot read or write another agency's rows.
"""
from __future__ import annotations

import logging
import os

import requests
from flask import Blueprint, Response, jsonify, redirect, render_template, request, session, url_for
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)
bp = Blueprint("rdf", __name__, template_folder="../templates")

URL_PREFIX = "/rdf_planning"
SESSION_KEY = "rdf_agency"

SCRIPT_URL = os.environ.get("RDF_SCRIPT_URL", "").strip()
SCRIPT_TOKEN = os.environ.get("RDF_SCRIPT_TOKEN", "").strip()
# Submissions upload files and render a PDF in Apps Script — allow longer than field reports.
UPSTREAM_TIMEOUT_S = int(os.environ.get("RDF_UPSTREAM_TIMEOUT_S", "120"))
# App Engine rejects bodies over 32 MB; stay under it with a readable error.
MAX_BODY_BYTES = 30 * 1024 * 1024


# ---------------------------------------------------------------------------
# Upstream (Apps Script) client
# ---------------------------------------------------------------------------

class UpstreamError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


_session = requests.Session()


def _call(action: str, payload: dict | None = None) -> dict:
    """POST {action, token, ...payload} to the RDF Apps Script.

    Apps Script answers a POST with a 302 to script.googleusercontent.com;
    requests follows it as a GET and that body is our JSON. Keep redirects on.
    """
    if not SCRIPT_URL:
        raise UpstreamError("RDF Planning backend is not configured (set RDF_SCRIPT_URL).", 503)

    body = {"action": action, "token": SCRIPT_TOKEN}
    body.update(payload or {})
    try:
        resp = _session.post(SCRIPT_URL, json=body, timeout=UPSTREAM_TIMEOUT_S, allow_redirects=True)
    except requests.RequestException as exc:
        logger.warning("rdf %s upstream error: %s", action, exc)
        raise UpstreamError("Could not reach the RDF server. Try again.", 502)

    if resp.status_code != 200:
        logger.warning("rdf %s upstream HTTP %s: %.200s", action, resp.status_code, resp.text)
        raise UpstreamError("RDF server returned an error.", 502)

    try:
        data = resp.json()
    except ValueError:
        logger.warning("rdf %s non-JSON upstream body: %.200s", action, resp.text)
        raise UpstreamError(
            "RDF server gave an unexpected reply (check the Apps Script "
            "deployment is set to 'Anyone').", 502)

    if not data.get("ok"):
        raise UpstreamError(str(data.get("error") or "Rejected by RDF server."), 400)
    return data


def _err(exc: UpstreamError):
    return jsonify(ok=False, error=str(exc)), exc.status


def _agency() -> str | None:
    return session.get(SESSION_KEY)


def _signed_out():
    return jsonify(ok=False, auth=False, error="Please log in again."), 401


# ---------------------------------------------------------------------------
# Payload whitelisting — Apps Script does the real validation
# ---------------------------------------------------------------------------

def _s(v, n: int = 200) -> str:
    return str(v if v is not None else "")[:n]


def _file(f) -> dict | None:
    if not isinstance(f, dict) or not isinstance(f.get("data"), str) or not f["data"]:
        return None
    return {"name": _s(f.get("name"), 200), "mimeType": _s(f.get("mimeType"), 100), "data": f["data"]}


def _record(raw: dict) -> dict:
    dispatches = []
    for d in (raw.get("dispatches") or [])[:30]:
        if not isinstance(d, dict):
            continue
        dispatches.append({
            "dest": _s(d.get("dest"), 150), "qty": _s(d.get("qty"), 20), "date": _s(d.get("date"), 10),
            "hasCert": _s(d.get("hasCert"), 3), "certQty": _s(d.get("certQty"), 20),
            "certFile": _file(d.get("certFile")),
        })
    attachments = [f for f in (_file(x) for x in (raw.get("attachments") or [])[:10]) if f]
    rec = {k: _s(raw.get(k)) for k in (
        "site", "phase", "cluster", "awarded", "startDate", "endDate", "land", "rdfGen", "uploader", "phone")}
    rec.update(dispatches=dispatches, attachments=attachments)
    return rec


def _too_big():
    return (request.content_length or 0) > MAX_BODY_BYTES


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@bp.route("/RDF_planning")
@bp.route("/RDF_planning/")
@bp.route(URL_PREFIX)
def root():
    # Trailing slash so relative paths and bookmarks are stable.
    return redirect(url_for("rdf.form_view"), code=301)


@bp.route(URL_PREFIX + "/")
def form_view():
    cfg = {
        "api": {k: url_for(f"rdf.api_{k}") for k in (
            "agencies", "login", "logout", "me", "pending", "submit", "certificate", "csv")},
        "maxBodyBytes": MAX_BODY_BYTES,
    }
    resp = Response(render_template(
        "rdf/index.html", cfg=cfg,
        css_url=url_for("static", filename="rdf/rdf.css"),
        js_url=url_for("static", filename="rdf/rdf.js"),
    ))
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Robots-Tag"] = "noindex"
    return resp


# ---------------------------------------------------------------------------
# JSON API (thin proxy)
# ---------------------------------------------------------------------------

@bp.route(URL_PREFIX + "/api/agencies")
def api_agencies():
    try:
        data = _call("agencies")
    except UpstreamError as exc:
        return _err(exc)
    return jsonify(ok=True, agencies=data.get("agencies") or [])


@bp.route(URL_PREFIX + "/api/login", methods=["POST"])
def api_login():
    raw = request.get_json(silent=True) or {}
    agency, pin = _s(raw.get("agency")), _s(raw.get("pin"), 8)
    if not agency or not pin:
        return jsonify(ok=False, error="Select your agency and enter the PIN."), 400
    try:
        data = _call("login", {"agency": agency, "pin": pin})
    except UpstreamError as exc:
        # Wrong PIN / lockout come back as a 400 from _call; surface as 401.
        return (jsonify(ok=False, error=str(exc)), 401) if exc.status == 400 else _err(exc)
    session[SESSION_KEY] = agency
    session.permanent = True
    data.pop("ok", None)
    return jsonify(ok=True, **data)


@bp.route(URL_PREFIX + "/api/logout", methods=["POST"])
def api_logout():
    session.pop(SESSION_KEY, None)
    return jsonify(ok=True)


@bp.route(URL_PREFIX + "/api/me")
def api_me():
    agency = _agency()
    if not agency:
        return _signed_out()
    try:
        data = _call("bootstrap", {"agency": agency})
    except UpstreamError as exc:
        if exc.status == 400:           # agency removed from AGENCY_PINS since login
            session.pop(SESSION_KEY, None)
            return _signed_out()
        return _err(exc)
    data.pop("ok", None)
    return jsonify(ok=True, **data)


@bp.route(URL_PREFIX + "/api/pending")
def api_pending():
    agency = _agency()
    if not agency:
        return _signed_out()
    site = _s(request.args.get("site"))
    if not site:
        return jsonify(ok=True, pending=[])
    try:
        data = _call("pending", {"agency": agency, "site": site})
    except UpstreamError as exc:
        return _err(exc)
    return jsonify(ok=True, pending=data.get("pending") or [])


@bp.route(URL_PREFIX + "/api/submit", methods=["POST"])
def api_submit():
    agency = _agency()
    if not agency:
        return _signed_out()
    if _too_big():
        return jsonify(ok=False, error="Files are too large together. Remove some or use smaller photos."), 413
    raw = request.get_json(silent=True) or {}
    record = _record(raw.get("record") or {})
    if not record["site"] or not record["dispatches"]:
        return jsonify(ok=False, error="Site and at least one destination are required."), 400
    try:
        data = _call("submit", {"agency": agency, "record": record})
    except UpstreamError as exc:
        return _err(exc)
    data.pop("ok", None)
    return jsonify(ok=True, **data)


@bp.route(URL_PREFIX + "/api/certificate", methods=["POST"])
def api_certificate():
    agency = _agency()
    if not agency:
        return _signed_out()
    if _too_big():
        return jsonify(ok=False, error="File is too large."), 413
    raw = request.get_json(silent=True) or {}
    file = _file(raw.get("file"))
    if not file:
        return jsonify(ok=False, error="Attach the certificate."), 400
    try:
        data = _call("certificate", {
            "agency": agency, "recordId": _s(raw.get("recordId"), 40),
            "line": _s(raw.get("line"), 4), "certQty": _s(raw.get("certQty"), 20), "file": file,
        })
    except UpstreamError as exc:
        return _err(exc)
    return jsonify(ok=True, left=data.get("left"), pending=data.get("pending") or [])


@bp.route(URL_PREFIX + "/api/csv")
def api_csv():
    agency = _agency()
    if not agency:
        return _signed_out()
    try:
        data = _call("csv", {"agency": agency})
    except UpstreamError as exc:
        return _err(exc)
    name = (secure_filename(agency) or "agency") + "_RDF_data.csv"
    # BOM so Excel opens it as UTF-8.
    return Response("﻿" + (data.get("csv") or ""), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "Cache-Control": "no-store"})
