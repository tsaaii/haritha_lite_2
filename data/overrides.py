"""
overrides.csv loader.

Schema (per your direction, v1):
    metric_name,value
    total_target_mt,1500000
    total_remediated_mt,425000
    days_remaining,400

Any metric the dashboard cares about can be force-overridden by listing its
key here. Lookup is case-insensitive on metric_name. Missing file is fine.
"""
from __future__ import annotations

import csv
import io
import logging
from typing import Any

import config
from data._cache import TTLCache

logger = logging.getLogger(__name__)
_cache = TTLCache(config.CACHE_TTL_SECONDS)
_CACHE_KEY = "overrides"


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


def _read_text_from_gcs() -> str:
    from google.cloud import storage  # type: ignore

    client = storage.Client()
    bucket = client.bucket(config.GCS_BUCKET)
    blob = bucket.blob(config.OVERRIDES_PATH)
    if not blob.exists():
        return ""
    return blob.download_as_text()


def _read_text_from_local() -> str:
    try:
        with open(config.LOCAL_OVERRIDES, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _load() -> dict[str, Any]:
    text: str
    if config.USE_LOCAL_CSV:
        text = _read_text_from_local()
    else:
        try:
            text = _read_text_from_gcs()
        except Exception as exc:
            logger.warning("Overrides GCS read failed (%s); falling back local", exc)
            text = _read_text_from_local()

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
