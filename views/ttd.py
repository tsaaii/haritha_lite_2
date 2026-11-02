"""
TTD legacy-waste dashboard at /TTD (Tirumala Tirupati Devasthanams).

Routes:
    GET/POST /TTD                  sign-in (math captcha + IP lockout), then the dashboard
    GET      /TTD/logout
    GET      /TTD/api/overview     headline figures (awarded qty, trips today, cumulative per material)
    GET      /TTD/api/report       day-wise or month-wise table  ?view=day|month&from=YYYY-MM-DD&to=YYYY-MM-DD
    GET      /TTD/report.pdf       the same report as a PDF with both logos
    GET      /TTD/api/live/state   remote camera view: station online?, live weight, cameras
    GET      /TTD/api/live/<cam>.jpg   newest camera picture (asking = watching for 12 s);
                                   ?start=1 is the Watch button; 410 once the 5-minute Watch is over

Data comes from the Adex weighbridge cloud API (adex-lite3/cloud). The browser never sees
that API's key: every call goes through this server, and only a signed-in TTD session may
make them. The TTD login is separate from the /login dashboard login.

Configuration (environment, see ttd_secrets.example.yaml):
    ADEX_API_URL        https://adex-api-xxxx.asia-south1.run.app
    TTD_SITE_ID         site id in the Adex cloud (default "ttd")
    TTD_READ_KEY        that site's read key, or instead (preferred, nothing secret in app.yaml):
    TTD_READ_KEY_SECRET Secret Manager name, e.g. projects/PROJECT/secrets/ttd-read-key/versions/latest
    TTD_PASSWORD_HASH   optional: werkzeug hash to replace the built-in password
    TTD_AWARDED_MT      optional: awarded legacy quantity (default 51290)
    TTD_CH4_MCF, TTD_CH4_DOC, TTD_CH4_DOCF, TTD_CH4_F, TTD_CH4_OX, TTD_GWP_CH4,
    TTD_CREDIT_PHI, TTD_TREE_TCO2, TTD_RDF_PLASTIC_SHARE
                        optional: factors behind the climate-impact tiles (see IMPACT_DEFAULTS)
"""
from __future__ import annotations

import io
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from functools import wraps

import requests
from flask import (Blueprint, Response, current_app, jsonify, redirect, render_template, request, session,
                   url_for)
from werkzeug.security import check_password_hash

import captcha

logger = logging.getLogger(__name__)
bp = Blueprint("ttd", __name__)

# ---- Sign-in (hardcoded for now, as requested) ----
USERNAME = "admin-ttd"
# werkzeug.security.generate_password_hash("ttd@tirumala")
_DEFAULT_HASH = "scrypt:32768:8:1$znOn4sw1QHcqGVo4$385c28057057608032bcf1adbbc456ccb4ef861c1569601b772a6bcfc68c837aa00bd5a5c83383e4e838b72c15981bfddeed919e4bf6982e33eb3b47ee4fce3c"
SESSION_KEY = "ttd_user"

MATERIALS = ["MSW", "Soil", "Inert", "CnD", "RDF", "Scrap", "Others"]
INWARD = "MSW"                       # legacy waste brought in for processing
DISPOSED = ["Soil", "Inert", "CnD", "RDF", "Scrap"]
IST = timezone(timedelta(hours=5, minutes=30))
CAM_RE = re.compile(r"^(front|back|cam[3-9])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CSP = ("default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; "
       "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


def _password_hash() -> str:
    return os.environ.get("TTD_PASSWORD_HASH") or _DEFAULT_HASH


def verify_credentials(username: str, password: str) -> bool:
    if not username or not password or username.strip().lower() != USERNAME:
        return False
    try:
        return check_password_hash(_password_hash(), password)
    except Exception:
        return False


def ttd_login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get(SESSION_KEY) != USERNAME:
            if request.path.startswith("/TTD/api/") or request.path.endswith(".pdf"):
                return jsonify({"error": "Please sign in again."}), 401
            return redirect(url_for("ttd.home"))
        return view(*args, **kwargs)
    return wrapped


@bp.after_request
def _security_headers(resp):
    if request.path.startswith("/TTD"):
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


# ---------------------------------------------------------------------------
# Adex cloud API client (server side only)
# ---------------------------------------------------------------------------
class AdexError(Exception):
    pass


_secret = {"value": None, "at": 0.0}


def _secret_manager(name: str) -> str:
    """Read a secret with the App Engine service account (metadata server token + REST; no extra library)."""
    if _secret["value"] and time.time() - _secret["at"] < 3600:
        return _secret["value"]
    try:
        tok = requests.get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
                           headers={"Metadata-Flavor": "Google"}, timeout=3).json()["access_token"]
        r = requests.get(f"https://secretmanager.googleapis.com/v1/{name}:access",
                         headers={"Authorization": f"Bearer {tok}"}, timeout=5)
        r.raise_for_status()
        import base64
        _secret.update(value=base64.b64decode(r.json()["payload"]["data"]).decode().strip(), at=time.time())
    except Exception as e:
        logger.warning("Could not read %s from Secret Manager: %s", name, e)
    return _secret["value"] or ""


def _cfg():
    key = os.environ.get("TTD_READ_KEY", "")
    if not key and os.environ.get("TTD_READ_KEY_SECRET"):
        key = _secret_manager(os.environ["TTD_READ_KEY_SECRET"])
    return os.environ.get("ADEX_API_URL", "").rstrip("/"), os.environ.get("TTD_SITE_ID", "ttd"), key


_cache: dict = {}
_cache_lock = threading.Lock()


def adex_get(path: str, params: dict | None = None, ttl: float = 0, raw: bool = False, timeout: float = 15):
    """GET {ADEX_API_URL}/v1/sites/{site}/{path}. Cached for `ttl` seconds per process."""
    base, site, key = _cfg()
    if not base or not key:
        raise AdexError("The TTD data service is not configured yet (ADEX_API_URL / TTD_READ_KEY).")
    ck = (path, tuple(sorted((params or {}).items())))
    if ttl:
        with _cache_lock:
            hit = _cache.get(ck)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
    try:
        r = requests.get(f"{base}/v1/sites/{site}/{path}", params=params or {}, headers={"X-Api-Key": key},
                         timeout=timeout)
    except requests.RequestException as e:
        logger.warning("Adex API unreachable: %s", e)
        raise AdexError("Can't reach the weighbridge data service right now.") from e
    if r.status_code == 401:
        raise AdexError("The weighbridge data service refused the TTD key.")
    if raw:
        return r
    if r.status_code != 200:
        raise AdexError(f"The weighbridge data service answered {r.status_code}.")
    out = r.json()
    if ttl:
        with _cache_lock:
            _cache[ck] = (time.time(), out)
            if len(_cache) > 200:
                _cache.clear()
    return out


def _today() -> date:
    return datetime.now(IST).date()


# ---------------------------------------------------------------------------
# Climate impact estimates (Overview tiles). Every figure is an ESTIMATE from weighbridge
# tonnage and published factors; nothing here is a verified or issued credit.
# ---------------------------------------------------------------------------
IMPACT_DEFAULTS = {
    # IPCC 2006 Guidelines, Vol. 5 (Waste), Ch. 3 - methane from solid waste disposal sites.
    "mcf": 0.8,     # methane correction factor: unmanaged, deep (>= 5 m) site
    "doc": 0.06,    # degradable organic carbon left in AGED legacy waste (fresh Indian MSW ~0.15). Replace with lab data.
    "docf": 0.5,    # fraction of DOC that decomposes (IPCC default)
    "f": 0.5,       # fraction of CH4 in landfill gas (IPCC default)
    "ox": 0.0,      # oxidation factor: 0 for unmanaged / uncovered sites (IPCC default)
    "gwp": 28.0,    # CH4 global warming potential, 100 yr, IPCC AR5 (used in EU and UNFCCC reporting)
    "phi": 0.85,    # model-uncertainty deduction applied by CDM waste methodologies (AMS-III.AF / SWDS tool)
    "tree_tco2": 0.060,      # US EPA: t CO2 sequestered by one urban tree seedling grown for 10 years
    "rdf_plastic": 0.5,      # plastic share of RDF by weight - an ASSUMPTION; set from a lab test
}
_IMPACT_ENV = {"mcf": "TTD_CH4_MCF", "doc": "TTD_CH4_DOC", "docf": "TTD_CH4_DOCF", "f": "TTD_CH4_F",
               "ox": "TTD_CH4_OX", "gwp": "TTD_GWP_CH4", "phi": "TTD_CREDIT_PHI", "tree_tco2": "TTD_TREE_TCO2",
               "rdf_plastic": "TTD_RDF_PLASTIC_SHARE"}


def _impact_factors() -> dict:
    out = {}
    for k, default in IMPACT_DEFAULTS.items():
        try:
            out[k] = float(os.environ.get(_IMPACT_ENV[k], "") or default)
        except ValueError:
            logger.warning("Ignoring bad %s; using %s", _IMPACT_ENV[k], default)
            out[k] = default
    return out


def impact(processed_mt: float, rdf_mt: float) -> dict:
    """Methane avoided, CO2e, tree equivalent, potential carbon credits and EPR-eligible plastic.

    processed_mt: legacy waste excavated and processed (MSW inward, all time).
    rdf_mt:       RDF dispatched (all time).
    """
    f = _impact_factors()
    ch4_per_t = f["mcf"] * f["doc"] * f["docf"] * f["f"] * 16 / 12 * (1 - f["ox"])
    ch4 = processed_mt * ch4_per_t
    co2e = ch4 * f["gwp"]
    return {
        "ch4_t": round(ch4, 1),
        "co2e_t": round(co2e, 1),
        "trees": int(round(co2e / f["tree_tco2"])) if f["tree_tco2"] > 0 else 0,
        "carbon_credits": int(round(co2e * f["phi"])),
        "epr_plastic_t": round(rdf_mt * f["rdf_plastic"], 1),
        "inputs": {"processed_mt": processed_mt, "rdf_mt": rdf_mt, "ch4_per_t": round(ch4_per_t, 5)},
        "factors": f,
    }


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------
def overview() -> dict:
    awarded = float(os.environ.get("TTD_AWARDED_MT", "51290"))
    tot = adex_get("totals", ttl=30)
    day = adex_get("summary", {"from": _today().isoformat(), "to": _today().isoformat()}, ttl=30)
    mats = tot.get("materials") or {}
    mt = lambda m: round((mats.get(m) or {}).get("net_kg", 0) / 1000, 2)  # noqa: E731
    processed = mt(INWARD)
    d0 = (day.get("days") or [{}])[0] if day.get("days") else {}
    today_mats = d0.get("by_material") or {}
    return {
        "awarded_mt": awarded,
        "processed_mt": processed,
        "balance_mt": round(max(0.0, awarded - processed), 2),
        "pct": round(min(100.0, processed / awarded * 100), 1) if awarded else 0,
        "trips_today": int(d0.get("trips", 0)) + int(d0.get("pending", 0)),
        "trips_today_complete": int(d0.get("trips", 0)),
        "inward_today_mt": round((today_mats.get(INWARD) or {}).get("net_kg", 0) / 1000, 2),
        "disposed": {m: mt(m) for m in DISPOSED},
        "disposed_total_mt": round(sum(mt(m) for m in DISPOSED), 2),
        "impact": impact(processed, mt("RDF")),
        "updated": datetime.now(IST).strftime("%d %b %Y, %H:%M"),
    }


def _parse_range(view: str, frm: str | None, to: str | None):
    today = _today()
    if view not in ("day", "month"):
        raise ValueError("view must be day or month")
    if not frm or not DATE_RE.match(frm):
        frm = (today.replace(day=1) if view == "day" else today.replace(month=1, day=1)).isoformat()
    if not to or not DATE_RE.match(to):
        to = today.isoformat()
    a, b = date.fromisoformat(frm), date.fromisoformat(to)
    if b < a:
        a, b = b, a
    if b > today:
        b = today
    limit = 366 if view == "day" else 1830
    if (b - a).days > limit:
        raise ValueError("Choose at most one year for day-wise, five years for month-wise.")
    return view, a, b


def report(view: str, frm: str | None, to: str | None) -> dict:
    view, a, b = _parse_range(view, frm, to)
    s = adex_get("summary", {"from": a.isoformat(), "to": b.isoformat()}, ttl=60)
    rows: dict[str, dict] = {}
    # every day / month in the range gets a row, so gaps are visible
    d = a
    while d <= b:
        k = d.isoformat() if view == "day" else d.strftime("%Y-%m")
        rows.setdefault(k, {"key": k, "trips": 0, **{m: 0.0 for m in MATERIALS}})
        d += timedelta(days=1)
    for day in s.get("days") or []:
        k = day["date"] if view == "day" else day["date"][:7]
        if k not in rows:
            continue
        r = rows[k]
        r["trips"] += int(day.get("trips", 0))
        for m, v in (day.get("by_material") or {}).items():
            col = m if m in MATERIALS else "Others"
            r[col] += v.get("net_kg", 0) / 1000
    keys = sorted(rows)
    if view == "month":
        # months before the first recorded trip are not part of the project yet
        first = next((k for k in keys if any(day["date"].startswith(k) for day in s.get("days") or [])), None)
        keys = [k for k in keys if first and k >= first] or keys[-1:]
    out = []
    for k in keys:
        r = rows[k]
        for m in MATERIALS:
            r[m] = round(r[m], 2)
        r["disposed"] = round(sum(r[m] for m in DISPOSED), 2)
        r["label"] = (date.fromisoformat(k).strftime("%d %b %Y") if view == "day"
                      else datetime.strptime(k, "%Y-%m").strftime("%b %Y"))
        out.append(r)
    total = {"trips": sum(r["trips"] for r in out), **{m: round(sum(r[m] for r in out), 2) for m in MATERIALS}}
    total["disposed"] = round(sum(total[m] for m in DISPOSED), 2)
    return {"view": view, "from": a.isoformat(), "to": b.isoformat(), "materials": MATERIALS,
            "inward": INWARD, "disposed_materials": DISPOSED, "rows": out, "total": total}


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
def _login_page(error=None, status=200):
    return render_template("ttd/login.html", error=error, captcha_question=captcha.current_question(),
                           captcha_nonce=captcha.current_nonce()), status


@bp.route("/ttd", strict_slashes=False)
def lower():
    return redirect(url_for("ttd.home"), 301)


@bp.route("/TTD", methods=["GET", "POST"], strict_slashes=False)
def home():
    if request.method == "GET":
        if session.get(SESSION_KEY) == USERNAME:
            return render_template("ttd/dashboard.html", user=USERNAME,
                                   awarded=float(os.environ.get("TTD_AWARDED_MT", "51290")))
        return _login_page()

    ip = captcha.client_ip()
    blocked, retry = captcha.is_blocked(ip)
    if blocked:
        body, _ = _login_page(f"Too many failed attempts. Try again in {max(1, retry // 60)} minute(s).")
        return body, 429, {"Retry-After": str(retry)}
    if not captcha.verify(request.form.get("captcha_answer", ""), nonce=request.form.get("captcha_nonce", "")):
        return _login_page("The answer to the sum was not right. Please try the new one.", 400)
    username = (request.form.get("username") or "").strip()
    if not verify_credentials(username, request.form.get("password") or ""):
        count, just_blocked = captcha.register_failure(ip)
        current_app.logger.info("Failed TTD login user=%r ip=%s count=%d", username, ip, count)
        if just_blocked:
            return _login_page(f"Too many failed attempts. Try again in {captcha.BLOCK_SECONDS // 60} minute(s).", 429)
        left = max(0, captcha.MAX_FAILURES - count)
        msg = "Incorrect username or password." + (f" {left} attempt(s) left." if left and left <= 2 else "")
        return _login_page(msg, 401)
    captcha.clear_failures(ip)
    session.clear()
    session[SESSION_KEY] = USERNAME
    session.permanent = True
    return redirect(url_for("ttd.home"))


@bp.route("/TTD/logout")
def logout():
    session.pop(SESSION_KEY, None)
    return redirect(url_for("ttd.home"))


# ---------------------------------------------------------------------------
# JSON for the dashboard
# ---------------------------------------------------------------------------
def _json_or_error(fn):
    try:
        return jsonify(fn())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except AdexError as e:
        return jsonify({"error": str(e)}), 503


@bp.route("/TTD/api/overview")
@ttd_login_required
def api_overview():
    return _json_or_error(overview)


@bp.route("/TTD/api/report")
@ttd_login_required
def api_report():
    a = request.args
    return _json_or_error(lambda: report(a.get("view", "day"), a.get("from"), a.get("to")))


@bp.route("/TTD/api/live/state")
@ttd_login_required
def api_live_state():
    return _json_or_error(lambda: adex_get("live/state", timeout=8))


@bp.route("/TTD/api/live/<cam>.jpg")
@ttd_login_required
def api_live_picture(cam):
    if not CAM_RE.match(cam):
        return jsonify({"error": "No such camera."}), 404
    q = request.args.get("q", "")
    params = {"q": q} if q in ("low", "normal", "high") else {}
    if request.args.get("start") == "1":
        params["start"] = 1          # the Watch button: starts a viewing session in the relay
    try:
        r = adex_get(f"live/{cam}.jpg", params or None, raw=True, timeout=8)
    except AdexError as e:
        return jsonify({"error": str(e)}), 503
    if r.status_code == 204:
        return Response(status=204)
    if r.status_code == 410:         # the relay ended this Watch (time limit); Watch again restarts it
        try:
            msg = r.json().get("detail")
        except Exception:
            msg = None
        return jsonify({"error": msg or "Viewing time is over. Click Watch to see it again."}), 410
    if r.status_code != 200 or not r.content.startswith(b"\xff\xd8"):
        return jsonify({"error": "No picture."}), 502
    return Response(r.content, mimetype="image/jpeg",
                    headers={"X-Age": r.headers.get("X-Age", ""), "Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------
@bp.route("/TTD/report.pdf")
@ttd_login_required
def report_pdf():
    a = request.args
    try:
        rep = report(a.get("view", "day"), a.get("from"), a.get("to"))
        ov = overview()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except AdexError as e:
        return jsonify({"error": str(e)}), 503
    pdf = build_pdf(rep, ov)
    name = f"TTD-{'daywise' if rep['view'] == 'day' else 'monthwise'}-{rep['from']}-to-{rep['to']}.pdf"
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def build_pdf(rep: dict, ov: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from reportlab.lib.styles import ParagraphStyle

    static = os.path.join(current_app.static_folder, "ttd")
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm,
                            topMargin=10 * mm, bottomMargin=12 * mm,
                            title=f"TTD legacy waste report {rep['from']} to {rep['to']}")
    green, deep, ink = colors.HexColor("#0F7A3E"), colors.HexColor("#0E5230"), colors.HexColor("#121A14")
    h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, textColor=ink, leading=19)
    sm = ParagraphStyle("sm", fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#5C6B62"), leading=12)
    k = ParagraphStyle("k", fontName="Helvetica-Bold", fontSize=8, textColor=green, leading=10)

    head = Table([[Image(os.path.join(static, "tharuni.png"), 18 * mm, 18 * mm),
                   [Paragraph("LEGACY WASTE REMEDIATION", k),
                    Paragraph("Tirumala Tirupati Devasthanams", h1),
                    Paragraph(f"{'Day-wise' if rep['view'] == 'day' else 'Month-wise'} report · "
                              f"{rep['from']} to {rep['to']} · generated {ov['updated']} IST", sm)],
                   Image(os.path.join(static, "ttd.png"), 17 * mm, 18.8 * mm)]],
                 colWidths=[24 * mm, None, 22 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 1.5, green),
                              ("BOTTOMPADDING", (0, 0), (-1, 0), 6)]))

    kpi = [["Awarded legacy qty", "Inward processed (all time)", "Balance", "Progress",
            "Soil", "Inert", "CnD", "RDF", "Scrap"],
           [f"{ov['awarded_mt']:,.0f} MT", f"{ov['processed_mt']:,.2f} MT", f"{ov['balance_mt']:,.2f} MT",
            f"{ov['pct']}%"] + [f"{ov['disposed'][m]:,.2f}" for m in DISPOSED]]
    kt = Table(kpi)
    kt.setStyle(TableStyle([("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5), ("TEXTCOLOR", (0, 0), (-1, 0), green),
                            ("FONT", (0, 1), (-1, 1), "Helvetica-Bold", 10),
                            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD4CE")),
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2FBF4"))]))

    cols = ["Day" if rep["view"] == "day" else "Month", "Trips", "MSW inward"] + DISPOSED + ["Others", "Disposed total"]
    body = [cols]
    for r in rep["rows"]:
        body.append([r["label"], r["trips"], f"{r['MSW']:,.2f}"] + [f"{r[m]:,.2f}" for m in DISPOSED]
                    + [f"{r['Others']:,.2f}", f"{r['disposed']:,.2f}"])
    t = rep["total"]
    body.append(["Total", t["trips"], f"{t['MSW']:,.2f}"] + [f"{t[m]:,.2f}" for m in DISPOSED]
                + [f"{t['Others']:,.2f}", f"{t['disposed']:,.2f}"])
    tbl = Table(body, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#151515")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("LINEBELOW", (0, 1), (-1, -2), 0.25, colors.HexColor("#CBD4CE")),
        ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 9), ("LINEABOVE", (0, -1), (-1, -1), 1, deep),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E8EDEA")),
    ]))
    doc.build([head, Spacer(1, 5 * mm), kt, Spacer(1, 5 * mm),
               Paragraph("Weights in MT (net). MSW is the legacy waste processed; Soil, Inert, CnD, RDF and Scrap are "
                         "disposals. Complete trips only.", sm), Spacer(1, 2 * mm), tbl])
    return buf.getvalue()
