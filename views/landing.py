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
              "js/whitepaper.js", "css/hero-scenes.css", "js/hero-scenes.js", "js/hero-lab.js", "js/hero-init.js",
              "js/prefs.js", "css/legal.css")

CANONICAL_URL = "https://advitiaum.com/"
CONTACT_EMAIL = "wecare@advitiaum.com"

# script-src has no 'unsafe-inline': all JS is in static files. style-src needs
# 'unsafe-inline' for the style="" attributes on data-driven bar widths.
# The Google hosts are for the translate menu (js/prefs.js). Google's script is loaded only
# after a visitor picks a language, so nothing is fetched from Google until then.
_GT = "https://translate.google.com https://translate.googleapis.com https://translate-pa.googleapis.com"
_CSP = "; ".join([
    "default-src 'self'",
    f"script-src 'self' {_GT} https://www.gstatic.com",
    f"style-src 'self' 'unsafe-inline' https://www.gstatic.com https://translate.googleapis.com",
    f"img-src 'self' data: https://www.gstatic.com https://www.google.com {_GT}",
    "font-src 'self'",
    f"connect-src 'self' {_GT}",
    f"frame-src {_GT}",
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


# ---------------------------------------------------------------------------
# Legal / compliance pages (linked from the footer)
# ---------------------------------------------------------------------------
LEGAL_UPDATED = "8 November 2026"
LEGAL_PAGES = {
    "privacy": "Privacy policy",
    "terms": "Terms of use",
    "cookies": "Cookies and local storage",
    "accessibility": "Accessibility statement",
}


def _legal(slug: str):
    html = render_template(f"landing/legal/{slug}.html", v=ASSET_V, title=LEGAL_PAGES[slug], slug=slug,
                           pages=LEGAL_PAGES, updated=LEGAL_UPDATED, email=CONTACT_EMAIL,
                           canonical_url=f"{CANONICAL_URL}{slug}", year=datetime.now(config.IST).year)
    resp = make_response(html)
    resp.headers["Cache-Control"] = "public, max-age=3600"
    resp.headers["Content-Security-Policy"] = _CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp


@bp.route("/privacy", strict_slashes=False)
def privacy():
    return _legal("privacy")


@bp.route("/terms", strict_slashes=False)
def terms():
    return _legal("terms")


@bp.route("/cookies", strict_slashes=False)
def cookies():
    return _legal("cookies")


@bp.route("/accessibility", strict_slashes=False)
def accessibility():
    return _legal("accessibility")
