"""
Pure aggregation. Takes spine sites + records + overrides and produces the
exact dicts the templates render. No I/O here, no Flask, no globals.

Override keys (case-insensitive):
    project.total_target_mt
    project.total_remediated_mt
    project.overall_completion_pct
    project.rdf_disposed_mt
    project.rdf_expected_mt

    agency.<agency>.target_mt
    agency.<agency>.remediated_mt
    agency.<agency>.today_mt
    agency.<agency>.completion_pct
    agency.<agency>.daily_rate_required
    agency.<agency>.daily_rate_current
    agency.<agency>.rdf_disposed_mt
    agency.<agency>.rdf_expected_mt
    agency.<agency>.disposal_soil_mt
    agency.<agency>.disposal_rdf_mt
    agency.<agency>.disposal_cnd_mt
    agency.<agency>.disposal_inert_mt
    agency.<agency>.land_reclaimed_acres
    agency.<agency>.land_to_reclaim_acres
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Optional

import config
from data import overrides
from data.master import Site
from data.records import SiteRecords


# ===========================================================================
# Number formatting
# ===========================================================================

def fmt_int_indian(n: float) -> str:
    """Indian thousand-separator format: 1,23,45,678."""
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
    pieces: list[str] = []
    while len(head) > 2:
        pieces.append(head[-2:])
        head = head[:-2]
    if head:
        pieces.append(head)
    return sign + ",".join(reversed(pieces)) + "," + tail


def fmt_mt(value: float, decimals: int = 0) -> str:
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
    n = len(str(s))
    if n <= 5:  return "is-lg"
    if n <= 8:  return "is-md"
    if n <= 11: return "is-sm"
    return "is-xs"


def _stat(value, label: str, color: str) -> dict:
    v = str(value)
    return {"value": v, "label": label, "color": color, "size_class": _size_class(v)}


# ===========================================================================
# Math + spine helpers
# ===========================================================================

def _safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def _completion_pct(numer: float, denom: float, *, cap: bool = True) -> float:
    raw = _safe_div(numer, denom) * 100.0
    raw = max(0.0, raw)
    return min(100.0, raw) if cap else raw


def _site_completion(site: Site, rec: Optional[SiteRecords]) -> float:
    if rec is None:
        return 0.0
    return _completion_pct(rec.total_weight_mt, site.target_mt)


def _completion_buckets(
    sites: Iterable[Site],
    records: dict[str, SiteRecords],
) -> tuple[int, int, int, int]:
    """Return (>=100%, 75–99%, 50–74%, <50%) site counts."""
    b100 = b75 = b50 = below = 0
    for s in sites:
        pct = _site_completion(s, records.get(s.site_name))
        if pct >= 100:    b100 += 1
        elif pct >= 75:   b75  += 1
        elif pct >= 50:   b50  += 1
        else:             below += 1
    return b100, b75, b50, below


def _required_today_for_sites(
    sites: Iterable[Site],
    records: dict[str, SiteRecords],
    today: date,
) -> float:
    """Sum of per-site MT/day required to finish each on time."""
    total = 0.0
    for s in sites:
        if s.deadline_date is not None and today > s.deadline_date:
            continue
        already = (records[s.site_name].total_weight_mt
                   if s.site_name in records else 0.0)
        remaining = max(0.0, s.target_mt - already)
        days = max(1, _days_remaining(s.deadline_date, today))
        total += remaining / days
    return total


def _days_remaining(deadline: Optional[date], today: Optional[date] = None) -> int:
    today = today or config.today_ist()
    deadline = deadline or config.project_deadline_date()
    return max(0, (deadline - today).days)


def _completion_color(pct: float) -> str:
    if pct >= 100: return "var(--success, #38A169)"
    if pct >= 80:  return "var(--info, #3182CE)"
    if pct >= 50:  return "var(--warning, #DD6B20)"
    return "var(--error, #E53E3E)"


def _ovr_float(key: str) -> float:
    return float(overrides.apply(key, 0) or 0)


def _today_str(value: float) -> str:
    """1-decimal for small values, integer with Indian commas otherwise."""
    return f"{value:.1f}" if value < 1000 else fmt_int_indian(int(value))


# ===========================================================================
# Card builders — one helper per layout, reused everywhere
# ===========================================================================

def _ratio_card(*,
                icon: str, title: str,
                num: float, num_label: str, num_color: str,
                den: float, den_label: str, den_color: str,
                badge_variant: str = "orange",
                num_str: Optional[str] = None,
                den_str: Optional[str] = None,
                cap_pct: bool = True) -> dict:
    """Stacked card: numerator over denominator with a % badge.

    Used by Project Overview / RDF Disposal / Required Performance / Agency
    Progress / Agency RDF / Agency Performance / Land Reclaimed — 7 cards.
    """
    return {
        "icon": icon,
        "title": title,
        "badge_text": fmt_pct(_completion_pct(num, den, cap=cap_pct)),
        "badge_variant": badge_variant,
        "layout": "stacked",
        "stats": [
            _stat(num_str if num_str is not None else fmt_int_indian(int(num)),
                  num_label, num_color),
            _stat(den_str if den_str is not None else fmt_int_indian(int(den)),
                  den_label, den_color),
        ],
    }


def _grid_2x2_card(*,
                   icon: str, title: str,
                   badge_text: str,
                   stats: list[dict],
                   badge_variant: str = "orange") -> dict:
    """Card 4 / Card 8 / Card 11 — 2×2 quadrant grid."""
    return {
        "icon": icon, "title": title,
        "badge_text": badge_text, "badge_variant": badge_variant,
        "layout": "grid_2x2", "stats": stats,
    }


def _list_card(*,
               icon: str, title: str,
               entries: list[dict],
               subtitle: Optional[str] = None,
               badge_text: Optional[str] = None,
               badge_variant: str = "orange",
               empty_text: str = "—") -> dict:
    """Vertical list of label/value rows. Used by Outward & Lagging Sites."""
    card = {
        "icon": icon, "title": title,
        "layout": "list",
        "entries": entries, "empty_text": empty_text,
    }
    if subtitle:    card["subtitle"]      = subtitle
    if badge_text:  card["badge_text"]    = badge_text
    if badge_text:  card["badge_variant"] = badge_variant
    return card


# ===========================================================================
# Project-level aggregation (the 1×4 header row)
# ===========================================================================

@dataclass
class ProjectOverview:
    total_sites: int
    active_sites: int
    total_target_mt: float
    total_remediated_mt: float
    today_mt: float
    required_today_mt: float
    overall_completion_pct: float
    rdf_disposed_mt: float = 0.0
    rdf_expected_mt: float = 0.0
    recl_100: int = 0
    recl_75_99: int = 0
    recl_50_75: int = 0
    recl_below_50: int = 0


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
    required_today = _required_today_for_sites(active, records, today)
    b100, b75, b50, below = _completion_buckets(active, records)

    rdf_disposed = _ovr_float("project.rdf_disposed_mt")
    rdf_expected = _ovr_float("project.rdf_expected_mt")

    total_target     = overrides.apply("project.total_target_mt", total_target)
    total_remediated = overrides.apply("project.total_remediated_mt", total_remediated)
    today_mt         = overrides.apply("project.today_mt", today_mt)
    required_today   = overrides.apply("project.required_today_mt", required_today)
    pct = overrides.apply("project.overall_completion_pct",
                          _completion_pct(total_remediated, total_target))

    return ProjectOverview(
        total_sites=len(sites),
        active_sites=len(active),
        total_target_mt=total_target,
        total_remediated_mt=total_remediated,
        today_mt=today_mt,
        required_today_mt=required_today,
        overall_completion_pct=pct,
        rdf_disposed_mt=rdf_disposed,
        rdf_expected_mt=rdf_expected,
        recl_100=b100, recl_75_99=b75, recl_50_75=b50, recl_below_50=below,
    )


def overview_cards(o: ProjectOverview) -> list[dict]:
    """The 4 top cards — built from shared helpers."""
    return [
        _ratio_card(
            icon="📋", title="Project Overview",
            num=o.total_remediated_mt, num_label="TOTAL REMEDIATED (MT)",
            num_color="var(--success, #38A169)",
            den=o.total_target_mt,     den_label="TOTAL REQUIRED (MT)",
            den_color="var(--brand-primary)",
            badge_variant="orange",
        ),
        _ratio_card(
            icon="♻️", title="RDF Disposal Status",
            num=o.rdf_disposed_mt, num_label="DISPOSED (MT)",
            num_color="var(--success, #38A169)",
            den=o.rdf_expected_mt, den_label="EXPECTED RDF (MT)",
            den_color="var(--brand-primary)",
            badge_variant="green",
        ),
        _ratio_card(
            icon="⚡", title="Required Performance",
            num=o.today_mt,           num_label="TODAY (MT)",
            num_color="var(--brand-primary)",
            den=o.required_today_mt,  den_label="REQUIRED (MT)",
            den_color="var(--error, #E53E3E)",
            num_str=_today_str(o.today_mt),
            badge_variant="orange",
            cap_pct=False,    # performance can exceed 100%
        ),
        _grid_2x2_card(
            icon="🏭", title="Site Reclamation Status",
            badge_text=f"{o.active_sites} Sites",
            stats=[
                _stat(o.recl_100,      "100% COMPLETE", "var(--success, #38A169)"),
                _stat(o.recl_75_99,    "75–99%",        "var(--info, #3182CE)"),
                _stat(o.recl_50_75,    "50–75%",        "var(--warning, #DD6B20)"),
                _stat(o.recl_below_50, "BELOW 50%",     "var(--error, #E53E3E)"),
            ],
        ),
    ]


# Backwards-compat alias
def header_cards(overview: ProjectOverview) -> list[dict]:
    return overview_cards(overview)


# ===========================================================================
# Agency-level aggregation (the rotating 2×4 main grid)
# ===========================================================================

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
    today_mt: float
    completion_pct: float
    daily_rate_required: float
    daily_rate_current: float
    site_rankings: list[dict]
    # Per-site % buckets
    recl_100: int = 0
    recl_75_99: int = 0
    recl_50_75: int = 0
    recl_below_50: int = 0
    # Override-driven
    rdf_disposed_mt: float = 0.0
    rdf_expected_mt: float = 0.0
    disposal_soil_mt: float = 0.0
    disposal_rdf_mt: float = 0.0
    disposal_cnd_mt: float = 0.0
    disposal_inert_mt: float = 0.0
    land_reclaimed_acres: float = 0.0
    land_to_reclaim_acres: float = 0.0
    # Card 9 — sites where every record is still raw Legacy/MSW
    no_outward_sites: list[dict] = field(default_factory=list)


def agency_metrics(
    agency: str,
    sites: list[Site],
    records: dict[str, SiteRecords],
    records_recent: dict[str, SiteRecords],   # last 7d
    records_today: dict[str, SiteRecords],    # today (IST)
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

    daily_required = _required_today_for_sites(active, records, today)
    weight_last_7d = sum(records_recent[s.site_name].total_weight_mt
                         for s in active if s.site_name in records_recent)
    daily_current = weight_last_7d / 7.0

    b100, b75, b50, below = _completion_buckets(active, records)

    # Per-site rankings (used by Lagging Sites)
    rankings: list[dict] = []
    for s in active:
        rec = records.get(s.site_name)
        rankings.append({
            "site_name": s.site_name,
            "cluster": s.cluster,
            "target_mt": s.target_mt,
            "remediated_mt": rec.total_weight_mt if rec else 0.0,
            "completion_pct": _site_completion(s, rec),
        })
    rankings.sort(key=lambda r: r["completion_pct"], reverse=True)

    # Sites where every record is still raw Legacy/MSW (no outward yet)
    no_outward: list[dict] = []
    for s in active:
        rec = records.get(s.site_name)
        if rec is None or not rec.has_outward:
            no_outward.append({
                "site_name": s.site_name,
                "cluster": s.cluster,
                "total_weight_mt": rec.total_weight_mt if rec else 0.0,
            })
    # Largest pending tonnage first (most actionable)
    no_outward.sort(key=lambda x: x["total_weight_mt"], reverse=True)

    # Override-driven figures
    rdf_disposed_a = _ovr_float(f"agency.{agency}.rdf_disposed_mt")
    rdf_expected_a = _ovr_float(f"agency.{agency}.rdf_expected_mt")
    disp_soil      = _ovr_float(f"agency.{agency}.disposal_soil_mt")
    disp_rdf       = _ovr_float(f"agency.{agency}.disposal_rdf_mt")
    disp_cnd       = _ovr_float(f"agency.{agency}.disposal_cnd_mt")
    disp_inert     = _ovr_float(f"agency.{agency}.disposal_inert_mt")
    land_done      = _ovr_float(f"agency.{agency}.land_reclaimed_acres")
    land_target    = _ovr_float(f"agency.{agency}.land_to_reclaim_acres")

    # Apply scalar overrides
    target         = overrides.apply(f"agency.{agency}.target_mt", target)
    remediated     = overrides.apply(f"agency.{agency}.remediated_mt", remediated)
    today_mt       = overrides.apply(f"agency.{agency}.today_mt", today_mt)
    pct            = overrides.apply(f"agency.{agency}.completion_pct", pct)
    daily_required = overrides.apply(f"agency.{agency}.daily_rate_required", daily_required)
    daily_current  = overrides.apply(f"agency.{agency}.daily_rate_current", daily_current)

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
        daily_rate_required=daily_required,
        daily_rate_current=daily_current,
        site_rankings=rankings,
        recl_100=b100, recl_75_99=b75, recl_50_75=b50, recl_below_50=below,
        rdf_disposed_mt=rdf_disposed_a, rdf_expected_mt=rdf_expected_a,
        disposal_soil_mt=disp_soil,   disposal_rdf_mt=disp_rdf,
        disposal_cnd_mt=disp_cnd,     disposal_inert_mt=disp_inert,
        land_reclaimed_acres=land_done, land_to_reclaim_acres=land_target,
        no_outward_sites=no_outward,
    )


def main_cards(am: AgencyMetrics) -> list[dict]:
    """The 8 main agency cards (2×4 grid).

    Row 1 (cards 5-8 serially) mirrors the top 4 cards.
    Row 2 (cards 9-12 serially):
        9  Outward Performance     (list — sites with no outward yet)
        10 Lagging Sites           (list — ascending completion %)
        11 Disposal Statistics     (grid_2x2 — Soil/RDF/C&D/Inert)
        12 Land Reclaimed          (stacked — reclaimed/target acres)
    """

    # --------- Row 1 ---------
    row1 = [
        _ratio_card(
            icon="📋", title="Agency Progress",
            num=am.remediated_mt, num_label="TOTAL REMEDIATED (MT)",
            num_color="var(--success, #38A169)",
            den=am.target_mt,     den_label="TOTAL REQUIRED (MT)",
            den_color="var(--brand-primary)",
        ),
        _ratio_card(
            icon="♻️", title="RDF Disposal Status",
            num=am.rdf_disposed_mt, num_label="DISPOSED (MT)",
            num_color="var(--success, #38A169)",
            den=am.rdf_expected_mt, den_label="EXPECTED RDF (MT)",
            den_color="var(--brand-primary)",
            badge_variant="green",
        ),
        _ratio_card(
            icon="⚡", title="Agency Performance",
            num=am.today_mt,            num_label="TODAY (MT)",
            num_color="var(--brand-primary)",
            den=am.daily_rate_required, den_label="REQUIRED (MT)",
            den_color="var(--error, #E53E3E)",
            num_str=_today_str(am.today_mt),
            cap_pct=False,
        ),
        _grid_2x2_card(
            icon="🏭", title="Site Reclamation Status",
            badge_text=f"{am.active_sites} Sites",
            stats=[
                _stat(am.recl_100,      "100% COMPLETE", "var(--success, #38A169)"),
                _stat(am.recl_75_99,    "75–99%",        "var(--info, #3182CE)"),
                _stat(am.recl_50_75,    "50–75%",        "var(--warning, #DD6B20)"),
                _stat(am.recl_below_50, "BELOW 50%",     "var(--error, #E53E3E)"),
            ],
        ),
    ]

    # --------- Row 2 ---------
    n_no_out = len(am.no_outward_sites)
    outward_card = _list_card(
        icon="📤", title="Outward Performance",
        badge_text=(f"{n_no_out} Site{'s' if n_no_out != 1 else ''} pending"
                    if n_no_out else "All clear"),
        badge_variant=("red" if n_no_out else "green"),
        entries=[{"label": x["site_name"], "value": fmt_mt(x["total_weight_mt"])}
                 for x in am.no_outward_sites[:5]],
        empty_text="Every site has at least some outward processing 🎉",
    )

    lagging = sorted(am.site_rankings, key=lambda r: r["completion_pct"])[:5]
    lagging_card = _list_card(
        icon="📉", title="Lagging Sites",
        entries=[{"label": r["site_name"],
                  "value": fmt_pct(r["completion_pct"]),
                  "color": _completion_color(r["completion_pct"])}
                 for r in lagging],
        empty_text="No site records",
    )

    total_disposal = (am.disposal_soil_mt + am.disposal_rdf_mt
                      + am.disposal_cnd_mt + am.disposal_inert_mt)
    disposal_card = _grid_2x2_card(
        icon="🗑️", title="Disposal Statistics",
        badge_text=fmt_mt(total_disposal),
        stats=[
            _stat(fmt_int_indian(int(am.disposal_soil_mt)),  "SOIL (MT)",  "var(--warning, #DD6B20)"),
            _stat(fmt_int_indian(int(am.disposal_rdf_mt)),   "RDF (MT)",   "var(--success, #38A169)"),
            _stat(fmt_int_indian(int(am.disposal_cnd_mt)),   "C&D (MT)",   "var(--info, #3182CE)"),
            _stat(fmt_int_indian(int(am.disposal_inert_mt)), "INERT (MT)", "var(--text-secondary)"),
        ],
    )

    land_card = _ratio_card(
        icon="🌳", title="Land Reclaimed",
        num=am.land_reclaimed_acres,  num_label="RECLAIMED (ACRES)",
        num_color="var(--success, #38A169)",
        den=am.land_to_reclaim_acres, den_label="TO BE RECLAIMED (ACRES)",
        den_color="var(--brand-primary)",
        badge_variant="green",
    )

    return [*row1, outward_card, lagging_card, disposal_card, land_card]
