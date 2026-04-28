"""
haritha_lite Flask app.

Routes:
    GET  /          -> public dashboard (12 cards, all from sites_master.csv)
    GET  /healthz   -> liveness probe (App Engine)
    POST /admin/refresh-cache -> manually invalidate the CSV cache
    GET  /login, POST /login, GET /logout -> auth (login blueprint)
    GET  /reports + JSON APIs + PDF export -> reports blueprint
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

from views.login import bp as login_bp
from views.reports import bp as reports_bp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")

    # In production set SECRET_KEY via env var.
    app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    app.permanent_session_lifetime = timedelta(hours=8)

    app.register_blueprint(login_bp)
    app.register_blueprint(reports_bp)

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

    @app.route("/admin/refresh-cache", methods=["POST", "GET"])
    def refresh_cache():
        master.invalidate_cache()
        return jsonify(status="cache cleared")

    return app


app = create_app()


if __name__ == "__main__":
    # Local dev only. App Engine ignores this.
    app.run(host="0.0.0.0", port=8080, debug=True)
