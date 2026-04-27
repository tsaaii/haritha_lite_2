"""
Load + cache sites_master.csv.

This is the spine: the source of truth for which sites exist, who owns them,
what their target tonnage is, and when the deadline is. Everything else
(remediated tonnage, daily trips) comes from the records API.
"""
from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

import config
from data._cache import TTLCache

logger = logging.getLogger(__name__)
_cache = TTLCache(config.CACHE_TTL_SECONDS)
_CACHE_KEY = "sites_master"


@dataclass(frozen=True)
class Site:
    site_name: str
    api_site_names: tuple[str, ...]   # always non-empty; defaults to (site_name,)
    agency_name: str
    cluster: str
    target_mt: float
    deadline_date: Optional[date]
    status: str                       # active / inactive / etc.
    reclamation_status: str           # in_progress / reclaimed / not_started
    start_date: Optional[date]

    @property
    def is_active(self) -> bool:
        return self.status.strip().lower() == "active"

    @property
    def is_reclaimed(self) -> bool:
        return self.reclamation_status.strip().lower() == "reclaimed"


def _parse_date(raw: str) -> Optional[date]:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _parse_float(raw: str) -> float:
    raw = (raw or "").strip().replace(",", "")
    if not raw:
        return 0.0
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _parse_api_names(raw: str, fallback: str) -> tuple[str, ...]:
    raw = (raw or "").strip()
    if not raw:
        return (fallback.strip(),) if fallback.strip() else tuple()
    return tuple(s.strip() for s in raw.split("|") if s.strip())


def _row_to_site(row: dict) -> Optional[Site]:
    site_name = (row.get("site_name") or "").strip()
    if not site_name:
        return None
    return Site(
        site_name=site_name,
        api_site_names=_parse_api_names(row.get("api_site_names", ""), site_name),
        agency_name=(row.get("agency_name") or "").strip(),
        cluster=(row.get("cluster") or "").strip(),
        target_mt=_parse_float(row.get("target_mt", "0")),
        deadline_date=_parse_date(row.get("deadline_date", "")),
        status=(row.get("status") or "").strip(),
        reclamation_status=(row.get("reclamation_status") or "").strip(),
        start_date=_parse_date(row.get("start_date", "")),
    )


def _read_text_from_gcs() -> str:
    """Read the sites_master.csv from GCS. Raises on any failure."""
    from google.cloud import storage  # type: ignore

    client = storage.Client()
    bucket = client.bucket(config.GCS_BUCKET)
    blob = bucket.blob(config.SITES_MASTER_PATH)
    if not blob.exists():
        raise FileNotFoundError(
            f"gs://{config.GCS_BUCKET}/{config.SITES_MASTER_PATH} not found"
        )
    return blob.download_as_text()


def _read_text_from_local() -> str:
    with open(config.LOCAL_SITES_MASTER, "r", encoding="utf-8") as f:
        return f.read()


def _load() -> list[Site]:
    """Load sites_master.csv into a list of Site. GCS first, local fallback."""
    text: str
    if config.USE_LOCAL_CSV:
        logger.info("USE_LOCAL_CSV=1; reading %s", config.LOCAL_SITES_MASTER)
        text = _read_text_from_local()
    else:
        try:
            text = _read_text_from_gcs()
        except Exception as exc:
            logger.warning(
                "GCS read failed (%s); falling back to local %s",
                exc, config.LOCAL_SITES_MASTER,
            )
            text = _read_text_from_local()

    reader = csv.DictReader(io.StringIO(text))
    sites: list[Site] = []
    for row in reader:
        site = _row_to_site(row)
        if site is not None:
            sites.append(site)
    logger.info("Loaded %d sites from spine", len(sites))
    return sites


# ---- Public API ----

def get_sites() -> list[Site]:
    """Return all sites in the spine (cached)."""
    return _cache.get_or_load(_CACHE_KEY, _load)


def get_active_sites() -> list[Site]:
    return [s for s in get_sites() if s.is_active]


def get_agencies() -> list[str]:
    """Distinct agency names, ordered alphabetically."""
    seen: set[str] = set()
    ordered: list[str] = []
    for s in get_sites():
        if s.agency_name and s.agency_name not in seen:
            seen.add(s.agency_name)
            ordered.append(s.agency_name)
    return sorted(ordered)


def sites_for_agency(agency_name: str) -> list[Site]:
    return [s for s in get_sites() if s.agency_name == agency_name]


def invalidate_cache() -> None:
    _cache.invalidate(_CACHE_KEY)
