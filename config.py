"""
Centralised config for haritha_lite.
All knobs live here. Override via environment variables in App Engine / locally.
"""
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo


# ---- GCS ----
GCS_BUCKET = os.environ.get("GCS_BUCKET", "advitia-weighbridge-data")
SITES_MASTER_PATH = os.environ.get(
    "SITES_MASTER_PATH",
    "dashboard_config/sites_master.csv",
)
OVERRIDES_PATH = os.environ.get(
    "OVERRIDES_PATH",
    "dashboard_config/overrides.csv",
)

# Local fallback for dev (used when GCS is unreachable or USE_LOCAL_CSV=1)
USE_LOCAL_CSV = os.environ.get("USE_LOCAL_CSV", "0") == "1"
LOCAL_SITES_MASTER = os.environ.get("LOCAL_SITES_MASTER", "sites_master.csv")
LOCAL_OVERRIDES = os.environ.get("LOCAL_OVERRIDES", "overrides.csv")


# ---- Weighbridge / Records API ----
RECORDS_API_BASE = os.environ.get(
    "RECORDS_API_BASE",
    "https://api.example.com",
).rstrip("/")
RECORDS_API_TIMEOUT_S = int(os.environ.get("RECORDS_API_TIMEOUT_S", "10"))


# ---- Cache ----
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", str(30 * 60)))  # 30 min


# ---- Project ----
PROJECT_DEADLINE = os.environ.get("PROJECT_DEADLINE", "2026-05-31")


# ---- Display / branding ----
AGENCY_DISPLAY_NAMES = {
    "Tharuni Associates": "Tharuni Associates",
    "Zigma Global Enviro": "Zigma Global Enviro",
    "Saurashtra Enviro Projects": "Saurashtra Enviro Projects",
    "Coastline": "Coastline",
}


# ---- Agency rotation ----
ROTATION_INTERVAL_MS = int(os.environ.get("ROTATION_INTERVAL_MS", "12000"))  # 12s


def project_deadline_date() -> date:
    """Parse PROJECT_DEADLINE env var into a date (yyyy-mm-dd)."""
    try:
        y, m, d = (int(x) for x in PROJECT_DEADLINE.split("-"))
        return date(y, m, d)
    except Exception:
        return date(2026, 5, 31)


# ---- "Today" canonical (IST) ----
IST = ZoneInfo("Asia/Kolkata")


def today_ist() -> date:
    """Return today's date in IST. Use this everywhere instead of date.today()."""
    return datetime.now(IST).date()
