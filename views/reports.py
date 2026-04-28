"""
/reports page routes.

Routes (all login-gated):
    GET  /reports                  -> page shell with filter dropdowns pre-populated
    GET  /reports/api/records      -> JSON; full filter set + pagination
    GET  /reports/api/filters      -> JSON list of dropdown values (cached upstream)
    GET  /reports/api/export.pdf   -> streams PDF respecting active filters + columns
"""
from __future__ import annotations

import logging
from datetime import datetime

from flask import (
    Blueprint, Response, jsonify, render_template, request,
)

import config
from data import records_api
from data.pdf_export import (
    build_pdf_filename, build_summary_pdf, resolve_columns,
)
from views.login import login_required


logger = logging.getLogger(__name__)
bp = Blueprint("reports", __name__, url_prefix="/reports")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _filters_from_request(args) -> dict:
    """Extract the filter dict from request.args, dropping empties."""
    raw = {}
    for key in records_api.ALLOWED_FILTERS:
        val = args.get(key, "")
        if isinstance(val, str):
            val = val.strip()
        if val not in (None, "", "null"):
            raw[key] = val
    return raw


def _columns_from_request(args) -> list[str]:
    """Parse the `columns` query param. Accepts repeated ?columns=x or
    a single comma-joined list. Sanitised against COLUMN_SCHEMA."""
    # Repeated params first (?columns=date&columns=time)
    multi = args.getlist("columns") if hasattr(args, "getlist") else []
    if not multi:
        single = args.get("columns", "")
        multi = [single] if single else []

    flat: list[str] = []
    for chunk in multi:
        flat.extend(p.strip() for p in (chunk or "").split(","))
    return resolve_columns([k for k in flat if k])


# ---------------------------------------------------------------------------
# Page shell
# ---------------------------------------------------------------------------

@bp.route("")
@login_required
def reports_view():
    raw = records_api.get_filter_values()
    options = records_api.normalize_filter_options(raw)
    return render_template(
        "reports.html",
        filter_options=options,
        page_size_default=records_api.DEFAULT_LIMIT,
        export_cap=records_api.EXPORT_HARD_CAP,
        updated_at=datetime.now(config.IST).strftime("%Y-%m-%d %H:%M IST"),
    )


# ---------------------------------------------------------------------------
# JSON APIs
# ---------------------------------------------------------------------------

@bp.route("/api/filters")
@login_required
def api_filters():
    raw = records_api.get_filter_values()
    return jsonify(records_api.normalize_filter_options(raw))


@bp.route("/api/records")
@login_required
def api_records():
    filters = _filters_from_request(request.args)
    try:
        page = int(request.args.get("page", 1) or 1)
    except ValueError:
        page = 1
    try:
        limit = int(request.args.get("limit", records_api.DEFAULT_LIMIT))
    except ValueError:
        limit = records_api.DEFAULT_LIMIT

    payload = records_api.fetch_records(filters, page=page, limit=limit)
    return jsonify(payload)


@bp.route("/api/export.pdf")
@login_required
def api_export_pdf():
    filters = _filters_from_request(request.args)
    columns = _columns_from_request(request.args)

    bundle = records_api.fetch_all_records(
        filters, hard_cap=records_api.EXPORT_HARD_CAP)

    pdf_bytes = build_summary_pdf(
        bundle["records"],
        filters=filters,
        capped=bundle["capped"],
        total_in_db=bundle["total_in_db"],
        columns=columns,
    )

    filename = build_pdf_filename(filters)
    return Response(
        pdf_bytes,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
            "Cache-Control": "no-store",
        },
    )
