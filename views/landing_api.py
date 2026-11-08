"""
Landing page APIs: contact form + visit tracker.

    POST /api/contact   -> lead: validated, forwarded to the Apps Script
                           (apps_script/landing/Code.gs), which appends a row to
                           the "Leads" sheet and emails the team.
    POST /api/seen      -> visit beacon from static/landing/js/track.js. Enriched
                           here (App Engine geo headers, network name, device) and
                           forwarded to the same script ("Visits" sheet).
    POST /api/wp        -> white-paper popup choice (static/landing/js/whitepaper.js)
    GET  /whitepaper    -> the white paper PDF (?dl=1 download, ?r=<who> tag); each open logged
                           Both go to the "White paper" sheet WITH the full IP (disclosed in the popup).

Privacy: for leads and visits the visitor IP is anonymised here (IPv4 /24, IPv6 /48)
before it is logged or forwarded; white-paper events keep the full IP (see below). The full IP is only used in memory for the optional
network lookup (IPINFO_TOKEN) and the per-IP rate limits.

Config (app.yaml env_variables):
    LANDING_SCRIPT_URL    Apps Script web-app /exec URL (empty -> form shows email fallback)
    LANDING_SCRIPT_TOKEN  shared secret, must equal CONFIG.TOKEN in Code.gs
    IPINFO_TOKEN          optional, free ipinfo.io "Lite" token -> network/ASN name
"""
from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime
from urllib.parse import urlsplit

import requests
from flask import Blueprint, jsonify, redirect, request
from itsdangerous import BadSignature, URLSafeTimedSerializer

import config

logger = logging.getLogger(__name__)
bp = Blueprint("landing_api", __name__)

SCRIPT_URL = os.environ.get("LANDING_SCRIPT_URL", "").strip()
SCRIPT_TOKEN = os.environ.get("LANDING_SCRIPT_TOKEN", "").strip()
IPINFO_TOKEN = os.environ.get("IPINFO_TOKEN", "").strip()
CONTACT_EMAIL = "wecare@advitiaum.com"
UPSTREAM_TIMEOUT_S = 12

INTERESTS = {
    "pilot-legacy": "Pilot: legacy landfill",
    "pilot-household": "Pilot: household waste",
    "investing": "Investing",
    "partnership": "Partnership / offtake",
    "other": "Something else",
}
EMAIL_RE = re.compile(r"^[^@\s<>\"',;]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$")
BOT_UA_RE = re.compile(
    r"bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|"
    r"gtmetrix|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|okhttp|go-http|java/|"
    r"facebookexternalhit|embedly|preview|scrapy|ahrefs|semrush|bingpreview|petalbot|bytespider|"
    r"^whatsapp/|telegrambot|skypeuripreview|discordbot|slackbot|linkedinbot|twitterbot|applebot",
    re.I)
DATACENTER_RE = re.compile(
    r"amazon|aws|google llc|google cloud|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai connected|"
    r"alibaba|oracle|contabo|vultr|choopa|leaseweb|tencent|scaleway|m247|datacamp|hostinger",
    re.I)

FORM_MIN_SECONDS = 3          # humans don't fill three fields in under 3 s
FORM_MAX_AGE = 2 * 24 * 3600  # page token older than this -> reload


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _clean(v, n: int) -> str:
    """Trim, collapse control chars, cap length. Never trust beacon/form input."""
    if v is None:
        return ""
    s = str(v).replace("\x00", "")
    s = re.sub(r"[\r\t\f\v]+", " ", s)
    return s.strip()[:n]


def _one_line(v, n: int) -> str:
    return re.sub(r"\s+", " ", _clean(v, n))


def client_ip() -> str:
    """App Engine puts the caller's address in X-Appengine-User-Ip; else first X-Forwarded-For hop."""
    ip = request.headers.get("X-Appengine-User-Ip", "").strip()
    if not ip:
        fwd = request.headers.get("X-Forwarded-For", "")
        ip = fwd.split(",")[0].strip() if fwd else (request.remote_addr or "")
    return ip


def anonymize_ip(ip: str) -> str:
    """IPv4 -> a.b.c.0, IPv6 -> /48. Unparseable -> ''."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ""
    if addr.version == 4:
        return str(ipaddress.ip_network(f"{ip}/24", strict=False).network_address)
    return str(ipaddress.ip_network(f"{ip}/48", strict=False).network_address) + "/48"


def geo() -> dict:
    """App Engine adds these headers to every request for free (absent locally)."""
    h = request.headers
    city = h.get("X-Appengine-City", "").strip()
    city = "" if city in ("", "?") else city.title()
    country = h.get("X-Appengine-Country", "").strip().upper()
    country = "" if country in ("", "ZZ") else country
    region = h.get("X-Appengine-Region", "").strip().upper()
    region = "" if region in ("", "?") else region
    latlng = h.get("X-Appengine-Citylatlong", "").strip()
    latlng = "" if latlng in ("", "0.000000,0.000000") else latlng
    return {"city": city, "region": (f"{country}-{region}" if country and region else region),
            "country": country, "latlng": latlng}


def parse_ua(ua: str) -> dict:
    """Coarse device / OS / browser. Good enough to tell 'iPhone Safari' from 'Windows Chrome'."""
    u = ua or ""
    if re.search(r"iPad|Tablet|Android(?!.*Mobile)", u):
        device = "Tablet"
    elif re.search(r"Mobi|iPhone|Android", u):
        device = "Mobile"
    else:
        device = "Desktop"
    os_ = ("iOS" if re.search(r"iPhone|iPad|iPod", u) else "Android" if "Android" in u
           else "Windows" if "Windows" in u else "macOS" if "Mac OS X" in u or "Macintosh" in u
           else "ChromeOS" if "CrOS" in u else "Linux" if "Linux" in u else "Other")
    browser = ("Edge" if "Edg/" in u else "Opera" if "OPR/" in u else "Samsung Internet" if "SamsungBrowser" in u
               else "Chrome" if ("Chrome/" in u or "CriOS" in u) else "Firefox" if ("Firefox/" in u or "FxiOS" in u)
               else "Safari" if "Safari/" in u else "Other")
    return {"device": device, "os": os_, "browser": browser}


def is_bot_ua(ua: str) -> bool:
    return not ua or bool(BOT_UA_RE.search(ua))


def same_origin() -> bool:
    """POSTs must come from our own pages. Browsers always send Origin on POST."""
    origin = request.headers.get("Origin") or request.headers.get("Referer") or ""
    if not origin:
        return False
    return urlsplit(origin).netloc.lower() == request.host.lower()


class RateLimit:
    """Sliding-window counter per key, process-local (fine for 2 workers; it's a spam brake, not auth)."""

    def __init__(self, limit: int, window_s: int, max_keys: int = 20000):
        self.limit, self.window, self.max_keys = limit, window_s, max_keys
        self.hits: "OrderedDict[str, deque]" = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits.pop(key, None) or deque()
            while q and now - q[0] > self.window:
                q.popleft()
            ok = len(q) < self.limit
            if ok:
                q.append(now)
            self.hits[key] = q
            while len(self.hits) > self.max_keys:
                self.hits.popitem(last=False)
            return ok


contact_limit = RateLimit(5, 3600)      # 5 leads / hour / IP
seen_limit = RateLimit(120, 600)        # 120 beacons / 10 min / IP

_org_cache: "OrderedDict[str, tuple[str, str]]" = OrderedDict()
_org_lock = threading.Lock()


def network_of(ip: str) -> tuple[str, str]:
    """(network name, ASN) via ipinfo.io Lite, cached. ('', '') when not configured or on error."""
    if not IPINFO_TOKEN or not ip:
        return "", ""
    with _org_lock:
        if ip in _org_cache:
            _org_cache.move_to_end(ip)
            return _org_cache[ip]
    name, asn = "", ""
    try:
        r = requests.get(f"https://api.ipinfo.io/lite/{ip}", params={"token": IPINFO_TOKEN}, timeout=2.5)
        if r.ok:
            d = r.json()
            name, asn = _one_line(d.get("as_name"), 120), _one_line(d.get("asn"), 20)
    except (requests.RequestException, ValueError):
        logger.info("ipinfo lookup failed")
    with _org_lock:
        _org_cache[ip] = (name, asn)
        while len(_org_cache) > 5000:
            _org_cache.popitem(last=False)
    return name, asn


def _serializer() -> URLSafeTimedSerializer:
    from flask import current_app
    return URLSafeTimedSerializer(current_app.secret_key, salt="landing-contact-form")


def form_token() -> str:
    """Signed render time, embedded in the form. Lets us reject instant (bot) submissions."""
    return _serializer().dumps(int(time.time()))


def _form_age(token: str) -> float | None:
    try:
        t = _serializer().loads(token, max_age=FORM_MAX_AGE)
        age = time.time() - float(t)
        return age if 0 <= age <= FORM_MAX_AGE else None
    except (BadSignature, ValueError, TypeError):
        return None


def forward(action: str, payload: dict) -> tuple[bool, str]:
    """POST to the Apps Script. Returns (ok, error)."""
    if not SCRIPT_URL:
        return False, "not-configured"
    try:
        r = requests.post(SCRIPT_URL, json={"action": action, "token": SCRIPT_TOKEN, "data": payload},
                          timeout=UPSTREAM_TIMEOUT_S, allow_redirects=True)
        body = r.json() if "json" in r.headers.get("Content-Type", "") else {}
        if r.ok and body.get("ok"):
            return True, ""
        return False, _one_line(body.get("error") or f"HTTP {r.status_code}", 200)
    except (requests.RequestException, ValueError) as e:
        return False, type(e).__name__


def _now_ist() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Contact form
# ---------------------------------------------------------------------------

@bp.route("/api/contact", methods=["POST"])
def contact():
    wants_json = request.is_json
    data = request.get_json(silent=True) if wants_json else request.form

    def done(ok: bool, status: int, msg: str, field: str | None = None):
        if wants_json:
            return jsonify(ok=ok, error=None if ok else msg, field=field), status
        # No-JS fallback: back to the form with a status flag.
        return redirect("/?sent=1#contact" if ok else "/?sent=0#contact", code=303)

    if data is None or not same_origin():
        return done(False, 400, "Please submit the form from advitiaum.com.")

    ip = client_ip()
    # Honeypot: a field humans never see. Pretend success so bots learn nothing.
    if _clean(data.get("website"), 200):
        logger.info("contact: honeypot hit")
        return done(True, 200, "")
    age = _form_age(_clean(data.get("t"), 200))
    if age is None:
        return done(False, 400, "This form expired. Please reload the page and try again.")
    if age < FORM_MIN_SECONDS:
        logger.info("contact: too fast (%.1fs)", age)
        return done(True, 200, "")
    if not contact_limit.allow(ip):
        return done(False, 429, f"Too many messages from your network. Please email {CONTACT_EMAIL}.")

    name = _one_line(data.get("name"), 100)
    email = _one_line(data.get("email"), 254)
    interest = _clean(data.get("interest"), 40)
    details = _clean(data.get("details"), 2000)
    if len(name) < 2:
        return done(False, 422, "Please tell us your name.", "name")
    if not EMAIL_RE.match(email):
        return done(False, 422, "Please enter a valid email address.", "email")
    if interest not in INTERESTS:
        return done(False, 422, "Please choose what you're looking for.", "interest")
    if interest == "other" and len(details) < 3:
        return done(False, 422, "Tell us a little about what you're looking for.", "details")

    g = geo()
    net, _asn = network_of(ip)
    lead = {
        "received_at": _now_ist(), "name": name, "email": email,
        "interest": INTERESTS[interest], "details": details,
        "ref": _one_line(data.get("ref"), 80), "visitor_id": _one_line(data.get("vid"), 40),
        "city": g["city"], "region": g["region"], "country": g["country"],
        "network": net, "ip": anonymize_ip(ip),
        "referrer": _one_line(data.get("referrer"), 300),
        "user_agent": _one_line(request.headers.get("User-Agent"), 300),
    }
    # Always on the record in Cloud Logging, even if the sheet/email path is down.
    logger.warning("LANDING_LEAD %s", json.dumps(lead, ensure_ascii=False))

    ok, err = forward("lead", lead)
    if not ok:
        logger.error("contact: forward failed: %s", err)
        return done(False, 502, f"We couldn't send that just now. Please email us at {CONTACT_EMAIL}.")
    return done(True, 200, "")


# ---------------------------------------------------------------------------
# Visit tracker
# ---------------------------------------------------------------------------

_SEEN_FIELDS = {  # beacon field -> max length
    "visit_id": 40, "vid": 40, "n": 6, "ref": 80, "first_ref": 80, "utm_source": 80, "utm_medium": 80,
    "utm_campaign": 120, "referrer": 300, "path": 200, "screen": 20, "viewport": 20, "dpr": 6,
    "lang": 40, "tz": 60, "conn": 20, "duration": 8, "scroll": 4, "sections": 300, "clicks": 600,
    "arm": 20, "form": 20,
}


@bp.route("/api/seen", methods=["POST"])
def seen():
    """Visit beacon. Always 204: the page never waits on this and never learns why a hit was dropped."""
    empty = ("", 204)
    if request.content_length and request.content_length > 8192:
        return empty
    ua = request.headers.get("User-Agent", "")
    if is_bot_ua(ua) or not same_origin():
        return empty
    try:
        raw = json.loads(request.get_data(cache=False, as_text=True) or "{}")
    except ValueError:
        return empty
    if not isinstance(raw, dict) or raw.get("event") not in ("view", "update"):
        return empty
    ip = client_ip()
    if not seen_limit.allow(ip):
        return empty

    d = {k: _one_line(raw.get(k), n) for k, n in _SEEN_FIELDS.items()}
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", d["visit_id"] or ""):
        return empty
    rec = {"event": raw["event"], "at": _now_ist(), **d}
    if raw["event"] == "view":
        g = geo()
        net, asn = network_of(ip)
        rec.update(g)
        rec.update(parse_ua(ua))
        rec.update({"ip": anonymize_ip(ip), "network": net, "asn": asn,
                    "datacenter": "yes" if net and DATACENTER_RE.search(net) else ""})
    logger.info("LANDING_VISIT %s", json.dumps(rec, ensure_ascii=False))
    ok, err = forward("visit", rec)
    if not ok and err != "not-configured":
        logger.warning("seen: forward failed: %s", err)
    return empty


# ---------------------------------------------------------------------------
# White paper: popup choices + every open of the PDF
# ---------------------------------------------------------------------------
# Unlike the visit tracker, these records keep the FULL IP address: the site owner
# asked to know exactly who engaged with the white paper. The popup tells the
# visitor this before they choose (templates/landing/index.html, #wp-dialog).

WHITEPAPER = {
    "title": "Tracing Every Tonne: Verifiable Waste Accounting and Alternative-Fuel Markets "
             "for Methane and Coal Abatement",
    "version": "1.81",
    "file": "Tracing_Every_Tonne_ADEX_White_Paper.pdf",
}
_WP_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "whitepaper",
                        WHITEPAPER["file"])
WP_ACTIONS = {"shown": "Popup shown", "read": "Clicked Read", "download": "Clicked Download", "skip": "Skipped",
              "dismiss": "Closed popup",
              # Server-side only: the PDF actually reached the visitor (the emails fire on these).
              "open": "Opened PDF", "downloaded": "Downloaded PDF"}
_SERVER_ONLY = ("open", "downloaded")
wp_limit = RateLimit(60, 600)        # 60 white-paper events / 10 min / IP

_WP_FIELDS = {"visit_id": 40, "vid": 40, "n": 6, "ref": 80, "first_ref": 80, "utm_source": 80, "utm_medium": 80,
              "utm_campaign": 120, "referrer": 300, "path": 200, "screen": 20, "lang": 40, "tz": 60,
              "seconds_on_page": 8}


def _wp_record(action: str, fields: dict, ua: str) -> dict:
    ip = client_ip()
    g = geo()
    net, asn = network_of(ip)
    rec = {"at": _now_ist(), "action": WP_ACTIONS[action], **fields, **g, **parse_ua(ua),
           "ip": ip, "network": net, "asn": asn,
           "datacenter": "yes" if net and DATACENTER_RE.search(net) else "",
           "user_agent": _one_line(ua, 300), "paper_version": WHITEPAPER["version"]}
    logger.warning("WHITEPAPER %s", json.dumps(rec, ensure_ascii=False))   # also kept in Cloud Logging
    ok, err = forward("whitepaper", rec)
    if not ok and err != "not-configured":
        logger.warning("whitepaper: forward failed: %s", err)
    return rec


@bp.route("/api/wp", methods=["POST"])
def whitepaper_event():
    """Popup beacon: shown / read / download / skip / dismiss. Always 204."""
    empty = ("", 204)
    if request.content_length and request.content_length > 8192:
        return empty
    ua = request.headers.get("User-Agent", "")
    if is_bot_ua(ua) or not same_origin():
        return empty
    try:
        raw = json.loads(request.get_data(cache=False, as_text=True) or "{}")
    except ValueError:
        return empty
    if not isinstance(raw, dict) or raw.get("action") not in WP_ACTIONS or raw.get("action") in _SERVER_ONLY:
        return empty
    if not wp_limit.allow(client_ip()):
        return empty
    d = {k: _one_line(raw.get(k), n) for k, n in _WP_FIELDS.items()}
    if d["visit_id"] and not re.fullmatch(r"[A-Za-z0-9_-]{8,40}", d["visit_id"]):
        d["visit_id"] = ""
    _wp_record(raw["action"], d, ua)
    return empty


@bp.route("/whitepaper", strict_slashes=False)
@bp.route("/whitepaper.pdf")
@bp.route("/white-paper", strict_slashes=False)
def whitepaper_pdf():
    """The PDF itself. Every open is recorded, including links shared outside the site.

    ?dl=1 downloads instead of opening; ?r=<who> tags a shared link like the landing page's ?r=.
    """
    from flask import send_file
    ua = request.headers.get("User-Agent", "")
    if not is_bot_ua(ua) and wp_limit.allow(client_ip()):
        q = request.args
        _wp_record("downloaded" if q.get("dl") == "1" else "open", {
            "ref": _one_line(q.get("r") or q.get("ref"), 80), "vid": _one_line(q.get("vid"), 40),
            "visit_id": "", "n": "", "first_ref": "",
            "utm_source": _one_line(q.get("utm_source") or q.get("src"), 80),
            "utm_medium": _one_line(q.get("utm_medium"), 80), "utm_campaign": _one_line(q.get("utm_campaign"), 120),
            "referrer": _one_line(request.headers.get("Referer"), 300), "path": _one_line(request.full_path, 200),
            "screen": "", "lang": _one_line(request.headers.get("Accept-Language"), 40), "tz": "",
            "seconds_on_page": "",
        }, ua)
    resp = send_file(_WP_PATH, mimetype="application/pdf", as_attachment=request.args.get("dl") == "1",
                     download_name="Advitia_Labs_ADEX_White_paper.pdf", max_age=0)
    resp.headers["Cache-Control"] = "private, no-cache"     # every open reaches the server, so it is counted
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Robots-Tag"] = "noindex"
    return resp
