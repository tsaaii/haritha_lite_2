"""
Per-site dashboard routes.

    GET/POST  /sites/<slug>          -> site-scoped login gate, then the page.
    GET       /sites/<slug>/records.json -> filtered live records (gated).

Access rules:
    - A global login (auth_user in session) sees every site.
    - Otherwise the visitor must pass the per-site login, whose credentials
      live in sites_master.csv (login_id / login_pwd) for that site's row.
      Passing it grants access to THAT slug only.
    - The global credentials (auth.verify_credentials) are also accepted at
      the per-site form; using them upgrades the session to global access
      (all sites), matching the main /login.

Reuses captcha.py (challenge + IP rate-limit) and templates/login.html.
"""
from __future__ import annotations

from datetime import date

from flask import (
    Blueprint, abort, current_app, jsonify, redirect, render_template,
    request, session, url_for, Response,
)

import captcha
from auth import USERNAME, verify_credentials
from data import master, site_api, site_pdf
from views.login import SESSION_USER_KEY

bp = Blueprint("sites", __name__, url_prefix="/sites")

SESSION_SITE_KEY = "site_auth"   # list[str] of slugs the visitor has unlocked


# --------------------------------------------------------------------------
# Session helpers — site grants are a SET of slugs, never a single boolean,
# so unlocking one site can't leak access to another.
# --------------------------------------------------------------------------

def _granted() -> set[str]:
    return set(session.get(SESSION_SITE_KEY) or [])


def _grant(slug: str) -> None:
    g = _granted()
    g.add(slug)
    session[SESSION_SITE_KEY] = sorted(g)
    session.permanent = True


def _has_access(slug: str) -> bool:
    if session.get(SESSION_USER_KEY):     # global login => all sites
        return True
    return slug in _granted()


def verify_site_credentials(site, username: str, password: str) -> bool:
    """Plaintext match against the site's spine row (MVP-grade).

    Swap to a hash check here later; the route logic doesn't change.
    """
    if not username or not password:
        return False
    if (username or "").strip() != (site.login_id or "").strip():
        return False
    return password == (site.login_pwd or "")


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def _render_login(site, error=None, status=200):
    """Reuse templates/login.html, parameterized with the site name and a
    form action pointing back at this site's URL."""
    return render_template(
        "login.html",
        error=error,
        next_url="",
        captcha_question=captcha.current_question(),
        captcha_nonce=captcha.current_nonce(),
        form_action=url_for("sites.site_view", slug=site.slug),
        site_name=site.site_name,
    ), status


def _tiles(site) -> dict:
    """All four headline tiles — derived from the spine, no API call.

    Generic: every field exists on every Site, so this works for any slug.
    """
    target = site.target_mt
    remediated = site.remediated_mt
    remaining = max(0.0, target - remediated)

    today = date.today()
    days_elapsed = (today - site.start_date).days if site.start_date else 0
    days_elapsed = max(1, days_elapsed)
    avg_per_day = remediated / days_elapsed

    days_left = (site.deadline_date - today).days if site.deadline_date else 0
    required_per_day = (remaining / days_left) if days_left and days_left > 0 else 0.0

    total_disposed = (site.soil_disposed_mt + site.rdf_disposed_mt
                      + site.cnd_disposed_mt + site.inert_disposed_mt)
    disposal_pct = (total_disposed / remediated * 100.0) if remediated > 0 else 0.0

    def split(part):
        return round(part / total_disposed * 100.0, 1) if total_disposed > 0 else 0.0

    return {
        "target_mt": round(target, 1),
        "remediated_mt": round(remediated, 1),
        "completion_pct": round(site.completion_pct, 1),
        "remaining_mt": round(remaining, 1),
        "avg_per_day_mt": round(avg_per_day, 1),
        "required_per_day_mt": round(required_per_day, 1),
        "days_left": days_left,
        "on_track": (required_per_day <= avg_per_day) if required_per_day else True,
        "total_disposed_mt": round(total_disposed, 1),
        "disposal_pct": round(disposal_pct, 1),
        "split": {
            "Soil": split(site.soil_disposed_mt),
            "Inert": split(site.inert_disposed_mt),
            "CnD": split(site.cnd_disposed_mt),
            "RDF": split(site.rdf_disposed_mt),
        },
    }


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@bp.route("/<slug>", methods=["GET", "POST"])
def site_view(slug):
    site = master.get_site_by_slug(slug)
    if site is None:
        abort(404)

    # Canonicalize /sites/Ananthapur -> /sites/ananthapur on GET.
    if request.method == "GET" and slug != site.slug:
        return redirect(url_for("sites.site_view", slug=site.slug))

    # Already allowed (global or this slug)? Show the page.
    if _has_access(site.slug):
        return render_template("site.html", site=site, tiles=_tiles(site))

    # ---- GET: render the per-site login ----
    if request.method == "GET":
        return _render_login(site)

    # ---- POST flow: rate-limit -> captcha -> credentials ----
    ip = captcha.client_ip()

    blocked, retry_after = captcha.is_blocked(ip)
    if blocked:
        mins = max(1, retry_after // 60)
        body, _ = _render_login(
            site,
            error=f"Too many failed attempts. Try again in {mins} minute(s).",
        )
        return body, 429, {"Retry-After": str(retry_after)}

    if not captcha.verify(request.form.get("captcha_answer", ""),
                          nonce=request.form.get("captcha_nonce", "")):
        body, _ = _render_login(
            site, error="Captcha was incorrect. Please try again.")
        return body, 400

    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""

    # Global creds first — they upgrade the session to all-site access.
    if verify_credentials(username, password):
        captcha.clear_failures(ip)
        session[SESSION_USER_KEY] = USERNAME
        session.permanent = True
        return redirect(url_for("sites.site_view", slug=site.slug))

    # Site creds — unlock this slug only.
    if verify_site_credentials(site, username, password):
        captcha.clear_failures(ip)
        _grant(site.slug)
        return redirect(url_for("sites.site_view", slug=site.slug))

    count, just_blocked = captcha.register_failure(ip)
    current_app.logger.info(
        "Failed site login slug=%s user=%r ip=%s count=%d",
        site.slug, username, ip, count,
    )
    if just_blocked:
        mins = captcha.BLOCK_SECONDS // 60
        err = f"Too many failed attempts. Try again in {mins} minute(s)."
    else:
        remaining = max(0, captcha.MAX_FAILURES - count)
        err = "Incorrect username or password."
        if remaining and remaining <= 2:
            err += f" {remaining} attempt(s) remaining."
    body, _ = _render_login(site, error=err)
    return body, 401


@bp.route("/<slug>/records.json")
def site_records(slug):
    """Filtered live records for the explorer. Same gate as the page."""
    site = master.get_site_by_slug(slug)
    if site is None:
        abort(404)
    if not _has_access(site.slug):
        abort(403)

    start = (request.args.get("start") or "").strip() or None
    end = (request.args.get("end") or "").strip() or None
    material = (request.args.get("material") or "").strip() or None
    vehicle = (request.args.get("vehicle") or "").strip() or None

    try:
        records = site_api.query_records(
            site.api_site_names,
            start_date=start, end_date=end,
            material=material, vehicle=vehicle,
        )
        summary = site_api.summarize(records)
        return jsonify(
            ok=True,
            site_name=site.site_name,
            filters={"start": start, "end": end,
                     "material": material, "vehicle": vehicle},
            api_calls=site_api.describe_calls(
                site.api_site_names, start_date=start,
                end_date=end, material=material),
            vehicle_clientside=bool(vehicle),
            summary=summary,
            records=records,
        )
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("records.json failed for %s", site.slug)
        return jsonify(ok=False, error=str(exc)), 502


@bp.route("/<slug>/pace.json")
def site_pace(slug):
    """Just today's Legacy/MSW net weight — tile 2's live figure. Tiny + gated.

    Kept separate from records.json so the page paints instantly and only this
    one number resolves a moment later (and on a poll).
    """
    site = master.get_site_by_slug(slug)
    if site is None:
        abort(404)
    if not _has_access(site.slug):
        abort(403)
    try:
        mt = site_api.daily_pace(site.api_site_names)
        return jsonify(
            ok=True,
            pace_mt=mt,
            material=site_api.PACE_MATERIAL_TYPE,
            required_per_day_mt=_tiles(site)["required_per_day_mt"],
        )
    except Exception as exc:  # noqa: BLE001
        current_app.logger.exception("pace.json failed for %s", site.slug)
        return jsonify(ok=False, error=str(exc)), 502


@bp.route("/<slug>/report.pdf")
def site_report_pdf(slug):
    """Server-rendered daily-report PDF for the current filter set. Gated."""
    site = master.get_site_by_slug(slug)
    if site is None:
        abort(404)
    if not _has_access(site.slug):
        abort(403)

    start = (request.args.get("start") or "").strip() or None
    end = (request.args.get("end") or "").strip() or None
    material = (request.args.get("material") or "").strip() or None
    vehicle = (request.args.get("vehicle") or "").strip() or None

    records = site_api.query_records(
        site.api_site_names, start_date=start, end_date=end,
        material=material, vehicle=vehicle,
    )
    summary = site_api.summarize(records)
    pdf_bytes = site_pdf.build_report(
        site_name=site.site_name,
        agency_name=site.agency_name,
        filters={"start": start, "end": end,
                 "material": material, "vehicle": vehicle},
        records=records,
        summary=summary,
    )
    fname = f"{site.slug}_{start or 'all'}_{end or 'all'}.pdf"
    return Response(
        pdf_bytes, mimetype="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )