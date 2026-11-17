"""
Login / logout for the gated pages (/reports, /admin/refresh-cache, ...).

Sign-in is now the one PIN popup on /sac (views/sac.py, PINs in pins.py):
    GET/POST /login   -> /sac?login=1&next=<where you were going>
    GET      /logout  -> clears the session (also the RDF and /sac sign-in), back to /sac

The old username + password form (auth.py) is no longer used. Also exposes the
`login_required` decorator, which sends signed-out visitors to the PIN popup.
"""
from __future__ import annotations

from functools import wraps
from urllib.parse import urlparse

from flask import (
    Blueprint, redirect, request, session, url_for,
)

from views import sac


bp = Blueprint("login", __name__)

SESSION_USER_KEY = "auth_user"


# --------------------------------------------------------------------------
# Decorator
# --------------------------------------------------------------------------

def login_required(view):
    """Redirect to /login?next=<current_url> if the user isn't logged in."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get(SESSION_USER_KEY):
            return redirect(sac.login_url(request.path))
        return view(*args, **kwargs)
    return wrapped


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _is_safe_redirect_target(target: str) -> bool:
    """Allow only same-host, path-only redirects.

    Stops `?next=https://evil.example.com` open-redirect attacks.
    """
    if not target:
        return False
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc:
        return False
    return target.startswith("/")


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@bp.route("/login", methods=["GET", "POST"])
def login_view():
    nxt = request.args.get("next") or request.form.get("next") or ""
    if session.get(SESSION_USER_KEY):
        return redirect(nxt if _is_safe_redirect_target(nxt) else url_for("sac.portal"))
    return redirect(sac.login_url(nxt if _is_safe_redirect_target(nxt) else ""), code=303)


@bp.route("/logout")
def logout_view():
    session.clear()
    return redirect(url_for("overview"))
