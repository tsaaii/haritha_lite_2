"""
Weighbridge image proxy + 2x2 viewer.

A standalone blueprint, deliberately NOT folded into views/reports.py or
views/sites.py: BOTH pages need these routes, and duplicating them would mean
two copies of the authorisation check to keep in sync. One copy, one place to
audit.

    GET /record-images/<site>/<date>/<ticket>            -> 2x2 HTML sheet
    GET /record-images/<site>/<date>/<ticket>/<slot>.jpg -> one JPEG

WHY PROXY INSTEAD OF <img src="https://weighbridge-api-.../records/...">
    Reads on the records API are open — no key required. Pointing the browser
    straight at it would publish an unauthenticated endpoint for every site's
    records in the page source of a login-gated page. Anyone who reaches the
    Ananthapur dashboard could then read every other site's data. Everything
    goes through Flask, behind the checks the rest of the page already uses.

AUTHORISATION MODEL
    Global login   -> every site. Matches /reports, which already shows all
                      sites to any globally logged-in user. No weakening.
    Per-site login -> only the upstream names listed in that slug's
                      api_site_names.

    A visitor who unlocked Ananthapur cannot read Tirupathi's images by
    editing the URL. _authorized() is what stops that; it is load-bearing.

RATE LIMIT
    The records API allows 120 req/min per IP, and every proxied image leaves
    from App Engine's egress IP — ONE IP shared by all your users. Four images
    per popup adds up quickly, so responses are cached both in-process (below)
    and in the browser (Cache-Control).
"""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from urllib.parse import quote

import requests
from flask import (
    Blueprint, Response, abort, current_app, render_template, session, url_for,
)

import config
from data import master
from views.login import SESSION_USER_KEY
from views.sites import SESSION_SITE_KEY

logger = logging.getLogger(__name__)

bp = Blueprint("record_images", __name__, url_prefix="/record-images")


# Order matters — this IS the 2x2 layout, read left-to-right, top-to-bottom:
#
#     first_front  | first_back
#     second_front | second_back
#
# Change the order here and the grid re-orders; the template just iterates.
SLOTS: tuple[tuple[str, str], ...] = (
    ("first_front",  "First weight — front"),
    ("first_back",   "First weight — back"),
    ("second_front", "Second weight — front"),
    ("second_back",  "Second weight — back"),
)
SLOT_KEYS: tuple[str, ...] = tuple(slot for slot, _ in SLOTS)

_TIMEOUT = 20


# ---------------------------------------------------------------------------
# In-process byte cache
#
# Browser Cache-Control covers one user re-opening the same ticket. This covers
# several users opening the same ticket, which is the common case when someone
# flags a suspicious record and the team goes to look at it.
#
# Bounded by TOTAL BYTES, not entry count. Weighbridge captures vary widely in
# size and an F2 instance has 512 MB — an entry-count cap would happily hold
# 200 large JPEGs and OOM the instance.
# ---------------------------------------------------------------------------
_CACHE_MAX_BYTES = 48 * 1024 * 1024
_CACHE_TTL_S = 900

_cache: "OrderedDict[str, tuple[float, str, bytes]]" = OrderedDict()
_cache_bytes = 0
_cache_lock = threading.Lock()


def _evict_locked(key: str) -> None:
    """Remove one entry. Caller MUST already hold _cache_lock."""
    global _cache_bytes
    entry = _cache.pop(key, None)
    if entry is not None:
        _cache_bytes -= len(entry[2])


def _cache_get(key: str):
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None
        expires, ctype, blob = entry
        if expires < time.time():
            _evict_locked(key)
            return None
        _cache.move_to_end(key)          # LRU touch
        return ctype, blob


def _cache_put(key: str, ctype: str, blob: bytes) -> None:
    global _cache_bytes
    # One oversized image should not be able to evict the whole cache.
    if len(blob) > _CACHE_MAX_BYTES // 4:
        return
    with _cache_lock:
        _evict_locked(key)
        _cache[key] = (time.time() + _CACHE_TTL_S, ctype, blob)
        _cache_bytes += len(blob)
        while _cache_bytes > _CACHE_MAX_BYTES and _cache:
            _evict_locked(next(iter(_cache)))


def cache_stats() -> dict:
    """For /healthz or ad-hoc debugging."""
    with _cache_lock:
        return {"entries": len(_cache), "bytes": _cache_bytes,
                "max_bytes": _CACHE_MAX_BYTES}


def invalidate_cache() -> None:
    global _cache_bytes
    with _cache_lock:
        _cache.clear()
        _cache_bytes = 0


# ---------------------------------------------------------------------------
# Authorisation
# ---------------------------------------------------------------------------

def _authorized(site_name: str) -> bool:
    """True if the current session may read images for this upstream name.

    NOTE the comparison is EXACT against api_site_names, not a prefix or
    substring test. The records API does partial matching on site_name, and a
    substring check here would let an "Ananthapur" grant reach "Ananthapur2".
    """
    if session.get(SESSION_USER_KEY):
        return True

    granted = session.get(SESSION_SITE_KEY) or []
    if not granted:
        return False

    wanted = (site_name or "").strip()
    if not wanted:
        return False

    for slug in granted:
        site = master.get_site_by_slug(slug)
        if site is None:
            continue
        if wanted in (site.api_site_names or ()):
            return True
    return False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@bp.route("/<site>/<date>/<ticket>")
def sheet_view(site, date, ticket):
    """The 2x2 sheet, opened in a new tab from a records table."""
    if not _authorized(site):
        abort(403)

    tiles = [
        {
            "slot": slot,
            "label": label,
            "url": url_for("record_images.image_proxy",
                           site=site, date=date, ticket=ticket, slot=slot),
        }
        for slot, label in SLOTS
    ]
    return render_template(
        "record_images.html",
        heading=f"Ticket {ticket}",
        subheading=f"{site} · {date}",
        tiles=tiles,
    )


@bp.route("/<site>/<date>/<ticket>/<slot>.jpg")
def image_proxy(site, date, ticket, slot):
    """Stream one JPEG from the records API."""
    if slot not in SLOT_KEYS:
        abort(404)
    if not _authorized(site):
        abort(403)

    key = f"{site}|{date}|{ticket}|{slot}"
    cached = _cache_get(key)
    if cached is not None:
        ctype, blob = cached
        return _respond(blob, ctype, cache_state="HIT")

    url = (f"{config.RECORDS_API_BASE}/records/{quote(site, safe='')}"
           f"/{quote(date, safe='')}/{quote(ticket, safe='')}/image/{slot}")
    try:
        r = requests.get(url, timeout=_TIMEOUT)
    except Exception as exc:  # noqa: BLE001
        current_app.logger.warning("image proxy request failed %s: %s", url, exc)
        abort(502)

    # 404 is normal, not an error: it means this record has no image in this
    # slot. The template's onerror handler turns it into "No image in this
    # slot", which is why we pass it through instead of substituting a
    # placeholder here.
    if r.status_code == 404:
        abort(404)
    if r.status_code == 429:
        current_app.logger.warning(
            "image proxy rate-limited upstream — consider raising the cache TTL")
        abort(429)
    if r.status_code >= 400:
        current_app.logger.warning("image proxy upstream %s for %s",
                                   r.status_code, url)
        abort(502)

    ctype = r.headers.get("Content-Type", "image/jpeg")
    _cache_put(key, ctype, r.content)
    return _respond(r.content, ctype, cache_state="MISS")


def _respond(blob: bytes, ctype: str, cache_state: str) -> Response:
    return Response(
        blob,
        mimetype=ctype,
        headers={
            # `private` is the important word: this is gated content, so it
            # must never land in a shared or CDN cache where an
            # unauthenticated request could pick it up.
            "Cache-Control": "private, max-age=86400",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
            "X-Image-Cache": cache_state,
            "Content-Length": str(len(blob)),
        },
    )
