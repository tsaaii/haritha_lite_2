"""
RDF_planning (v2) — mobile form agencies use to report, per site and phase,
quantities awarded / processed and the disposal of RDF, Soil, Inert and C&D.

    GET  /rdf_planning                  -> 301 to /rdf_planning/
    GET  /rdf_planning/                 -> the form (log in with agency name + PIN)
    POST /rdf_planning/api/login        -> {agency, pin}; signs the agency in
    POST /rdf_planning/api/logout
    GET  /rdf_planning/api/me           -> this agency's entries + factory suggestions
    POST /rdf_planning/api/submit       -> {entry}; new row, or rewrites the entry's row if entry.id
    GET  /rdf_planning/api/csv          -> <Agency>_RDF_plan.csv (the same file kept in Drive)

Same shape as views/field.py: Flask is a thin proxy and the Apps Script
(apps_script/rdf_planning/Code.gs) owns the sheet and the Drive CSVs.
The PIN is checked once at login, then the agency lives in the signed Flask
session — the browser never keeps the PIN, and one agency cannot read or
write another agency's rows.
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
UPSTREAM_TIMEOUT_S = int(os.environ.get("RDF_UPSTREAM_TIMEOUT_S", "60"))
# One entry is a few KB of text; anything much bigger is not from the form.
MAX_BODY_BYTES = 256 * 1024


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


MATERIALS = ("RDF", "Soil", "Inert", "CnD")
TEXT_FIELDS = ("id", "site", "phase", "start", "end", "awarded", "processed", "remDate", "rdfLast", "rdfDaily")
LONG_FIELDS = ("remarks",) + tuple(m + "_iss" for m in MATERIALS)
SHORT_FIELDS = tuple(m + s for m in MATERIALS for s in ("_cum", "_bal", "_tl"))


def _entry(raw: dict) -> dict:
    e = {k: _s(raw.get(k), 150) for k in TEXT_FIELDS + SHORT_FIELDS}
    e.update({k: _s(raw.get(k), 2000) for k in LONG_FIELDS})
    e["factories"] = [
        {"name": _s(f.get("name"), 150), "qty": _s(f.get("qty"), 20)}
        for f in (raw.get("factories") or [])[:30] if isinstance(f, dict)
    ]
    return e


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
            "login", "logout", "me", "submit", "csv")},
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

@bp.route(URL_PREFIX + "/api/login", methods=["POST"])
def api_login():
    raw = request.get_json(silent=True) or {}
    agency, pin = _s(raw.get("agency"), 100).strip(), _s(raw.get("pin"), 64)
    if not agency or not pin:
        return jsonify(ok=False, error="Enter your agency name and PIN."), 400
    try:
        data = _call("login", {"agency": agency, "pin": pin})
    except UpstreamError as exc:
        # Wrong name / PIN / lockout come back as a 400 from _call; surface as 401.
        return (jsonify(ok=False, error=str(exc)), 401) if exc.status == 400 else _err(exc)
    # Apps Script returns the registered spelling of the agency name.
    session[SESSION_KEY] = data["agency"]
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
        data = _call("list", {"agency": agency})
    except UpstreamError as exc:
        if exc.status == 400:           # agency removed from AGENCY_PINS since login
            session.pop(SESSION_KEY, None)
            return _signed_out()
        return _err(exc)
    data.pop("ok", None)
    return jsonify(ok=True, **data)


@bp.route(URL_PREFIX + "/api/submit", methods=["POST"])
def api_submit():
    agency = _agency()
    if not agency:
        return _signed_out()
    if _too_big():
        return jsonify(ok=False, error="Entry is too large."), 413
    raw = request.get_json(silent=True) or {}
    entry = _entry(raw.get("entry") if isinstance(raw.get("entry"), dict) else {})
    try:
        data = _call("submit", {"agency": agency, "entry": entry})
    except UpstreamError as exc:
        return _err(exc)
    data.pop("ok", None)
    return jsonify(ok=True, **data)


@bp.route(URL_PREFIX + "/api/csv")
def api_csv():
    agency = _agency()
    if not agency:
        return _signed_out()
    try:
        data = _call("csv", {"agency": agency})
    except UpstreamError as exc:
        return _err(exc)
    name = (secure_filename(agency) or "agency") + "_RDF_plan.csv"
    # BOM so Excel opens it as UTF-8.
    return Response("﻿" + (data.get("csv") or ""), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "Cache-Control": "no-store"})
