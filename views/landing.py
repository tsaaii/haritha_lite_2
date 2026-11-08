"""
Advitia Labs landing / pitch page.

    GET /       -> pitch page (advitiaum.com)
    GET /main   -> same page (canonical URL is "/")

Fully static: no data calls, no session, no login. Everything it needs lives
in templates/landing/ and static/landing/. The Swachha Andhra dashboard that
used to live at "/" is now at /sac (main.py).

On rdf.advitiaum.com, "/" is answered by views/rdf_report.py's
before_app_request hook before this view is reached.
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime

from flask import Blueprint, make_response, render_template, request

import config
from views.landing_api import INTERESTS, form_token

bp = Blueprint("landing", __name__, template_folder="../templates")

_STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "landing")
_VERSIONED = ("css/landing.css", "js/landing.js", "js/calculator.js", "js/contact.js", "js/track.js",
              "js/whitepaper.js", "css/hero-scenes.css", "js/hero-scenes.js", "js/hero-lab.js")

CANONICAL_URL = "https://advitiaum.com/"
CONTACT_EMAIL = "wecare@advitiaum.com"

# script-src has no 'unsafe-inline': all JS is in static files. style-src needs
# 'unsafe-inline' for the style="" attributes on data-driven bar widths.
_CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
])


def _asset_version() -> str:
    """Short content hash of the page's CSS + JS, for ?v= cache busting.

    Computed once per process; a deploy ships new files and a new process.
    App Engine may not let the app read files matched by a static handler, so
    fall back to GAE_VERSION, which is unique per deploy.
    """
    h = hashlib.sha256()
    try:
        for rel in _VERSIONED:
            with open(os.path.join(_STATIC, rel), "rb") as fh:
                h.update(fh.read())
    except OSError:
        return os.environ.get("GAE_VERSION", "dev")
    return h.hexdigest()[:10]


ASSET_V = _asset_version()


@bp.route("/", strict_slashes=False)
@bp.route("/main", strict_slashes=False)
def index():
    html = render_template(
        "landing/index.html",
        v=ASSET_V,
        canonical_url=CANONICAL_URL,
        email=CONTACT_EMAIL,
        year=datetime.now(config.IST).year,
        form_t=form_token(),
        interests=INTERESTS,
        sent=request.args.get("sent"),  # no-JS form fallback result
    )
    resp = make_response(html)
    # private: the page embeds a signed form timestamp; keep shared caches out of it.
    resp.headers["Cache-Control"] = "private, max-age=300"
    resp.headers["Content-Security-Policy"] = _CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp


@bp.route("/lab/hero", strict_slashes=False)
def lab_hero():
    """Preview of the hero word scenes (static/landing/js/hero-scenes.js). Not linked, not indexed."""
    resp = make_response(render_template("landing/lab_hero.html", v=ASSET_V))
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Content-Security-Policy"] = _CSP
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp
