"""
New Swachha Andhra dashboard (/sac) and the signed-in portal (/sac/portal).

    GET  /sac                      public rotating display; ?login=1 opens the PIN popup
    GET  /sac/captcha              {question, nonce}: a fresh sum for the popup
    POST /sac/login                JSON {pin, captcha_answer, captcha_nonce, next}
    GET  /sac/logout
    GET  /sac/portal               tiles -> agency / phase / site drill-downs (signed in)
    POST /sac/api/upload/preview   multipart "file": rows read + rows that need a look (admin)
    POST /sac/api/upload/publish   multipart "file" + "skip" (JSON list of line numbers) (admin)
    GET  /sac/api/live/sites       weighbridge site names (records API /filters)
    GET  /sac/api/live/records     ?site=&from=&to= tickets for one weighbridge site, newest first

One PIN (pins.py) signs you in to /sac, /reports and /rdf together: a good PIN
sets the /login session key, the RDF report key and the /sac role.
The old dashboard stays at /sac-old (main.py).
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from functools import wraps
from urllib.parse import urlparse

from flask import (Blueprint, jsonify, make_response, redirect, render_template, request,
                   session, url_for)

import captcha
import config
import pins
from data import phase_data, records_api, site_api

logger = logging.getLogger(__name__)
bp = Blueprint("sac", __name__)

SESSION_USER_KEY = "auth_user"        # same key as views/login.py
RDF_SESSION_KEY = "rdf_report_ok"     # same key as views/rdf_report.py
ROLE_KEY = "sac_role"
XHR = "sac"                           # X-Requested-With on our POSTs (blocks plain cross-site posts)
LIVE_MAX_DAYS = 31


# ---------------------------------------------------------------------------
# Session helpers (also used by views/login.py and views/rdf_report.py)
# ---------------------------------------------------------------------------

def signed_in() -> bool:
    return bool(session.get(SESSION_USER_KEY))


def is_admin() -> bool:
    return signed_in() and session.get(ROLE_KEY) == "admin"


def sign_in(p: pins.Pin) -> None:
    session.clear()
    session[SESSION_USER_KEY] = f"pin:{p.name}"
    session[RDF_SESSION_KEY] = True
    session[ROLE_KEY] = p.role
    session.permanent = True


def safe_next(target: str) -> str:
    """Same-host path only (no open redirects)."""
    t = (target or "").strip()
    if not t.startswith("/") or t.startswith("//"):
        return ""
    u = urlparse(t)
    return "" if (u.scheme or u.netloc) else t


def login_url(next_path: str = "") -> str:
    return url_for("overview", login=1, next=safe_next(next_path) or None)


def check_pin_login(pin: str, answer: str, nonce: str) -> tuple[pins.Pin | None, str, int]:
    """Rate limit -> captcha -> PIN. Returns (pin or None, error message, http status)."""
    ip = captcha.client_ip()
    blocked, retry = captcha.is_blocked(ip)
    if blocked:
        return None, f"Too many wrong tries. Try again in {max(1, retry // 60)} minute(s).", 429
    if not captcha.verify(answer, nonce=nonce):
        return None, "That sum was not right. Try the new one.", 400
    p = pins.verify(pin)
    if p is None:
        count, just_blocked = captcha.register_failure(ip)
        logger.info("sac: wrong PIN ip=%s count=%d", ip, count)
        if just_blocked:
            return None, f"Too many wrong tries. Try again in {captcha.BLOCK_SECONDS // 60} minute(s).", 429
        left = max(0, captcha.MAX_FAILURES - count)
        msg = "That PIN did not match."
        if left:
            msg += f" {left} {'try' if left == 1 else 'tries'} left."
        return None, msg, 401
    captcha.clear_failures(ip)
    return p, "", 200


def _script_json(obj) -> str:
    """JSON that is safe inside a <script> element (sheet cells are admin-typed text)."""
    return (json.dumps(obj, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("&", "\\u0026"))


def _no_store(resp):
    resp = make_response(resp)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Robots-Tag"] = "noindex"
    return resp


def _signed_api(view):
    @wraps(view)
    def wrapped(*a, **kw):
        if not signed_in():
            return jsonify(ok=False, auth=False, error="Please log in again."), 401
        if request.method == "POST" and request.headers.get("X-Requested-With") != XHR:
            return jsonify(ok=False, error="Bad request."), 400
        return view(*a, **kw)
    return wrapped


def _admin_api(view):
    @wraps(view)
    @_signed_api
    def wrapped(*a, **kw):
        if not is_admin():
            return jsonify(ok=False, error="Only an admin PIN can update the data."), 403
        return view(*a, **kw)
    return wrapped


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

def _updated_label(sh: phase_data.Sheet) -> str:
    if not sh.published_at:
        return ""
    d = sh.published_at
    return f"Updated {d.day} {d.strftime('%B %Y')}"


def dashboard_view():
    """GET /sac. Registered in main.py under the endpoint name "overview"."""
    sh = phase_data.sheet()
    nxt = safe_next(request.args.get("next", ""))
    return _no_store(render_template(
        "sac/dashboard.html",
        data=phase_data.dashboard(sh.rows),
        updated=_updated_label(sh),
        open_login=request.args.get("login") == "1" and not signed_in(),
        next_url=nxt,
        signed_in=signed_in(),
        pin_length=pins.pin_length(),
        captcha_question=captcha.current_question(),
        captcha_nonce=captcha.current_nonce(),
        rotation_ms=config.SAC_ROTATION_MS,
    ))


@bp.route("/sac/captcha")
def new_captcha():
    q = captcha.new_challenge()
    return _no_store(jsonify(question=q, nonce=captcha.current_nonce()))


@bp.route("/sac/login", methods=["POST"])
def login():
    if request.headers.get("X-Requested-With") != XHR:
        return jsonify(ok=False, error="Bad request."), 400
    body = request.get_json(silent=True) or {}
    p, err, status = check_pin_login(str(body.get("pin") or ""), str(body.get("captcha_answer") or ""),
                                     str(body.get("captcha_nonce") or ""))
    if p is None:
        out = {"ok": False, "error": err, "question": captcha.current_question(), "nonce": captcha.current_nonce()}
        resp = jsonify(out)
        if status == 429:
            resp.headers["Retry-After"] = "900"
        return _no_store(resp), status
    sign_in(p)
    return _no_store(jsonify(ok=True, next=safe_next(str(body.get("next") or "")) or url_for("sac.portal")))


@bp.route("/sac/logout")
def logout():
    session.clear()
    return redirect(url_for("overview"))


@bp.route("/sac/portal")
def portal():
    if not signed_in():
        return redirect(login_url(request.full_path.rstrip("?")))
    sh = phase_data.sheet()
    return _no_store(render_template(
        "sac/portal.html",
        rows_json=_script_json(sh.rows),
        phases_json=_script_json(phase_data.PHASES),
        is_admin=is_admin(),
        updated=_updated_label(sh),
        cfg_json=_script_json({
            "preview": url_for("sac.upload_preview"), "publish": url_for("sac.upload_publish"),
            "liveSites": url_for("sac.live_sites"), "liveRecords": url_for("sac.live_records"),
            "images": url_for("record_images.sheet_view", site="SITE", date="DATE", ticket="TICKET"),
            "login": login_url(url_for("sac.portal")), "today": config.today_ist().isoformat(),
            "maxDays": LIVE_MAX_DAYS, "maxBytes": phase_data.MAX_BYTES,
        }),
    ))


# ---------------------------------------------------------------------------
# Upload (admin)
# ---------------------------------------------------------------------------

def _uploaded() -> tuple[bytes, str]:
    if (request.content_length or 0) > phase_data.MAX_BYTES + 64 * 1024:
        raise phase_data.SheetError("This file is too large (4 MB max).")
    f = request.files.get("file")
    if not f:
        raise phase_data.SheetError("Choose a CSV file.")
    return f.read(), f.filename or "sheet.csv"


@bp.route("/sac/api/upload/preview", methods=["POST"])
@_admin_api
def upload_preview():
    try:
        raw, name = _uploaded()
        return jsonify(ok=True, name=name, **phase_data.preview(raw))
    except phase_data.SheetError as exc:
        return jsonify(ok=False, error=str(exc)), 400


@bp.route("/sac/api/upload/publish", methods=["POST"])
@_admin_api
def upload_publish():
    try:
        raw, name = _uploaded()
        skip = {int(x) for x in json.loads(request.form.get("skip") or "[]")}
    except phase_data.SheetError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except (ValueError, TypeError):
        return jsonify(ok=False, error="Bad request."), 400
    try:
        n = phase_data.publish(raw, skip, by=session.get(SESSION_USER_KEY, ""), filename=name)
    except phase_data.SheetError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except Exception:
        logger.exception("sac: publish failed")
        return jsonify(ok=False, error="Could not save the sheet. Try again in a minute."), 500
    sh = phase_data.sheet()
    return jsonify(ok=True, published=n, rows=sh.rows, updated=_updated_label(sh))


# ---------------------------------------------------------------------------
# Live weighbridge records (signed in)
# ---------------------------------------------------------------------------

@bp.route("/sac/api/live/sites")
@_signed_api
def live_sites():
    raw = records_api.get_filter_values()
    sites = records_api.normalize_filter_options(raw)["sites"]
    return jsonify(ok=bool(sites), sites=sites, error=raw.get("_error") and "The weighbridge server did not answer.")


def _iso(s: str, default: date) -> date:
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        return default


@bp.route("/sac/api/live/records")
@_signed_api
def live_records():
    site = (request.args.get("site") or "").strip()
    if not site:
        return jsonify(ok=False, error="Pick a weighbridge site."), 400
    today = config.today_ist()
    end = _iso(request.args.get("to"), today)
    start = _iso(request.args.get("from"), end)
    if start > end:
        start, end = end, start
    if (end - start).days >= LIVE_MAX_DAYS:
        start = end - timedelta(days=LIVE_MAX_DAYS - 1)
    try:
        recs = site_api.query_records((site,), start.isoformat(), end.isoformat())
    except Exception:
        logger.exception("sac: live records failed for %s", site)
        return jsonify(ok=False, error="The weighbridge server did not answer. Try again in a minute."), 502
    # The API matches site_name loosely ("Kadiri" also finds "Tharuni Kadiri"); keep exact matches only.
    recs = [r for r in recs if r["site_name"].strip().lower() == site.lower()]
    total = round(sum(r["net_weight_mt"] for r in recs), 3)
    keep = ("date", "time", "site_name", "ticket_no", "vehicle_no", "material_type", "net_weight_mt", "image_slots")
    return jsonify(ok=True, site=site, from_=start.isoformat(), to=end.isoformat(), trips=len(recs), total_mt=total,
                   records=[{k: r[k] for k in keep} for r in recs[:500]], capped=len(recs) > 500)
