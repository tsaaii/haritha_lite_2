"""
overrides.csv loader.

NOTE: The dashboard aggregator (`data/aggregate.py`) does not currently
consume overrides — every metric is computed from `sites_master.csv`. This
module is kept around as an escape hatch for ad-hoc force-overrides and so
the existing `overrides.csv` in the repo doesn't go stale. If you wire it
in later, `apply(metric_name, computed_value)` is the integration point.

Schema:
    metric_name,value
    project.total_target_mt,1500000
    project.rdf_disposed_mt,12500

Lookup is case-insensitive on metric_name. A missing file is fine — the
loader returns an empty dict.

Storage location is derived from `config.SITES_MASTER_CSV`:
    - If that's a gs:// URL, overrides.csv is read from the same bucket
      under `dashboard_config/overrides.csv` (configurable via
      OVERRIDES_GCS_KEY env var).
    - Otherwise, `overrides.csv` is read from the repo root.
"""
from __future__ import annotations

import csv
import io
import logging
import os
from typing import Any

import config
from data._cache import TTLCache

logger = logging.getLogger(__name__)
_cache = TTLCache(config.CACHE_TTL_SECONDS)
_CACHE_KEY = "overrides"

LOCAL_OVERRIDES_PATH = os.environ.get("LOCAL_OVERRIDES_PATH", "overrides.csv")
OVERRIDES_GCS_KEY = os.environ.get(
    "OVERRIDES_GCS_KEY", "dashboard_config/overrides.csv",
)


def _coerce(raw: str) -> Any:
    """Best-effort coerce override values: int -> float -> str."""
    raw = (raw or "").strip()
    if raw == "":
        return None
    try:
        if "." not in raw:
            return int(raw.replace(",", ""))
    except ValueError:
        pass
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return raw


def _read_text_from_gcs(bucket_name: str, key: str) -> str:
    from google.cloud import storage  # type: ignore
    client = storage.Client()
    blob = client.bucket(bucket_name).blob(key)
    if not blob.exists():
        return ""
    return blob.download_as_text()


def _read_text_from_local(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _read_text() -> str:
    """Pull overrides.csv from the same backing store as sites_master.csv."""
    sites_path = config.SITES_MASTER_CSV
    if config.is_gcs_path(sites_path):
        bucket, _ = config.parse_gcs_path(sites_path)
        try:
            return _read_text_from_gcs(bucket, OVERRIDES_GCS_KEY)
        except Exception as exc:
            logger.warning(
                "Overrides GCS read failed (%s); falling back to local file", exc,
            )
            return _read_text_from_local(LOCAL_OVERRIDES_PATH)
    return _read_text_from_local(LOCAL_OVERRIDES_PATH)


def _load() -> dict[str, Any]:
    text = _read_text()
    if not text.strip():
        return {}

    reader = csv.DictReader(io.StringIO(text))
    result: dict[str, Any] = {}
    for row in reader:
        # support both ('metric_name','value') and lower-case variants
        key = (row.get("metric_name") or row.get("metric") or "").strip().lower()
        if not key or key.startswith("#"):
            continue
        result[key] = _coerce(row.get("value", ""))
    logger.info("Loaded %d overrides", len(result))
    return result


# ---- Public ----

def get_overrides() -> dict[str, Any]:
    return _cache.get_or_load(_CACHE_KEY, _load)


def apply(metric_name: str, computed_value: Any) -> Any:
    """Return override if present (case-insensitive), else the computed value."""
    o = get_overrides()
    return o.get(metric_name.lower(), computed_value)


def invalidate_cache() -> None:
    _cache.invalidate(_CACHE_KEY)
