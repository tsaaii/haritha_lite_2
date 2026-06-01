"""
haritha_lite Flask app.

Routes:
    GET  /          -> public dashboard (12 cards, all from sites_master.csv)
    GET  /healthz   -> liveness probe (App Engine)
    POST /admin/refresh-cache -> manually invalidate the CSV cache (login-gated)
    GET  /login, POST /login, GET /logout -> auth (login blueprint)
    GET  /reports + JSON APIs + PDF export -> reports blueprint
    GET/POST /sites/<slug> -> per-site dashboard gate (sites blueprint)
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta

from flask import Flask, jsonify, render_template

import config
from data import master
from data.aggregate import (
    agency_metrics,
    main_cards,
    overview_cards,
    project_overview,
)

from views.login import bp as login_bp, login_required
from views.reports import bp as reports_bp
from views.sites import bp as sites_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger(__name__)


def _resolve_secret_key() -> str:
    """Get the Flask secret key.

    In production (App Engine sets GAE_ENV=standard) we REQUIRE an explicit
    SECRET_KEY env var. Without it, every instance generates its own random
    key — which silently breaks sessions, login, and captcha as soon as the
    load balancer routes a user to a different instance, or when an instance
    restarts.
    """
    key = os.environ.get("SECRET_KEY")
    if key:
        return key

    if os.environ.get("GAE_ENV", "").startswith("standard"):
        raise RuntimeError(
            "SECRET_KEY env var is required in production. "
            "Set it in app.yaml env_variables, or via Secret Manager."
        )

    # Local dev only — random per-process key is fine.
    logger.warning("SECRET_KEY not set; generating a random one (dev only).")
    return secrets.token_hex(32)


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")

    app.secret_key = _resolve_secret_key()
    app.permanent_session_lifetime = timedelta(hours=8)

    # Harden the session cookie. App Engine terminates TLS for us, so
    # secure=True is safe in prod. In local dev (http://localhost) we
    # allow insecure cookies so the login flow still works.
    is_prod = os.environ.get("GAE_ENV", "").startswith("standard")
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=is_prod,
    )

    app.register_blueprint(login_bp)
    app.register_blueprint(reports_bp)
    app.register_blueprint(sites_bp)

    @app.route("/")
    def overview():
        sites = master.get_sites()
        today = config.today_ist()

        overview_data = project_overview(sites, today)

        agencies = master.get_agencies()
        agency_views = []
        for ag in agencies:
            am = agency_metrics(ag, sites, today)
            agency_views.append({
                "name": ag,
                "display_name": am.display_name,
                "cluster_summary": ", ".join(am.clusters[:3])
                                   + (f" +{len(am.clusters) - 3}" if len(am.clusters) > 3 else ""),
                "cluster_count": len(am.clusters),
                "site_count": am.total_sites,
                "main_cards": main_cards(am),
            })

        return render_template(
            "overview.html",
            overview=overview_data,
            overview_cards=overview_cards(overview_data),
            overview_date_str=today.strftime("%B %d, %Y"),
            agencies=agency_views,
            rotation_interval_ms=config.ROTATION_INTERVAL_MS,
            updated_at=datetime.now(config.IST).strftime("%Y-%m-%d %H:%M IST"),
        )

    @app.route("/healthz")
    def healthz():
        return jsonify(status="ok")

    # Login-gated AND POST-only. Was previously open + GET-allowed,
    # which let anyone wipe the cache anonymously by hitting the URL.
    @app.route("/admin/refresh-cache", methods=["POST"])
    @login_required
    def refresh_cache():
        master.invalidate_cache()
        return jsonify(status="cache cleared")

    return app


app = create_app()


if __name__ == "__main__":
    # Local dev only. App Engine ignores this and uses gunicorn from app.yaml.
    app.run(host="0.0.0.0", port=8080, debug=True)