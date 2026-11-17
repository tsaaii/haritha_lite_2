"""
The phase sheet behind the new /sac dashboard and portal.

One CSV, one row per (site, phase): location, site_name, phase, agency_name,
cluster, target_mt, remediated_mt, inert/rdf/cnd/soil_disposed_mt,
rdf_remaining_in_site, start_date, deadline_date, status, processing_power.
Other columns (link_to, notes, total_rdf, ...) are ignored.

Where it lives
    PHASE_DATA_CSV   local path or gs:// URL of the published sheet
                     (default phase_data_store/phase_data.csv, git-ignored).
    A sidecar <name>.meta.json records when and by whom it was published.
    Until anything is published, data/phase_data_seed.csv is shown.

Upload flow (admin only, views/sac.py)
    parse(raw)               -> every row with its problems, nothing saved
    publish(raw, skip_lines) -> keeps the rows not skipped (rows with no phase
                                are always dropped), saves, invalidates the cache.
    The previous sheet is copied to <name>.<timestamp>.bak.csv first.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import config
from data._cache import TTLCache

logger = logging.getLogger(__name__)

_ROOT = Path(__file__).resolve().parent.parent
SEED = _ROOT / "data" / "phase_data_seed.csv"
_cache = TTLCache(config.CACHE_TTL_SECONDS)

# Order is the display order everywhere (rotation, pills, phase lists).
PHASES: tuple[tuple[str, str], ...] = (
    ("p3", "Phase 3 · now"),
    ("p2", "Phase 2"),
    ("p1", "Phase 1"),
    ("p1x", "Phase 1 excess"),
    ("old", "Earlier work"),
)
PHASE_LABEL = dict(PHASES)
_PHASE_CODES = {
    "phase 3 - current": "p3", "phase 3": "p3",
    "phase 2": "p2",
    "phase 1": "p1",
    "phase 1 - 15% excess": "p1x", "phase 1 excess": "p1x",
    "old": "old", "earlier work": "old",
}
REQUIRED = ("location", "phase", "agency_name", "target_mt", "remediated_mt")
NUM_COLS = ("target_mt", "remediated_mt", "inert_disposed_mt", "rdf_disposed_mt",
            "cnd_disposed_mt", "soil_disposed_mt", "rdf_remaining_in_site", "actual_rdf")
MAX_BYTES = 4 * 1024 * 1024
# A row is flagged when its four material figures add up to more than this
# multiple of what was weighed in (catches typos like an extra digit).
MATERIAL_RATIO_FLAG = float(os.environ.get("PHASE_MATERIAL_RATIO_FLAG", "1.5"))
NO_AGENCY = "Agency not named"


class SheetError(ValueError):
    """The file as a whole cannot be used (wrong columns, not a CSV, too big)."""


@dataclass
class Item:
    line: int                 # 1-based line in the file (header is line 1)
    location: str
    phase_raw: str
    phase: str | None
    msgs: list[str] = field(default_factory=list)
    row: list = field(default_factory=list)   # the portal's compact row, see _row()

    @property
    def locked(self) -> bool:   # cannot be published at all
        return self.phase is None


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise SheetError("Could not read this file as text.")


def _num(s: str) -> float:
    try:
        return float(str(s).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def phase_code(raw: str) -> str | None:
    return _PHASE_CODES.get(re.sub(r"\s+", " ", (raw or "").strip().lower()))


def parse(raw: bytes) -> list[Item]:
    if len(raw) > MAX_BYTES:
        raise SheetError("This file is too large (4 MB max).")
    text = _decode(raw)
    reader = csv.reader(io.StringIO(text))
    try:
        head = [h.strip().lower() for h in next(reader)]
    except StopIteration:
        raise SheetError("This file is empty.")
    missing = [c for c in REQUIRED if c not in head]
    if missing:
        raise SheetError("This file is missing columns: " + ", ".join(missing) + ".")
    ix = {h: i for i, h in enumerate(head) if h}

    items: list[Item] = []
    for n, rec in enumerate(reader, start=2):
        if not any(c.strip() for c in rec):
            continue
        cell = lambda c: (rec[ix[c]] if c in ix and ix[c] < len(rec) else "").strip()  # noqa: E731
        ph = phase_code(cell("phase"))
        t, w = _num(cell("target_mt")), _num(cell("remediated_mt"))
        mats = sum(_num(cell(c)) for c in ("inert_disposed_mt", "rdf_disposed_mt", "cnd_disposed_mt", "soil_disposed_mt"))
        msgs = []
        if not ph:
            msgs.append("No phase, so it cannot be published")
        bad = [c for c in NUM_COLS if cell(c).startswith("#")]
        if bad:
            msgs.append("Formula error in " + ", ".join(bad))
        if not cell("agency_name"):
            msgs.append("No agency name")
        if not cell("site_name"):
            msgs.append("No site name")
        if w > t + 1:
            msgs.append("Weighed in is above awarded")
        if w > 0 and mats > w * MATERIAL_RATIO_FLAG:
            msgs.append("Material total is far above weighed in")
        loc = cell("location")
        row = [loc, cell("site_name") or loc, ph, cell("agency_name"), cell("cluster"), t, w,
               _num(cell("inert_disposed_mt")), _num(cell("rdf_disposed_mt")), _num(cell("cnd_disposed_mt")),
               _num(cell("soil_disposed_mt")), _num(cell("rdf_remaining_in_site")),
               cell("start_date"), cell("deadline_date"), cell("status"), _num(cell("processing_power"))]
        items.append(Item(n, loc, cell("phase") or "no phase", ph, msgs, row))
    if not items:
        raise SheetError("This file has a header but no rows.")
    return items


def preview(raw: bytes) -> dict:
    """What the upload screen shows before publishing."""
    items = parse(raw)
    flagged = [i for i in items if i.msgs]
    return {
        "total": len(items),
        "issues": [{"line": i.line, "title": f"Row {i.line} · {i.location or 'no location'} · {i.phase_raw}",
                    "msg": " · ".join(i.msgs), "locked": i.locked, "skip": i.locked} for i in flagged],
    }


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _store_path() -> str:
    return os.environ.get("PHASE_DATA_CSV", "").strip() or str(_ROOT / "phase_data_store" / "phase_data.csv")


def _sibling(path: str, suffix: str) -> str:
    base = path[:-4] if path.lower().endswith(".csv") else path
    return base + suffix


def _read(path: str) -> bytes | None:
    if config.is_gcs_path(path):
        from google.cloud import storage  # type: ignore
        bucket, key = config.parse_gcs_path(path)
        blob = storage.Client().bucket(bucket).blob(key)
        return blob.download_as_bytes() if blob.exists() else None
    p = Path(path)
    return p.read_bytes() if p.is_file() else None


def _write(path: str, data: bytes, ctype: str) -> None:
    if config.is_gcs_path(path):
        from google.cloud import storage  # type: ignore
        bucket, key = config.parse_gcs_path(path)
        storage.Client().bucket(bucket).blob(key).upload_from_string(data, content_type=ctype)
        return
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(p)


def _clean_csv(items: list[Item]) -> bytes:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["location", "site_name", "phase", "agency_name", "cluster", "target_mt", "remediated_mt",
                "inert_disposed_mt", "rdf_disposed_mt", "cnd_disposed_mt", "soil_disposed_mt",
                "rdf_remaining_in_site", "start_date", "deadline_date", "status", "processing_power"])
    for i in items:
        r = list(i.row)
        r[2] = {"p3": "Phase 3 - current", "p2": "Phase 2", "p1": "Phase 1",
                "p1x": "Phase 1 - 15% Excess", "old": "Old"}[r[2]]
        w.writerow(r)
    return out.getvalue().encode("utf-8")


def publish(raw: bytes, skip_lines: set[int], by: str = "", filename: str = "") -> int:
    """Replace the published sheet. Returns the number of rows published."""
    keep = [i for i in parse(raw) if not i.locked and i.line not in skip_lines]
    if not keep:
        raise SheetError("Every row is skipped, so there is nothing to publish.")
    path = _store_path()
    stamp = datetime.now(config.IST).strftime("%Y%m%d-%H%M%S")
    try:
        prev = _read(path)
        if prev:
            _write(_sibling(path, f".{stamp}.bak.csv"), prev, "text/csv")
    except Exception:
        logger.exception("phase_data: could not back up the previous sheet")
    _write(path, _clean_csv(keep), "text/csv")
    meta = {"published_at": datetime.now(config.IST).isoformat(timespec="seconds"),
            "by": by, "file": filename, "rows": len(keep)}
    _write(_sibling(path, ".meta.json"), json.dumps(meta).encode(), "application/json")
    invalidate_cache()
    return len(keep)


# ---------------------------------------------------------------------------
# Reading + aggregates
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Sheet:
    rows: tuple[tuple, ...]
    published_at: datetime | None


def _load() -> Sheet:
    path = _store_path()
    raw, meta = None, {}
    try:
        raw = _read(path)
        m = _read(_sibling(path, ".meta.json")) if raw else None
        meta = json.loads(m) if m else {}
    except Exception:
        logger.exception("phase_data: could not read %s; showing the seed sheet", path)
    if raw is None:
        raw = SEED.read_bytes()
    rows = tuple(tuple(i.row) for i in parse(raw) if not i.locked)
    when = None
    if meta.get("published_at"):
        try:
            when = datetime.fromisoformat(meta["published_at"])
        except ValueError:
            pass
    return Sheet(rows, when)


def sheet() -> Sheet:
    return _cache.get_or_load("sheet", _load)


def invalidate_cache() -> None:
    _cache.invalidate()


def agency_of(row) -> str:
    return row[3] or NO_AGENCY


def dashboard(rows) -> dict:
    """Numbers for the public rotating display: all phases first, then each phase."""
    def agg(rs):
        t = sum(r[5] for r in rs)
        w = sum(r[6] for r in rs)
        c = sum(min(r[5], r[6]) for r in rs)
        ag: dict[str, list[float]] = {}
        for r in rs:
            a = ag.setdefault(agency_of(r), [0.0, 0.0])
            a[0] += r[5]
            a[1] += r[6]
        # A site is a location; one location can carry several rows (two agencies,
        # or two packages). It has "no legacy intake left" once, across its rows,
        # weighed in has reached awarded.
        sites: dict[str, list[float]] = {}
        for r in rs:
            s = sites.setdefault(r[0].strip().lower(), [0.0, 0.0])
            s[0] += r[5]
            s[1] += r[6]
        return {
            "t": round(t, 2), "r": round(w, 2), "c": round(c, 2), "sites": len(sites),
            "done": sum(1 for v in sites.values() if v[0] > 0 and v[1] >= v[0] - 0.5),
            # Soil, Inert, RDF, CnD
            "m": [round(sum(r[i] for r in rs), 2) for i in (10, 7, 8, 9)],
            "agencies": sorted(([k, round(v[0], 2), round(v[1], 2)] for k, v in ag.items()), key=lambda a: -a[1]),
        }

    out = [{"key": "all", "label": "All phases", **agg(rows)}]
    for code, label in PHASES:
        rs = [r for r in rows if r[2] == code]
        if rs:
            out.append({"key": code, "label": label, **agg(rs)})
    return {"slides": out}
