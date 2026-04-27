"""
Records API client.

The spine tells us *what should be remediated*. The records API tells us
*what has actually been remediated*: returns a list of weighbridge records,
each with a net_weight (kg) and ticket_no.

API contract (matches the FastAPI in /records):
    GET {RECORDS_API_BASE}/records?site_name=X&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD

    -> {
         "records": [{ticket_no, net_weight, ...}, ...],
         "pagination": {"page": 1, "limit": ..., "total": N, "pages": ...},
         ...
       }

Note on api_site_names: the spine can list pipe-separated names, e.g.
"Kadapa|Kadapa2". The API uses a CASE-INSENSITIVE SUBSTRING match on
site_name, so querying "Kadapa" already returns records from both
"Kadapa" and "Kadapa2". To avoid double-counting we dedupe by ticket_no
across all per-name responses.

If the API is unreachable we return zeros for that site rather than crash —
the dashboard should degrade gracefully, not 500.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Iterable

import requests

import config
from data._cache import TTLCache
from data.master import Site

logger = logging.getLogger(__name__)
_cache = TTLCache(config.CACHE_TTL_SECONDS)


@dataclass(frozen=True)
class SiteRecords:
    """Aggregated remediation records for one spine-site."""
    site_name: str
    total_trips: int
    total_weight_kg: float

    @property
    def total_weight_mt(self) -> float:
        return self.total_weight_kg / 1000.0


def _safe_float(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _fetch_records_for_api_name(api_name: str, start: date, end: date) -> list[dict]:
    """Hit /records for one api-side name. Returns the raw records list (or [] on failure)."""
    url = f"{config.RECORDS_API_BASE}/records"
    params = {
        "site_name": api_name,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        # no `limit` -> the API returns all matching records
    }
    try:
        r = requests.get(url, params=params, timeout=config.RECORDS_API_TIMEOUT_S)
        r.raise_for_status()
        payload = r.json() or {}
    except Exception as exc:
        logger.warning("Records API failed for %s: %s", api_name, exc)
        return []

    records = payload.get("records") or []
    if not isinstance(records, list):
        logger.warning("Records API returned non-list 'records' for %s", api_name)
        return []
    return records


def _aggregate_records(site: Site, raw_per_name: list[list[dict]]) -> SiteRecords:
    """Dedupe by ticket_no across the per-api-name responses, then sum."""
    seen_tickets: set[str] = set()
    trips = 0
    weight_kg = 0.0

    for batch in raw_per_name:
        for rec in batch:
            ticket_no = (rec.get("ticket_no") or "").strip()
            if ticket_no:
                if ticket_no in seen_tickets:
                    continue
                seen_tickets.add(ticket_no)
            # If a record has no ticket_no it can still count, but won't dedupe.
            trips += 1
            # Prefer net_weight_calculated if present and non-zero, else net_weight.
            nw_calc = _safe_float(rec.get("net_weight_calculated"))
            nw = _safe_float(rec.get("net_weight"))
            weight_kg += nw_calc if nw_calc > 0 else nw

    return SiteRecords(
        site_name=site.site_name,
        total_trips=trips,
        total_weight_kg=weight_kg,
    )


def _records_for_site(site: Site, start: date, end: date) -> SiteRecords:
    raw_per_name = [
        _fetch_records_for_api_name(name, start, end)
        for name in site.api_site_names
    ]
    return _aggregate_records(site, raw_per_name)


def get_records_for_site(site: Site, start: date, end: date) -> SiteRecords:
    """Cached per (site_name, start, end)."""
    key = f"records:{site.site_name}:{start.isoformat()}:{end.isoformat()}"
    return _cache.get_or_load(key, lambda: _records_for_site(site, start, end))


def get_records_for_sites(
    sites: Iterable[Site], start: date, end: date
) -> dict[str, SiteRecords]:
    """Convenience: return {site_name: SiteRecords} for the given sites."""
    return {s.site_name: get_records_for_site(s, start, end) for s in sites}


def invalidate_cache() -> None:
    _cache.invalidate()
