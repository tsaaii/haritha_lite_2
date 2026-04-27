"""
Pure aggregation. Takes spine sites + records + overrides and produces the
exact dicts the templates render. No I/O here, no Flask, no globals.

Naming convention for override keys (case-insensitive):
    project.total_target_mt
    project.total_remediated_mt
    project.overall_completion_pct
    project.days_remaining
    project.rdf_disposed_mt
    project.rdf_expected_mt

    agency.<agency>.target_mt
    agency.<agency>.remediated_mt
    agency.<agency>.completion_pct
    agency.<agency>.daily_rate_required
    agency.<agency>.daily_rate_current
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import config
from data import overrides
from data.master import Site
from data.records import SiteRecords


# ---------------------------------------------------------------------------
# Number formatting (Indian-style for big numbers, e.g. 12,34,567)
# ---------------------------------------------------------------------------

def fmt_int_indian(n: float) -> str:
    """Format a number with Indian thousand separators (lakh/crore)."""
    if n is None:
        return "—"
    try:
        n = int(round(float(n)))
    except (TypeError, ValueError):
        return "—"
    if n == 0:
        return "0"
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) <= 3:
        return sign + s
    head, tail = s[:-3], s[-3:]
    # group head in pairs from the right
    pieces: list[str] = []
    while len(head) > 2:
        pieces.append(head[-2:])
        head = head[:-2]
    if head:
        pieces.append(head)
    return sign + ",".join(reversed(pieces)) + "," + tail


def fmt_mt(value: float, decimals: int = 0) -> str:
    """Format an MT value: 1,23,456 MT or 1,23,456.7 MT."""
    if value is None:
        return "—"
    if decimals == 0:
        return f"{fmt_int_indian(value)} MT"
    return f"{fmt_int_indian(int(value))}.{int((value % 1) * 10**decimals):0{decimals}d} MT"


def fmt_pct(value: float, decimals: int = 1) -> str:
    if value is None:
        return "—"
    return f"{value:.{decimals}f}%"


def _size_class(s: str) -> str:
    """Pick a font-size class based on rendered length so values fit the card."""
    n = len(str(s))
    if n <= 5:  return "is-lg"
    if n <= 8:  return "is-md"
    if n <= 11: return "is-sm"
    return "is-xs"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_div(num: float, den: float) -> float:
    if not den:
        return 0.0
    return num / den


def _completion_pct(remediated_mt: float, target_mt: float) -> float:
    return min(100.0, max(0.0, _safe_div(remediated_mt, target_mt) * 100.0))


def _days_remaining(deadline: Optional[date], today: Optional[date] = None) -> int:
    today = today or config.today_ist()
    deadline = deadline or config.project_deadline_date()
    return max(0, (deadline - today).days)


def _earliest_deadline(sites: list[Site]) -> Optional[date]:
    deadlines = [s.deadline_date for s in sites if s.deadline_date]
    return min(deadlines) if deadlines else None


def _completion_color(pct: float) -> str:
    """Match the original CSS variable names for performance-tinted text."""
    if pct >= 100:
        return "var(--success, #38A169)"
    if pct >= 80:
        return "var(--info, #3182CE)"
    if pct >= 50:
        return "var(--warning, #DD6B20)"
    return "var(--error, #E53E3E)"


# ---------------------------------------------------------------------------
# Project-level aggregation (the 1×4 header row)
# ---------------------------------------------------------------------------

@dataclass
class ProjectOverview:
    total_sites: int
    active_sites: int
    inactive_sites: int
    total_agencies: int
    total_clusters: int
    total_target_mt: float
    total_remediated_mt: float
    today_mt: float                     # MT remediated *today* (IST), all active sites
    required_today_mt: float            # MT required *today* to finish on time (per-site sum)
    overall_completion_pct: float
    days_remaining: int
    reclaimed_sites: int                # status='reclaimed' OR completion >= 100%
    in_progress_sites: int              # active sites that aren't reclaimed yet
    not_started_sites: int
    # NEW: RDF disposal numerics + per-site reclamation buckets
    rdf_disposed_mt: float = 0.0
    rdf_expected_mt: float = 0.0
    recl_100: int = 0          # sites at >= 100% completion
    recl_75_99: int = 0        # 75 <= pct < 100
    recl_50_75: int = 0        # 50 <= pct < 75
    recl_below_50: int = 0     # pct < 50


def project_overview(
    sites: list[Site],
    records: dict[str, SiteRecords],
    records_today: dict[str, SiteRecords],
    today: Optional[date] = None,
) -> ProjectOverview:
    today = today or config.today_ist()
    active = [s for s in sites if s.is_active]
    total_target = sum(s.target_mt for s in active)
    total_remediated = sum(records[s.site_name].total_weight_mt
                           for s in active if s.site_name in records)
    today_mt = sum(records_today[s.site_name].total_weight_mt
                   for s in active if s.site_name in records_today)

    # Required today (project-wide): sum of per-site requirements,
    # zero if site is past deadline (matches the agency-metrics rule).
    required_today = 0.0
    for s in active:
        if s.deadline_date is not None and today > s.deadline_date:
            continue
        site_remediated = (records[s.site_name].total_weight_mt
                           if s.site_name in records else 0.0)
        site_remaining = max(0.0, s.target_mt - site_remediated)
        site_days = _days_remaining(s.deadline_date, today)
        required_today += site_remaining / max(1, site_days)

    # Reclamation buckets — same rule as agency_metrics for consistency.
    reclaimed = 0
    in_progress = 0
    not_started = 0
    for s in active:
        site_pct = _site_completion(s, records.get(s.site_name))
        if site_pct >= 100 or s.is_reclaimed:
            reclaimed += 1
        elif site_pct > 0 or s.reclamation_status.lower() == "in_progress":
            in_progress += 1
        else:
            not_started += 1

    # NEW: per-site reclamation % buckets (remediated / target)
    recl_100 = recl_75_99 = recl_50_75 = recl_below_50 = 0
    for s in active:
        site_pct = _site_completion(s, records.get(s.site_name))
        if site_pct >= 100:
            recl_100 += 1
        elif site_pct >= 75:
            recl_75_99 += 1
        elif site_pct >= 50:
            recl_50_75 += 1
        else:
            recl_below_50 += 1

    # NEW: RDF disposal (overrides for now; wire to a real source later)
    rdf_disposed = float(overrides.apply("project.rdf_disposed_mt", 0) or 0)
    rdf_expected = float(overrides.apply("project.rdf_expected_mt", 0) or 0)

    # Apply overrides
    total_target = overrides.apply("project.total_target_mt", total_target)
    total_remediated = overrides.apply("project.total_remediated_mt", total_remediated)
    today_mt = overrides.apply("project.today_mt", today_mt)
    required_today = overrides.apply("project.required_today_mt", required_today)

    pct = _completion_pct(total_remediated, total_target)
    pct = overrides.apply("project.overall_completion_pct", pct)

    days = _days_remaining(config.project_deadline_date(), today)
    days = overrides.apply("project.days_remaining", days)

    return ProjectOverview(
        total_sites=len(sites),
        active_sites=len(active),
        inactive_sites=len(sites) - len(active),
        total_agencies=len({s.agency_name for s in sites if s.agency_name}),
        total_clusters=len({s.cluster for s in sites if s.cluster}),
        total_target_mt=total_target,
        total_remediated_mt=total_remediated,
        today_mt=today_mt,
        required_today_mt=required_today,
        overall_completion_pct=pct,
        days_remaining=days,
        reclaimed_sites=reclaimed,
        in_progress_sites=in_progress,
        not_started_sites=not_started,
        rdf_disposed_mt=rdf_disposed,
        rdf_expected_mt=rdf_expected,
        recl_100=recl_100,
        recl_75_99=recl_75_99,
        recl_50_75=recl_50_75,
        recl_below_50=recl_below_50,
    )


def overview_cards(overview: ProjectOverview) -> list[dict]:
    """The 4 top cards. Each dict matches the overview_card.html partial.

    layout='stacked'    => stats stacked vertically; value & label sit on the
                           same row (inline) inside each stat
    layout='horizontal' => two stats side-by-side with a vertical divider
    layout='grid_2x2'   => 4 stats in a 2×2 grid (used by reclamation buckets)
    """
    # Card 3 maths: today vs required today
    if overview.required_today_mt > 0:
        perf_pct = (overview.today_mt / overview.required_today_mt) * 100
    else:
        perf_pct = 0.0

    # Card 2 maths: disposed vs expected
    rdf_pct = _completion_pct(overview.rdf_disposed_mt, overview.rdf_expected_mt)

    # Today value: keep one decimal when small, integer otherwise
    today_str = (f"{overview.today_mt:.1f}" if overview.today_mt < 1000
                 else fmt_int_indian(int(overview.today_mt)))

    def stat(value, label, color):
        v = str(value)
        return {"value": v, "label": label, "color": color, "size_class": _size_class(v)}

    return [
        # ── Card 1: Project Overview (stacked, inline labels) ──
        {
            "icon": "📋",
            "title": "Project Overview",
            "badge_text": fmt_pct(overview.overall_completion_pct),
            "badge_variant": "orange",
            "layout": "stacked",
            "stats": [
                stat(fmt_int_indian(int(overview.total_remediated_mt)),
                     "TOTAL REMEDIATED (MT)", "var(--success, #38A169)"),
                stat(fmt_int_indian(int(overview.total_target_mt)),
                     "TOTAL REQUIRED (MT)", "var(--brand-primary)"),
            ],
        },

        # ── Card 2: RDF Disposal Status (stacked, same shape as Card 1) ──
        {
            "icon": "♻️",
            "title": "RDF Disposal Status",
            "badge_text": fmt_pct(rdf_pct),
            "badge_variant": "green",
            "layout": "stacked",
            "stats": [
                stat(fmt_int_indian(int(overview.rdf_disposed_mt)),
                     "DISPOSED (MT)", "var(--success, #38A169)"),
                stat(fmt_int_indian(int(overview.rdf_expected_mt)),
                     "EXPECTED RDF (MT)", "var(--brand-primary)"),
            ],
        },

        # ── Card 3: Required Performance (stacked, inline labels) ──
        {
            "icon": "⚡",
            "title": "Required Performance",
            "badge_text": fmt_pct(perf_pct),
            "badge_variant": "orange",
            "layout": "stacked",
            "stats": [
                stat(today_str, "TODAY (MT)", "var(--brand-primary)"),
                stat(fmt_int_indian(int(overview.required_today_mt)),
                     "REQUIRED (MT)", "var(--error, #E53E3E)"),
            ],
        },

        # ── Card 4: Site Reclamation Status (2×2 grid) ──
        {
            "icon": "🏭",
            "title": "Site Reclamation Status",
            "badge_text": f"{overview.active_sites} Sites",
            "badge_variant": "orange",
            "layout": "grid_2x2",
            "stats": [
                stat(overview.recl_100,      "100% COMPLETE", "var(--success, #38A169)"),
                stat(overview.recl_75_99,    "75–99%",        "var(--info, #3182CE)"),
                stat(overview.recl_50_75,    "50–75%",        "var(--warning, #DD6B20)"),
                stat(overview.recl_below_50, "BELOW 50%",     "var(--error, #E53E3E)"),
            ],
        },
    ]


# Keep `header_cards` as an alias for backwards-compat (older tests may import it).
def header_cards(overview: ProjectOverview) -> list[dict]:
    return overview_cards(overview)


# ---------------------------------------------------------------------------
# Agency-level aggregation (the rotating 2×4 main grid)
# ---------------------------------------------------------------------------

@dataclass
class AgencyMetrics:
    agency_name: str
    display_name: str
    sites: list[Site]
    total_sites: int
    active_sites: int
    inactive_sites: int
    clusters: list[str]
    target_mt: float
    remediated_mt: float
    today_mt: float                      # MT remediated today (IST), this agency
    completion_pct: float
    earliest_deadline: Optional[date]
    days_remaining: int
    reclaimed_count: int
    in_progress_count: int
    not_started_count: int
    daily_rate_required: float       # MT/day to finish on time, summed per-site
    daily_rate_current: float        # estimated MT/day (last 7d)
    site_rankings: list[dict]        # [{site, cluster, completion_pct, ...}]
    critical_sites: list[dict]       # behind-schedule sites


def _site_completion(site: Site, rec: Optional[SiteRecords]) -> float:
    if rec is None:
        return 0.0
    return _completion_pct(rec.total_weight_mt, site.target_mt)


def agency_metrics(
    agency: str,
    sites: list[Site],
    records: dict[str, SiteRecords],
    records_recent: dict[str, SiteRecords],   # last 7d only
    records_today: dict[str, SiteRecords],    # today only (IST)
    today: Optional[date] = None,
) -> AgencyMetrics:
    today = today or config.today_ist()
    a_sites = [s for s in sites if s.agency_name == agency]
    active = [s for s in a_sites if s.is_active]

    target = sum(s.target_mt for s in active)
    remediated = sum(records[s.site_name].total_weight_mt
                     for s in active if s.site_name in records)
    today_mt = sum(records_today[s.site_name].total_weight_mt
                   for s in active if s.site_name in records_today)
    pct = _completion_pct(remediated, target)

    earliest = _earliest_deadline(active)
    days_left_to_earliest = _days_remaining(earliest, today)

    # ---- Required-today rate: SUM of per-site requirements ----
    daily_required = 0.0
    for s in active:
        if s.deadline_date is not None and today > s.deadline_date:
            continue   # deadline passed; site contributes 0
        site_remediated = (records[s.site_name].total_weight_mt
                           if s.site_name in records else 0.0)
        site_remaining = max(0.0, s.target_mt - site_remediated)
        site_days = _days_remaining(s.deadline_date, today)
        if site_days <= 0:
            site_days = 1
        daily_required += site_remaining / site_days

    # Current rate: rolling 7d average
    weight_last_7d = sum(records_recent[s.site_name].total_weight_mt
                         for s in active if s.site_name in records_recent)
    daily_current = weight_last_7d / 7.0

    # Reclamation buckets — use spine status, but a site at >=100% is also
    # reclaimed even if the spine hasn't been updated.
    reclaimed = 0
    in_progress = 0
    not_started = 0
    for s in active:
        site_pct = _site_completion(s, records.get(s.site_name))
        if site_pct >= 100 or s.is_reclaimed:
            reclaimed += 1
        elif site_pct > 0 or s.reclamation_status.lower() == "in_progress":
            in_progress += 1
        else:
            not_started += 1

    # Per-site rankings
    rankings: list[dict] = []
    for s in active:
        rec = records.get(s.site_name)
        rankings.append({
            "site_name": s.site_name,
            "cluster": s.cluster,
            "target_mt": s.target_mt,
            "remediated_mt": rec.total_weight_mt if rec else 0.0,
            "completion_pct": _site_completion(s, rec),
            "deadline_date": s.deadline_date.isoformat() if s.deadline_date else None,
        })
    rankings.sort(key=lambda r: r["completion_pct"], reverse=True)

    # Critical = behind schedule. Behind = elapsed_pct - completion_pct > 15
    critical: list[dict] = []
    for r in rankings:
        site_obj = next((s for s in active if s.site_name == r["site_name"]), None)
        if site_obj is None or site_obj.start_date is None or site_obj.deadline_date is None:
            continue
        total_days = (site_obj.deadline_date - site_obj.start_date).days
        if total_days <= 0:
            continue
        elapsed_days = max(0, (today - site_obj.start_date).days)
        elapsed_pct = min(100.0, 100.0 * elapsed_days / total_days)
        if elapsed_pct - r["completion_pct"] > 15:
            critical.append({**r, "elapsed_pct": elapsed_pct,
                             "behind_by_pts": elapsed_pct - r["completion_pct"]})
    critical.sort(key=lambda r: r["behind_by_pts"], reverse=True)

    # Apply overrides
    target = overrides.apply(f"agency.{agency}.target_mt", target)
    remediated = overrides.apply(f"agency.{agency}.remediated_mt", remediated)
    today_mt = overrides.apply(f"agency.{agency}.today_mt", today_mt)
    pct = overrides.apply(f"agency.{agency}.completion_pct", pct)
    daily_required = overrides.apply(f"agency.{agency}.daily_rate_required", daily_required)
    daily_current = overrides.apply(f"agency.{agency}.daily_rate_current", daily_current)

    return AgencyMetrics(
        agency_name=agency,
        display_name=config.AGENCY_DISPLAY_NAMES.get(agency, agency),
        sites=a_sites,
        total_sites=len(a_sites),
        active_sites=len(active),
        inactive_sites=len(a_sites) - len(active),
        clusters=sorted({s.cluster for s in a_sites if s.cluster}),
        target_mt=target,
        remediated_mt=remediated,
        today_mt=today_mt,
        completion_pct=pct,
        earliest_deadline=earliest,
        days_remaining=days_left_to_earliest,
        reclaimed_count=reclaimed,
        in_progress_count=in_progress,
        not_started_count=not_started,
        daily_rate_required=daily_required,
        daily_rate_current=daily_current,
        site_rankings=rankings,
        critical_sites=critical,
    )


def main_cards(am: AgencyMetrics) -> list[dict]:
    """The 8 main cards (2×4 grid) — agency-specific."""

    # Card 1 — Agency Progress (target vs remediated)
    progress_subtitle = f"{am.display_name} cumulative"
    if am.today_mt > 0:
        progress_subtitle = f"+{fmt_mt(am.today_mt, 1)} today  ·  cumulative"
    progress_card = {
        "kind": "progress",
        "icon": "🎯",
        "title": "Agency Progress",
        "subtitle": progress_subtitle,
        "primary_value": fmt_pct(am.completion_pct),
        "primary_color": _completion_color(am.completion_pct),
        "rows": [
            {"label": "Target", "value": fmt_mt(am.target_mt)},
            {"label": "Remediated", "value": fmt_mt(am.remediated_mt)},
            {"label": "Remaining", "value": fmt_mt(max(0, am.target_mt - am.remediated_mt))},
        ],
    }

    # Card 2 — Sites Status (active / inactive)
    sites_card = {
        "kind": "tri_metric",
        "icon": "📍",
        "title": "Sites",
        "subtitle": f"{am.total_sites} total",
        "metrics": [
            {"label": "Active",   "value": am.active_sites,   "color": "var(--success, #38A169)"},
            {"label": "Inactive", "value": am.inactive_sites, "color": "var(--text-secondary)"},
            {"label": "Clusters", "value": len(am.clusters),  "color": "var(--info, #3182CE)"},
        ],
    }

    # Card 3 — Reclaimed Sites tri-metric
    reclaimed_card = {
        "kind": "tri_metric",
        "icon": "✅",
        "title": "Reclamation Status",
        "subtitle": "by reclamation_status",
        "metrics": [
            {"label": "Reclaimed",   "value": am.reclaimed_count,   "color": "var(--success, #38A169)"},
            {"label": "In Progress", "value": am.in_progress_count, "color": "var(--warning, #DD6B20)"},
            {"label": "Not Started", "value": am.not_started_count, "color": "var(--error, #E53E3E)"},
        ],
    }

    # Card 4 — Timeline / Days remaining
    timeline_card = {
        "kind": "timeline",
        "icon": "⏳",
        "title": "Timeline",
        "subtitle": "to earliest deadline",
        "primary_value": fmt_int_indian(am.days_remaining) + " days",
        "primary_color": (
            "var(--error, #E53E3E)" if am.days_remaining <= 30
            else "var(--warning, #DD6B20)" if am.days_remaining <= 90
            else "var(--info, #3182CE)"
        ),
        "rows": [
            {"label": "Earliest deadline",
             "value": am.earliest_deadline.isoformat() if am.earliest_deadline else "—"},
            {"label": "Days remaining", "value": str(am.days_remaining)},
        ],
    }

    # Card 5 — Daily Rate (current vs required)
    rate_ratio = _safe_div(am.daily_rate_current, am.daily_rate_required) * 100 \
        if am.daily_rate_required else 0
    rate_card = {
        "kind": "progress",
        "icon": "⚡",
        "title": "Daily Rate",
        "subtitle": "current vs required",
        "primary_value": fmt_pct(rate_ratio),
        "primary_color": _completion_color(rate_ratio),
        "rows": [
            {"label": "Current (7d avg)",    "value": fmt_mt(am.daily_rate_current, 1) + "/day"},
            {"label": "Required",            "value": fmt_mt(am.daily_rate_required, 1) + "/day"},
        ],
    }

    # Card 6 — Cluster spread
    cluster_card = {
        "kind": "list",
        "icon": "🗺️",
        "title": "Clusters",
        "subtitle": f"{len(am.clusters)} cluster(s)",
        "entries": [{"label": c,
                     "value": str(sum(1 for s in am.sites if s.cluster == c)) + " sites"}
                    for c in am.clusters[:6]],
    }

    # Card 7 — Top Performing Sites
    top_card = {
        "kind": "list",
        "icon": "🏆",
        "title": "Top Performers",
        "subtitle": "best completion %",
        "entries": [{"label": r["site_name"],
                     "value": fmt_pct(r["completion_pct"]),
                     "color": _completion_color(r["completion_pct"])}
                    for r in am.site_rankings[:5]],
    }

    # Card 8 — Critical Sites (behind schedule)
    critical_card = {
        "kind": "list",
        "icon": "🚨",
        "title": "Critical Sites",
        "subtitle": "behind schedule",
        "empty_text": "No sites behind schedule" if not am.critical_sites else None,
        "entries": [{"label": r["site_name"],
                     "value": f"−{r['behind_by_pts']:.0f} pts",
                     "color": "var(--error, #E53E3E)"}
                    for r in am.critical_sites[:5]],
    }

    return [progress_card, sites_card, reclaimed_card, timeline_card,
            rate_card, cluster_card, top_card, critical_card]
