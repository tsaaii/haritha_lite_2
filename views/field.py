"""
Field data-capture apps — mobile-first, offline-tolerant daily site reports.

Two brands share one blueprint; the brand slug selects logo, colours,
storage namespace and the Google Apps Script backend that owns the sheets.

    GET  /<brand>                    -> 301 to /<brand>/ (service-worker scope)
    GET  /<brand>/                   -> operator form
    GET  /<brand>/pending            -> office view (PIN-gated upstream)
    GET  /<brand>/manifest.webmanifest
    GET  /<brand>/sw.js              -> service worker (scope /<brand>/)
    GET  /<brand>/api/sites          -> site-name suggestions
    POST /<brand>/api/submit         -> file one report
    POST /<brand>/api/status         -> submitted / pending for a date (needs pin)

`brand` is restricted to the configured slugs by the route converter, so
this blueprint never shadows /sites/<slug> or anything else.

Why proxy through Flask instead of calling Apps Script from the phone?
    - No CORS dance with script.google.com redirects.
    - The Apps Script URL and its shared token never leave the server.
    - Operators see one clean URL under advitiaum.com.

The Apps Script side (apps_script/field_report/Code.gs) owns the Drive
folder and the daily spreadsheets, so files stay in your Google account —
no service-account Drive sharing, no service-account storage quota problems.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass

import requests
from flask import (
    Blueprint, Response, abort, jsonify, redirect, render_template,
    request, url_for,
)

logger = logging.getLogger(__name__)
bp = Blueprint("field", __name__, template_folder="../templates")


# ---------------------------------------------------------------------------
# Brand registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Brand:
    slug: str
    org: str                 # short organisation name shown under the title
    title: str
    color: str               # primary
    color_dark: str          # hover / links
    color_deep: str          # hero background on the pending page
    color_leaf: str          # accent on the deep hero
    color_pale: str          # muted text on the deep hero
    color_mint: str          # success circle
    color_mist: str          # tinted surfaces
    logo_radius: str         # css border-radius for the logo
    script_url: str          # Apps Script web-app /exec URL
    token: str               # shared secret checked by Apps Script
    cutoff: str              # HH:mm, informational only (enforced nowhere)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


BRANDS: dict[str, Brand] = {
    "tharuni": Brand(
        slug="tharuni",
        org="Tharuni Associates",
        title="Daily site report",
        color="#0FA14E", color_dark="#0F7A3E", color_deep="#0B3D22",
        color_leaf="#7ED356", color_pale="#BFEBC9",
        color_mint="#E4F6E9", color_mist="#F2FBF4",
        logo_radius="50%",
        script_url=_env("TH_SCRIPT_URL"),
        token=_env("TH_SCRIPT_TOKEN"),
        cutoff=_env("TH_CUTOFF", "17:10"),
    ),
    "apurban": Brand(
        slug="apurban",
        org="AP Urban",
        title="Daily site report",
        color="#EF484D", color_dark="#C9333A", color_deep="#7A1C21",
        color_leaf="#FFB3B6", color_pale="#F5C6C8",
        color_mint="#FCE3E4", color_mist="#FEF3F3",
        logo_radius="10px",
        script_url=_env("AP_SCRIPT_URL"),
        token=_env("AP_SCRIPT_TOKEN"),
        cutoff=_env("AP_CUTOFF", "17:10"),
    ),
}

BRAND_ROUTE = "/<any(tharuni,apurban):brand>"


def _brand(slug: str) -> Brand:
    b = BRANDS.get(slug)
    if b is None:
        abort(404)
    return b


# ---------------------------------------------------------------------------
# Upstream (Apps Script) client
# ---------------------------------------------------------------------------

class UpstreamError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


_session = requests.Session()  # keep-alive; pool handles concurrent threads
UPSTREAM_TIMEOUT_S = int(os.environ.get("FIELD_UPSTREAM_TIMEOUT_S", "40"))


def _call(brand: Brand, action: str, payload: dict | None = None) -> dict:
    """POST {action, token, ...payload} to the brand's Apps Script.

    Apps Script answers a POST with a 302 to script.googleusercontent.com;
    requests follows that as a GET and the body of the redirected page is
    the JSON we produced in doPost(). Do not disable redirects.
    """
    if not brand.script_url:
        raise UpstreamError(
            f"{brand.org} backend is not configured (set "
            f"{brand.slug.upper()[:2]}_SCRIPT_URL).", 503)

    body = {"action": action, "token": brand.token}
    body.update(payload or {})
    try:
        resp = _session.post(
            brand.script_url, json=body,
            timeout=UPSTREAM_TIMEOUT_S, allow_redirects=True,
        )
    except requests.RequestException as exc:
        logger.warning("field[%s] %s upstream error: %s", brand.slug, action, exc)
        raise UpstreamError("Could not reach the report server. Try again.", 502)

    if resp.status_code != 200:
        logger.warning("field[%s] %s upstream HTTP %s: %.200s",
                       brand.slug, action, resp.status_code, resp.text)
        raise UpstreamError("Report server returned an error.", 502)

    try:
        data = resp.json()
    except ValueError:
        # Typical cause: the web app is deployed with "Who has access: Only
        # myself", which serves a Google sign-in page instead of JSON.
        logger.warning("field[%s] %s non-JSON upstream body: %.200s",
                       brand.slug, action, resp.text)
        raise UpstreamError(
            "Report server gave an unexpected reply (check the Apps Script "
            "deployment is set to 'Anyone').", 502)

    if not data.get("ok"):
        raise UpstreamError(str(data.get("error") or "Rejected by report server."), 400)
    return data


def _err(exc: UpstreamError):
    return jsonify(ok=False, error=str(exc)), exc.status


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

def _page_ctx(brand: Brand) -> dict:
    return {
        "brand": brand,
        "logo_url": url_for("static", filename=f"field/{brand.slug}/logo.png"),
        "css_url": url_for("static", filename="field/field.css"),
        "form_url": url_for("field.form_view", brand=brand.slug),
        "pending_url": url_for("field.pending_view", brand=brand.slug),
        "manifest_url": url_for("field.manifest", brand=brand.slug),
        "sw_url": url_for("field.service_worker", brand=brand.slug),
        "api": {
            "sites": url_for("field.api_sites", brand=brand.slug),
            "submit": url_for("field.api_submit", brand=brand.slug),
            "status": url_for("field.api_status", brand=brand.slug),
        },
    }


@bp.route(BRAND_ROUTE)
def brand_root(brand):
    # /tharuni -> /tharuni/ so the service worker's scope covers the page.
    return redirect(url_for("field.form_view", brand=brand), code=301)


@bp.route(BRAND_ROUTE + "/")
def form_view(brand):
    b = _brand(brand)
    ctx = _page_ctx(b)
    ctx["js_url"] = url_for("static", filename="field/form.js")
    resp = Response(render_template("field/form.html", **ctx))
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.route(BRAND_ROUTE + "/pending")
def pending_view(brand):
    b = _brand(brand)
    ctx = _page_ctx(b)
    ctx["js_url"] = url_for("static", filename="field/pending.js")
    resp = Response(render_template("field/pending.html", **ctx))
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Robots-Tag"] = "noindex"
    return resp


@bp.route(BRAND_ROUTE + "/manifest.webmanifest")
def manifest(brand):
    b = _brand(brand)
    data = {
        "name": f"{b.org} — {b.title}",
        "short_name": b.org,
        "start_url": url_for("field.form_view", brand=b.slug),
        "scope": url_for("field.form_view", brand=b.slug),
        "display": "standalone",
        "background_color": "#FFFFFF",
        "theme_color": b.color,
        "icons": [{
            "src": url_for("static", filename=f"field/{b.slug}/logo.png"),
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any",
        }],
    }
    return Response(
        json.dumps(data),
        mimetype="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@bp.route(BRAND_ROUTE + "/sw.js")
def service_worker(brand):
    b = _brand(brand)
    # A new App Engine version => new cache name => old shell is dropped.
    version = os.environ.get("GAE_VERSION", "dev")
    ctx = _page_ctx(b)
    ctx["cache_name"] = f"field-{b.slug}-{version}"
    ctx["shell"] = [
        ctx["form_url"], ctx["pending_url"], ctx["manifest_url"],
        ctx["css_url"], ctx["logo_url"],
        url_for("static", filename="field/form.js"),
        url_for("static", filename="field/pending.js"),
    ]
    body = render_template("field/sw.js", **ctx)
    return Response(body, mimetype="application/javascript",
                    headers={"Cache-Control": "no-cache",
                             "Service-Worker-Allowed": ctx["form_url"]})


# ---------------------------------------------------------------------------
# JSON API (thin proxy)
# ---------------------------------------------------------------------------

@bp.route(BRAND_ROUTE + "/api/sites")
def api_sites(brand):
    b = _brand(brand)
    try:
        data = _call(b, "suggestions")
    except UpstreamError as exc:
        return _err(exc)
    return jsonify(ok=True, sites=data.get("sites") or [])


REPORT_FIELDS = (
    "site", "operator", "phone", "startDate", "startTime", "endDate",
    "endTime", "msw", "soil", "inert", "rdf", "cnd", "remarks", "capturedAt",
)


@bp.route(BRAND_ROUTE + "/api/submit", methods=["POST"])
def api_submit(brand):
    b = _brand(brand)
    raw = request.get_json(silent=True) or {}
    # Whitelist + coerce to str; Apps Script does the real validation.
    report = {k: str(raw.get(k, "") or "")[:500] for k in REPORT_FIELDS}
    if not report["site"] or not report["operator"]:
        return jsonify(ok=False, error="Site and operator are required."), 400
    try:
        data = _call(b, "submit", {"report": report})
    except UpstreamError as exc:
        return _err(exc)
    return jsonify(ok=True, date=data.get("date"),
                   replaced=bool(data.get("replaced")),
                   sheetUrl=data.get("sheetUrl"))


@bp.route(BRAND_ROUTE + "/api/status", methods=["POST"])
def api_status(brand):
    b = _brand(brand)
    raw = request.get_json(silent=True) or {}
    pin = str(raw.get("pin", ""))[:16]
    date = str(raw.get("date", ""))[:10]
    if not pin:
        return jsonify(ok=False, error="PIN required."), 400
    try:
        data = _call(b, "status", {"pin": pin, "date": date})
    except UpstreamError as exc:
        # Wrong PIN comes back as a 400 from _call; surface as 401.
        if "pin" in str(exc).lower():
            return jsonify(ok=False, error="Wrong PIN."), 401
        return _err(exc)
    data.pop("ok", None)
    data["cutoff"] = b.cutoff
    return jsonify(ok=True, **data)
