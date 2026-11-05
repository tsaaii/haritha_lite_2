"""
Meeting invite builder for the MD Peshi (Gideon, PA to MD, SAC) at /peshi.

Routes:
    GET  /peshi/          sign-in page (password + math captcha), or the builder once signed in
    POST /peshi/login     check captcha, then password; 5 wrong tries lock the IP for 15 minutes
    GET  /peshi/logout
    /peshi, /PESHI, /Peshi -> 301 to /peshi/

The builder is one static page: everything (form, live preview, PNG export, copy to
clipboard) runs in the browser, so the server only renders two small templates. No data
about a meeting is ever sent to the server.

Built from the Claude Design handoff "Meeting Invite Builder". See docs/peshi.md.

Configuration (environment, optional):
    PESHI_PASSWORD_HASH   werkzeug hash to replace the built-in password
"""
from __future__ import annotations

import hashlib
import logging
import os

from flask import Blueprint, make_response, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

import captcha

logger = logging.getLogger(__name__)
bp = Blueprint("peshi", __name__)

URL_PREFIX = "/peshi"
SESSION_KEY = "peshi_ok"
# Hash of the built-in password (the password itself is not written in the repo).
_DEFAULT_HASH = (
    "scrypt:32768:8:1$YS72LuOwBRpSLOcO$4f8985e66a68cc3e826a160c141a50f0ee786ee3efae46da67f0abaeb68e45dd07"
    "a924e362a44aa4442fdb734fb2d2a90241d87fbd4520cfb98a45197ebba5e8"
)

# Everything is same-origin. img-src needs data:/blob: for the PNG export (html-to-image
# draws the card into an SVG data URL, then a canvas).
CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; "
       "font-src 'self' data:; connect-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; "
       "form-action 'self'; object-src 'none'")

_STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "peshi")
_VERSIONED = ("peshi.css", "peshi.js", "html-to-image.min.js", "left.png", "right.png")


def _asset_version() -> str:
    """Short content hash of the page's assets, for ?v= cache busting (see app.yaml /static/peshi)."""
    h = hashlib.sha256()
    try:
        for rel in _VERSIONED:
            with open(os.path.join(_STATIC, rel), "rb") as fh:
                h.update(fh.read())
    except OSError:
        return os.environ.get("GAE_VERSION", "dev")
    return h.hexdigest()[:10]


ASSET_V = _asset_version()


def _password_hash() -> str:
    return os.environ.get("PESHI_PASSWORD_HASH", "").strip() or _DEFAULT_HASH


def _signed_in() -> bool:
    return bool(session.get(SESSION_KEY))


def _page(body, status: int = 200):
    resp = make_response(body, status)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.after_request
def _security_headers(resp):
    if request.path.lower().startswith(URL_PREFIX):
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    return resp


@bp.route(URL_PREFIX)
@bp.route("/PESHI", strict_slashes=False)
@bp.route("/Peshi", strict_slashes=False)
def root():
    return redirect(url_for("peshi.home"), code=301)


@bp.route(URL_PREFIX + "/")
def home():
    if not _signed_in():
        return _login_page()
    return _page(render_template("peshi/builder.html", v=ASSET_V))


def _login_page(error: str = "", status: int = 200):
    return _page(render_template(
        "peshi/login.html", error=error, v=ASSET_V,
        captcha_question=captcha.current_question(), captcha_nonce=captcha.current_nonce()), status)


@bp.route(URL_PREFIX + "/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return redirect(url_for("peshi.home"))
    ip = captcha.client_ip()
    blocked, retry = captcha.is_blocked(ip)
    if blocked:
        resp = _login_page(f"Too many wrong tries. Try again in {max(1, retry // 60)} minute(s).", 429)
        resp.headers["Retry-After"] = str(retry)
        return resp

    # Captcha first: it is cheap, and it keeps bots off the (slow, scrypt) password check.
    if not captcha.verify(request.form.get("captcha_answer", ""), nonce=request.form.get("captcha_nonce", "")):
        return _login_page("The security check answer was wrong. Try the new one.", 400)

    pw = (request.form.get("password") or "").strip()
    try:
        ok = bool(pw) and check_password_hash(_password_hash(), pw)
    except Exception:
        ok = False
    if not ok:
        count, just_blocked = captcha.register_failure(ip)
        logger.info("peshi wrong password ip=%s count=%d", ip, count)
        if just_blocked:
            return _login_page(f"Too many wrong tries. Try again in {captcha.BLOCK_SECONDS // 60} minute(s).", 429)
        left = max(0, captcha.MAX_FAILURES - count)
        return _login_page("Incorrect password." + (f" {left} attempt(s) left." if left and left <= 2 else ""), 401)

    captcha.clear_failures(ip)
    session[SESSION_KEY] = True
    session.permanent = True
    return redirect(url_for("peshi.home"))


@bp.route(URL_PREFIX + "/logout")
def logout():
    session.pop(SESSION_KEY, None)
    return redirect(url_for("peshi.home"))
