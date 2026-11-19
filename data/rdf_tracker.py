"""
Daily RDF tracker store for the RDF disposal report (views/rdf_report.py).

Two sources, merged by the "as on Dt: DD.MM.YYYY" date in each sheet's header row:
    data/rdf_history/YYYY-MM-DD.csv   hardcoded history, deployed with the code
    RDF_TRACKER_DIR/trackers/         one CSV per day uploaded from the gear icon
So the graphs always start from the built-in history, every upload adds a point,
and an upload for a date that is already there (built-in or uploaded) replaces it.
To hardcode more history, drop the day's sheet in data/rdf_history (any file name;
`python -m data.rdf_tracker add-history <csv>...` names it by its date) and deploy.

Storage is RDF_TRACKER_DIR — a local folder or gs://bucket/prefix, same
plug-and-play idea as SITES_MASTER_CSV:
    <dir>/trackers/2026-10-13.csv      the sheet that reports 13 Oct (raw bytes)
    <dir>/uploads/<ts>_<name>          every upload as received (audit trail)

The bucket is the only state. Each request lists trackers/ (one cheap API
call) and only downloads files whose generation changed, so every App Engine
instance sees an upload immediately.

CLI:
    python -m data.rdf_tracker add-history ~/Downloads/Daily_RDF_tracker-*.csv
    python -m data.rdf_tracker seed <csv>...     (store as uploads; works against gs:// with ADC)
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import config

logger = logging.getLogger(__name__)

TRACKER_DIR = os.environ.get("RDF_TRACKER_DIR", "rdf_tracker_data").rstrip("/")
# Hardcoded history (ships with the code): data/rdf_history/YYYY-MM-DD.csv
HISTORY_DIR = os.environ.get("RDF_HISTORY_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "rdf_history")
_TRACKERS = "trackers"
_UPLOADS = "uploads"


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
    awarded: float = 0.0   # "Total Qty awarded to ULB" column: how a row is matched to the phase sheet
    # Set by data/rdf_master.py when a row is placed in a phase view:
    sid: str = ""          # stable master-row id (edits and per-site series key on it)
    phase: str = ""        # phase code: p3, p2, p1x, p1, old, un
    tracked: bool = True   # False = phase-sheet-only row: fixed cumulative, no balance
    src: str = ""          # site name as written in the tracker (WhatsApp summary uses it)
    key: str = ""          # unique-site key for the Sites count
    base: str = ""         # site name without the view's suffixes (" · P3", " (2)"): what the edit form shows


@dataclass(frozen=True)
class Tracker:
    date: date             # "as on Dt" — the day the disposal happened (report day)
    sites: tuple[SiteDay, ...]
    sheet_date: date       # the sheet's own date (its title / file name), usually date + 1


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

    title = _clean(rows[0][0]) if rows and rows[0] else ""
    tm, fm = _TITLE_DATE.search(title), _FNAME_DATE.search(filename or "")
    sheet = None
    if tm:
        try:
            sheet = datetime.strptime(tm.group(1), "%B %d, %Y").date()
        except ValueError:
            sheet = None
    if sheet is None and fm:
        sheet = date(int(fm.group(3)), int(fm.group(2)), int(fm.group(1)))

    m = _AS_ON.search(" ".join(_clean(c) for c in rows[hi]))
    if m:
        d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    elif sheet:
        d = sheet
    else:
        raise TrackerError("Could not find the 'as on Dt: DD.MM.YYYY' date in the header row.")
    sheet = sheet or d + timedelta(days=1)

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
        sites.append(SiteDay(_clean(r[0]), name, _num(r[6]), _num(r[7]), _num(r[9]), awarded=_num(r[3])))
    return Tracker(d, tuple(sites), sheet)


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


def read_file(rel: str) -> bytes | None:
    """Read RDF_TRACKER_DIR/<rel> (None if missing). Used for master/ files (edits, phase sheet)."""
    return _read(rel)


def write_file(rel: str, data: bytes, content_type: str = "text/csv") -> None:
    _write(rel, data, content_type)


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


def _uploaded() -> dict[date, Tracker]:
    """Days uploaded from the gear icon (RDF_TRACKER_DIR/trackers). Re-reads only changed files."""
    listing = _list_trackers()
    out: dict[date, Tracker] = {}
    for name, version, _ in listing:
        with _lock:
            hit = _parsed.get(name)
        if hit and hit[0] == version:
            out[hit[1].date] = hit[1]
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
        out[t.date] = t
    names = {n for n, _, _ in listing}
    with _lock:
        for gone in set(_parsed) - names:
            _parsed.pop(gone, None)
    return out


_builtin_cache: dict[str, tuple[str, dict[date, Tracker]]] = {}


def builtin() -> dict[date, Tracker]:
    """Hardcoded history shipped with the app (HISTORY_DIR, one YYYY-MM-DD.csv per day).

    Deployed with the code, so the graphs always start from it, even with an empty bucket.
    """
    try:
        names = sorted(n for n in os.listdir(HISTORY_DIR) if n.endswith(".csv"))
    except FileNotFoundError:
        return {}
    sig = "|".join(f"{n}:{os.stat(os.path.join(HISTORY_DIR, n)).st_mtime_ns}" for n in names)
    hit = _builtin_cache.get(HISTORY_DIR)
    if hit and hit[0] == sig:
        return hit[1]
    out: dict[date, Tracker] = {}
    for n in names:
        with open(os.path.join(HISTORY_DIR, n), "rb") as f:
            try:
                t = parse(f.read(), n)
            except TrackerError as exc:
                logger.warning("Skipping unreadable built-in tracker %s: %s", n, exc)
                continue
        out[t.date] = t
    _builtin_cache[HISTORY_DIR] = (sig, out)
    return out


def history() -> list[Tracker]:
    """Built-in history + every uploaded day, oldest first. An upload wins over a built-in day."""
    days = dict(builtin())
    days.update(_uploaded())
    return [days[d] for d in sorted(days)]


def listing() -> list[dict]:
    """For the gear panel: one row per day, newest first."""
    by_name = {n: u for n, _, u in _list_trackers()}
    base, up = builtin(), _uploaded()
    rows = []
    for t in history():
        upd = by_name.get(t.date.isoformat() + ".csv")
        uploaded = t.date in up
        rows.append({
            "date": t.date.isoformat(),
            "label": t.date.strftime("%-d %b %Y"),
            "sites": len(t.sites),
            "uploaded": upd.astimezone(config.IST).strftime("%-d %b, %H:%M") if upd and uploaded else "",
            "builtin": not uploaded,                       # shipped history: cannot be removed
            "overrides_builtin": uploaded and t.date in base,
        })
    return rows[::-1]


def store(raw: bytes, filename: str) -> tuple[Tracker, bool]:
    """Validate + save one upload. Returns (tracker, replaced_existing_day)."""
    t = parse(raw, filename)
    name = t.date.isoformat() + ".csv"
    replaced = t.date in history_dates()
    stamp = datetime.now(config.IST).strftime("%Y%m%d-%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename or "upload.csv")[:120]
    _write(f"{_UPLOADS}/{stamp}_{safe}", raw)
    _write(f"{_TRACKERS}/{name}", raw)
    return t, replaced


def uploaded_at() -> dict[date, datetime]:
    """When each uploaded day's sheet was last written (built-in days are absent)."""
    out = {}
    for name, _, upd in _list_trackers():
        try:
            out[date.fromisoformat(name[:-4])] = upd
        except ValueError:
            continue
    return out


def history_dates() -> set[date]:
    return set(builtin()) | set(_uploaded())


def remove(day_iso: str) -> None:
    """Remove an uploaded day. Built-in history stays (a built-in day shows again if it was overridden)."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_iso or ""):
        raise TrackerError("Bad date.")
    if not any(n == day_iso + ".csv" for n, _, _ in _list_trackers()):
        raise TrackerError("That day is part of the built-in history and cannot be removed here.")
    _delete(f"{_TRACKERS}/{day_iso}.csv")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "add-history":
        os.makedirs(HISTORY_DIR, exist_ok=True)
        for path in argv[1:]:
            with open(path, "rb") as f:
                raw = f.read()
            t = parse(raw, os.path.basename(path))
            dest = os.path.join(HISTORY_DIR, t.date.isoformat() + ".csv")
            existed = os.path.exists(dest)
            with open(dest, "wb") as f:
                f.write(raw)
            print(f"{path} -> {os.path.relpath(dest)} ({t.date}, {len(t.sites)} sites){' replaced' if existed else ''}")
        return 0
    if len(argv) >= 2 and argv[0] == "seed":
        for path in argv[1:]:
            with open(path, "rb") as f:
                t, replaced = store(f.read(), os.path.basename(path))
            print(f"{path} -> {t.date} ({len(t.sites)} sites){' replaced' if replaced else ''}")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    import sys
    sys.exit(_main(sys.argv[1:]))
