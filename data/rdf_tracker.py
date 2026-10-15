"""
Daily RDF tracker store for the RDF disposal report (views/rdf_report.py).

One CSV per day is uploaded from the report's gear panel. Each file is keyed
by the "as on Dt: DD.MM.YYYY" date in its header row, so:
    - uploading the next day's tracker adds a point to every graph, and
    - re-uploading a corrected sheet for the same date replaces that day.

Storage is RDF_TRACKER_DIR — a local folder or gs://bucket/prefix, same
plug-and-play idea as SITES_MASTER_CSV:
    <dir>/trackers/2026-10-13.csv      the sheet that reports 13 Oct (raw bytes)
    <dir>/uploads/<ts>_<name>          every upload as received (audit trail)
    <dir>/pin_hash                     werkzeug hash of the report PIN

The bucket is the only state. Each request lists trackers/ (one cheap API
call) and only downloads files whose generation changed, so every App Engine
instance sees an upload immediately.

CLI (uses the same code path, so it works against gs:// with ADC):
    python -m data.rdf_tracker seed data/rdf_seed/*.csv
    python -m data.rdf_tracker set-pin
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime

import config
from data._cache import TTLCache

logger = logging.getLogger(__name__)

TRACKER_DIR = os.environ.get("RDF_TRACKER_DIR", "rdf_tracker_data").rstrip("/")
_TRACKERS = "trackers"
_UPLOADS = "uploads"
_PIN = "pin_hash"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SiteDay:
    agency: str
    site: str          # "#<Sl.No>" appended when a site name repeats in the sheet
    today: float       # "RDF disposed as on Dt" column
    cum: float         # "Cumulative RDF disposed as on Dt" column
    bal: float         # "Balance RDF to be disposed from site" column


@dataclass(frozen=True)
class Tracker:
    date: date
    sites: tuple[SiteDay, ...]


class TrackerError(ValueError):
    pass


_NUM = re.compile(r"^\s*[-+]?(\d+\.?\d*|\.\d+)")
_AS_ON = re.compile(r"as on Dt:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})", re.I)
_TITLE_DATE = re.compile(r"([A-Za-z]+ \d{1,2}, \d{4})")
_FNAME_DATE = re.compile(r"(\d{2})-(\d{2})-(\d{4})")


def _clean(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def _num(s) -> float:
    """Leading number of a cell, commas ignored ('1,234.5' -> 1234.5, '' -> 0)."""
    m = _NUM.match(str(s or "").replace(",", ""))
    return float(m.group(0)) if m else 0.0


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def parse(raw: bytes, filename: str = "") -> Tracker:
    """Parse one daily tracker sheet. Raises TrackerError if it isn't one."""
    rows = list(csv.reader(io.StringIO(_decode(raw))))
    hi = next((i for i, r in enumerate(rows) if r and _clean(r[0]).lower() == "agency"), -1)
    if hi < 0:
        raise TrackerError("No header row starting with 'Agency' — is this the daily RDF tracker?")

    m = _AS_ON.search(" ".join(_clean(c) for c in rows[hi]))
    if m:
        d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    else:
        title = _clean(rows[0][0]) if rows and rows[0] else ""
        tm, fm = _TITLE_DATE.search(title), _FNAME_DATE.search(filename or "")
        if tm:
            d = datetime.strptime(tm.group(1), "%B %d, %Y").date()
        elif fm:
            d = date(int(fm.group(3)), int(fm.group(2)), int(fm.group(1)))
        else:
            raise TrackerError("Could not find the 'as on Dt: DD.MM.YYYY' date in the header row.")

    body = [r + [""] * (10 - len(r)) for r in rows[hi + 1:] if r]
    # Skip the "1,2,3,..." column-number row and blank/total rows.
    body = [r for r in body if _clean(r[0]) and not _is_number(_clean(r[0])) and _clean(r[2])]
    if not body:
        raise TrackerError("The sheet has a header row but no site rows.")

    seen: dict[str, int] = {}
    for r in body:
        k = _clean(r[2]).lower()
        seen[k] = seen.get(k, 0) + 1
    sites = []
    for r in body:
        site, sl = _clean(r[2]), _clean(r[1])
        name = f"{site} #{sl}" if seen[site.lower()] > 1 and sl else site
        sites.append(SiteDay(_clean(r[0]), name, _num(r[6]), _num(r[7]), _num(r[9])))
    return Tracker(d, tuple(sites))


# ---------------------------------------------------------------------------
# Storage (local folder or gs://)
# ---------------------------------------------------------------------------

def _gcs():
    from google.cloud import storage  # type: ignore
    bucket, prefix = config.parse_gcs_path(TRACKER_DIR)
    return storage.Client().bucket(bucket), prefix.strip("/")


def _key(prefix: str, *parts: str) -> str:
    return "/".join(p for p in (prefix, *parts) if p)


def _write(rel: str, data: bytes, content_type: str = "text/csv") -> None:
    if config.is_gcs_path(TRACKER_DIR):
        bucket, prefix = _gcs()
        bucket.blob(_key(prefix, rel)).upload_from_string(data, content_type=content_type)
        return
    path = os.path.join(TRACKER_DIR, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def _read(rel: str) -> bytes | None:
    if config.is_gcs_path(TRACKER_DIR):
        bucket, prefix = _gcs()
        blob = bucket.blob(_key(prefix, rel))
        return blob.download_as_bytes() if blob.exists() else None
    path = os.path.join(TRACKER_DIR, rel)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def _delete(rel: str) -> None:
    if config.is_gcs_path(TRACKER_DIR):
        bucket, prefix = _gcs()
        blob = bucket.blob(_key(prefix, rel))
        if blob.exists():
            blob.delete()
        return
    path = os.path.join(TRACKER_DIR, rel)
    if os.path.exists(path):
        os.remove(path)


def _list_trackers() -> list[tuple[str, str, datetime | None]]:
    """[(name, version, updated)] for every trackers/*.csv. version changes on rewrite."""
    out = []
    if config.is_gcs_path(TRACKER_DIR):
        bucket, prefix = _gcs()
        for b in bucket.client.list_blobs(bucket, prefix=_key(prefix, _TRACKERS) + "/"):
            name = b.name.rsplit("/", 1)[-1]
            if name.endswith(".csv"):
                out.append((name, str(b.generation), b.updated))
        return out
    folder = os.path.join(TRACKER_DIR, _TRACKERS)
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            if name.endswith(".csv"):
                st = os.stat(os.path.join(folder, name))
                out.append((name, str(st.st_mtime_ns), datetime.fromtimestamp(st.st_mtime, config.IST)))
    return out


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_parsed: dict[str, tuple[str, Tracker]] = {}     # name -> (version, tracker)


def history() -> list[Tracker]:
    """Every stored day, oldest first. Re-downloads only files that changed."""
    listing = _list_trackers()
    out = []
    for name, version, _ in listing:
        with _lock:
            hit = _parsed.get(name)
        if hit and hit[0] == version:
            out.append(hit[1])
            continue
        raw = _read(f"{_TRACKERS}/{name}")
        if raw is None:
            continue
        try:
            t = parse(raw, name)
        except TrackerError as exc:
            logger.warning("Skipping unreadable tracker %s: %s", name, exc)
            continue
        with _lock:
            _parsed[name] = (version, t)
        out.append(t)
    names = {n for n, _, _ in listing}
    with _lock:
        for gone in set(_parsed) - names:
            _parsed.pop(gone, None)
    return sorted(out, key=lambda t: t.date)


def listing() -> list[dict]:
    """For the gear panel: one row per stored day, newest first."""
    by_name = {n: u for n, _, u in _list_trackers()}
    rows = []
    for t in history():
        name = t.date.isoformat() + ".csv"
        upd = by_name.get(name)
        rows.append({
            "date": t.date.isoformat(),
            "label": t.date.strftime("%-d %b %Y"),
            "sites": len(t.sites),
            "uploaded": upd.astimezone(config.IST).strftime("%-d %b, %H:%M") if upd else "",
        })
    return rows[::-1]


def store(raw: bytes, filename: str) -> tuple[Tracker, bool]:
    """Validate + save one upload. Returns (tracker, replaced_existing_day)."""
    t = parse(raw, filename)
    name = t.date.isoformat() + ".csv"
    replaced = any(n == name for n, _, _ in _list_trackers())
    stamp = datetime.now(config.IST).strftime("%Y%m%d-%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename or "upload.csv")[:120]
    _write(f"{_UPLOADS}/{stamp}_{safe}", raw)
    _write(f"{_TRACKERS}/{name}", raw)
    return t, replaced


def remove(day_iso: str) -> None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_iso or ""):
        raise TrackerError("Bad date.")
    _delete(f"{_TRACKERS}/{day_iso}.csv")


# ---------------------------------------------------------------------------
# PIN (hash lives in the bucket so it never sits in the public repo)
# ---------------------------------------------------------------------------

_pin_cache = TTLCache(300)    # a PIN change reaches every instance within 5 minutes


def pin_hash() -> str:
    """RDF_REPORT_PIN_HASH env var wins; else <dir>/pin_hash. '' = not set up."""
    env = os.environ.get("RDF_REPORT_PIN_HASH", "").strip()
    if env:
        return env
    def load() -> str:
        raw = _read(_PIN)
        return raw.decode().strip() if raw else ""
    return _pin_cache.get_or_load("h", load)


def set_pin(pin: str) -> None:
    from werkzeug.security import generate_password_hash
    _write(_PIN, generate_password_hash(pin).encode(), content_type="text/plain")
    _pin_cache.invalidate()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main(argv: list[str]) -> int:
    import getpass
    if len(argv) >= 2 and argv[0] == "seed":
        for path in argv[1:]:
            with open(path, "rb") as f:
                t, replaced = store(f.read(), os.path.basename(path))
            print(f"{path} -> {t.date} ({len(t.sites)} sites){' replaced' if replaced else ''}")
        return 0
    if argv == ["set-pin"]:
        pin = getpass.getpass("New report PIN: ")
        if len(pin) < 4 or pin != getpass.getpass("Again: "):
            print("PINs must match and be at least 4 characters.")
            return 1
        set_pin(pin)
        print(f"PIN saved to {TRACKER_DIR}/{_PIN}")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv[1:]))
