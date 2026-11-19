"""
Interactive dashboard for /rdf (tabs: Overview, Agencies, Sites, Date range, Report).

The Report tab is the printable sheet (data/rdf_report.py); this module adds the
analysis around it. All figures come from the uploaded trackers' columns; pace and
"disposed between two dates" are differences of the *cumulative* column, so a
missing day never skews them.

Site lists (definitions agreed with the user):
    Active      dispatched RDF in the last 3 days (calendar days, report day included)
    Stalled     RDF left, but nothing dispatched in the last 7 days
    Quick win   RDF left is 1,000 MT or less — one push closes it
    Long haul   at its last-7-day pace, RDF is still left on the deadline
    Cleared     nothing left at site
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from datetime import date, timedelta
from html import escape

from data.rdf_report import _deadline, _pct, _r, agency_short, day, fk, fmt
from data.rdf_tracker import Tracker

ACTIVE_DAYS = int(os.environ.get("RDF_ACTIVE_DAYS", "3"))
STALLED_DAYS = int(os.environ.get("RDF_STALLED_DAYS", "7"))
QUICK_MT = float(os.environ.get("RDF_QUICK_MT", "1000"))
PACE_WINDOW = int(os.environ.get("RDF_SITE_PACE_DAYS", "7"))

# Categorical palette (dataviz reference instance, validated: adjacent CVD ΔE ≥ 9.1).
# Colour follows the agency, never its rank: a fixed slot per known agency.
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
AGENCY_SLOT = {"tharuni associates": 0, "zigma global": 1, "coastline projects": 2, "saurashtra enviro": 3,
               "iway associates": 4, "card box company": 5, "raghu ram hume pipes": 6, "pr constructions": 7}
# Sequential (heatmap): one green ramp from the design system, light -> dark; 0 = neutral.
HEAT = ["#E4F6E9", "#BFEBC9", "#57C97F", "#0FA14E", "#0E5230"]
HEAT_ZERO = "#F5F7F5"


def agency_color(name: str, order: list[str]) -> str:
    slot = AGENCY_SLOT.get(name.strip().lower())
    if slot is None:
        used = {AGENCY_SLOT[n.strip().lower()] for n in order if n.strip().lower() in AGENCY_SLOT}
        free = [i for i in range(len(PALETTE)) if i not in used]
        unknown = [n for n in order if n.strip().lower() not in AGENCY_SLOT]
        idx = unknown.index(name) if name in unknown else 0
        slot = free[idx] if idx < len(free) else None
    return PALETTE[slot] if slot is not None else "#9AA79F"   # 9th+ agency: neutral "other"


# ---------------------------------------------------------------------------
# Per-site / per-agency series
# ---------------------------------------------------------------------------

@dataclass
class SiteSeries:
    key: str
    agency: str
    site: str
    tracked: bool = True
    phase: str = ""
    base: str = ""
    days: dict[date, tuple[float, float, float]] = field(default_factory=dict)   # d -> (today, cum, bal)

    def at(self, d: date):
        return self.days.get(d)

    def on_or_before(self, d: date):
        best = None
        for k in self.days:
            if k <= d and (best is None or k > best):
                best = k
        return (best, self.days[best]) if best else (None, None)

    def last_dispatch(self) -> date | None:
        moved = [d for d, v in self.days.items() if v[0] > 0]
        return max(moved) if moved else None


def _k(s) -> str:
    """Series key: the master row id when there is one (phase views), else agency + site."""
    return s.sid or (s.agency + "|" + s.site)


def _series(hist: list[Tracker]) -> dict[str, SiteSeries]:
    out: dict[str, SiteSeries] = {}
    for t in hist:
        for s in t.sites:
            k = _k(s)
            ss = out.get(k) or out.setdefault(k, SiteSeries(k, s.agency, s.site, s.tracked))
            ss.agency, ss.site, ss.tracked = s.agency, s.site, s.tracked     # latest day's naming wins
            ss.phase, ss.base = s.phase, s.base or s.site
            ss.days[t.date] = (s.today, s.cum, s.bal)
    return out


def _pace(points: dict[date, tuple[float, float, float]], rep: date, window: int) -> float:
    """MT/day over the last `window` calendar days, from the cumulative column."""
    if rep not in points:
        return 0.0
    base = [d for d in points if d <= rep - timedelta(days=window)]
    if base:
        b = max(base)
        return max(0.0, (points[rep][1] - points[b][1]) / max(1, (rep - b).days))
    first = min(points)
    if first == rep:
        return max(0.0, points[rep][0])
    # Not enough history yet: from the first day (its own disposal included).
    return max(0.0, (points[rep][1] - points[first][1] + points[first][0]) / ((rep - first).days + 1))


def _agency_points(series: list[SiteSeries]) -> dict[date, tuple[float, float, float]]:
    pts: dict[date, list[float]] = {}
    for ss in series:
        for d, (t, c, b) in ss.days.items():
            p = pts.setdefault(d, [0.0, 0.0, 0.0])
            p[0] += t
            p[1] += c
            p[2] += b
    return {d: tuple(v) for d, v in pts.items()}


def _finish(bal: float, pace: float, rep: date) -> date | None:
    if bal <= 0:
        return rep
    if pace <= 0:
        return None
    return rep + timedelta(days=math.ceil(bal / pace))


# ---------------------------------------------------------------------------
# Charts (inline SVG, CSS vars from report.css; <title> on marks = hover tooltip)
# ---------------------------------------------------------------------------

def _t(x, y, s, fill="var(--ink-500)", anchor="start", size=11, bold=False):
    return (f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" style="font-size:{size}px;'
            f'font-family:var(--font-serif);fill:{fill};{"font-weight:700;" if bold else ""}">{escape(s)}</text>')


def _nice(v: float) -> float:
    if v <= 0:
        return 1
    p = 10 ** math.floor(math.log10(v))
    for m in (1, 2, 2.5, 5, 10):
        if v <= m * p:
            return m * p
    return 10 * p


def stacked_daily_chart(dates: list[date], agencies: list[dict]) -> str:
    """Daily RDF disposed, stacked by agency. One bar per report day."""
    if not dates:
        return ""
    W, H, L, R, T, B = 600, 280, 48, 12, 26, 30
    n = len(dates)
    slot = (W - L - R) / n
    bw = max(3.0, min(28.0, slot * 0.7))
    totals = [sum(a["daily"].get(d, 0) for a in agencies) for d in dates]
    if max(totals + [0]) <= 0:
        return '<p class="muted small">No RDF was sent on any day on file in this view.</p>'
    top = _nice(max(totals + [1]) * 1.08)

    def y(v):
        return T + (1 - v / top) * (H - T - B)

    out = []
    for i in range(5):
        v = top * i / 4
        out.append(f'<line x1="{L}" x2="{W - R}" y1="{y(v):.1f}" y2="{y(v):.1f}" style="stroke:var(--ink-100)"/>')
        out.append(_t(L - 6, y(v) + 4, fk(v), anchor="end"))
    step = max(1, math.ceil(n / 8))
    for i, d in enumerate(dates):
        cx = L + slot * (i + 0.5)
        base = 0.0
        segs = [(a, a["daily"].get(d, 0)) for a in agencies if a["daily"].get(d, 0) > 0]
        for j, (a, v) in enumerate(segs):
            y0, y1 = y(base), y(base + v)
            h = max(0.0, y0 - y1 - (2 if j else 0))          # 2px surface gap between segments
            out.append(f'<rect x="{cx - bw / 2:.1f}" y="{y1:.1f}" width="{bw:.1f}" height="{h:.1f}" '
                       f'rx="{2 if j == len(segs) - 1 else 0}" style="fill:{a["color"]}">'
                       f'<title>{escape(day(d))} · {escape(a["short"])}: {fmt(v)} MT</title></rect>')
            base += v
        out.append(f'<rect x="{cx - slot / 2:.1f}" y="{T}" width="{slot:.1f}" height="{H - T - B}" '
                   f'style="fill:transparent"><title>{escape(day(d))}: {fmt(totals[i])} MT in all</title></rect>')
        if (n - 1 - i) % step == 0:
            last = i == n - 1
            out.append(_t(cx, H - 10, day(d), "var(--ink-900)" if last else "var(--ink-500)", "middle", bold=last))
    out.append(_t(2, T - 14, "MT a day", anchor="start"))
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Daily RDF disposed, by agency" '
            f'style="width:100%;height:auto;display:block">{"".join(out)}</svg>')


def heatmap(dates: list[date], rows: list[dict]) -> str:
    """Sites × report days; darker = more RDF sent. Grouped by agency."""
    if not dates or not rows:
        return ""
    n = len(dates)
    LW, cell, gap, top = 210, 16, 2, 34
    W = LW + n * (cell + gap) + 8
    H = top + len(rows) * (cell + gap) + 6
    vmax = max([v for r in rows for v in r["cells"] if v is not None] + [1])
    out = []
    step = max(1, math.ceil(n / 10))
    for i, d in enumerate(dates):
        if (n - 1 - i) % step == 0:
            x = LW + i * (cell + gap) + cell / 2
            out.append(_t(x, top - 10, day(d), anchor="middle", size=10))
    prev = None
    for j, r in enumerate(rows):
        yy = top + j * (cell + gap)
        if r["agency"] != prev:
            out.append(f'<line x1="0" x2="{W}" y1="{yy - 1:.1f}" y2="{yy - 1:.1f}" style="stroke:var(--ink-200)"/>')
            prev = r["agency"]
        label = r["site"] if len(r["site"]) <= 26 else r["site"][:25] + "…"
        out.append(f'<rect x="0" y="{yy}" width="5" height="{cell}" rx="1" style="fill:{r["color"]}"/>')
        out.append(_t(10, yy + cell - 4, label, "var(--ink-900)", size=11))
        for i, v in enumerate(r["cells"]):
            x = LW + i * (cell + gap)
            if v is None:
                fill = "transparent"
                tip = f"{day(dates[i])}: not in that day's sheet"
            elif v <= 0:
                fill, tip = HEAT_ZERO, f"{day(dates[i])}: nothing sent"
            else:
                k = min(len(HEAT) - 1, int(math.sqrt(v / vmax) * len(HEAT)))
                fill, tip = HEAT[k], f"{day(dates[i])}: {fmt(v)} MT"
            out.append(f'<rect x="{x}" y="{yy}" width="{cell}" height="{cell}" rx="3" style="fill:{fill}">'
                       f'<title>{escape(r["site"])} · {escape(tip)}</title></rect>')
    return (f'<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
            f'aria-label="RDF sent per site per day" style="display:block">{"".join(out)}</svg>')


def finish_chart(rows: list[dict], rep: date, dl: date) -> str:
    """Projected clear date per agency (dot) against the deadline (dashed line)."""
    if not rows:
        return ""
    # Drawn at ~1:1 in the full-width card so text stays readable and inside the box.
    W, L, R, T, rowh = 1100, 150, 260, 30, 34
    H = T + len(rows) * rowh + 8
    horizon = max([dl + timedelta(days=30)] + [r["finish"] for r in rows if r["finish"]])
    horizon = min(horizon, rep + timedelta(days=365))

    def x(d: date):
        return L + (min(d, horizon) - rep).days / max(1, (horizon - rep).days) * (W - L - R)

    out = [f'<line x1="{x(dl):.1f}" x2="{x(dl):.1f}" y1="{T - 8}" y2="{H - 4}" '
           f'style="stroke:var(--red-600);stroke-width:1.5;stroke-dasharray:5 4"/>',
           _t(x(dl) + 6, T - 14, f"Target {day(dl)}", "var(--red-600)", "start", size=12, bold=True)]
    for j, r in enumerate(rows):
        yy = T + j * rowh + rowh / 2
        out.append(f'<line x1="{L}" x2="{W - R}" y1="{yy:.1f}" y2="{yy:.1f}" style="stroke:var(--ink-100)"/>')
        out.append(f'<rect x="{L - 16}" y="{yy - 5:.1f}" width="10" height="10" rx="2" style="fill:{r["color"]}"/>')
        out.append(_t(L - 22, yy + 5, r["short"], "var(--ink-900)", "end", size=14))
        if r["finish"] is None:
            out.append(_t(W - R + 14, yy + 5, "no recent dispatch", "var(--red-600)", size=13))
            continue
        late = r["finish"] > dl
        col = "var(--red-600)" if late else "var(--green-700)"
        beyond = r["finish"] > horizon
        cx = x(r["finish"])
        out.append(f'<line x1="{L}" x2="{cx:.1f}" y1="{yy:.1f}" y2="{yy:.1f}" style="stroke:{col};stroke-width:2"/>')
        out.append(f'<circle cx="{cx:.1f}" cy="{yy:.1f}" r="5" style="fill:{col};stroke:var(--white);stroke-width:2">'
                   f'<title>{escape(r["short"])}: clears {escape(r["finish_label"])} at {fmt(r["pace"])} MT/day</title></circle>')
        lab = r["finish_label"] + (f" · {r['late_days']:,} days late" if late else " · on time")
        out.append(_t(W - R + 14, yy + 5, lab, col, size=13, bold=beyond))
    return (f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Projected clear date per agency" '
            f'style="width:100%;height:auto;display:block">{"".join(out)}</svg>')


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

def _date_label(d: date | None) -> str:
    return f"{day(d)} {d.year}" if d else "—"


def build(hist: list[Tracker], extra_agencies: list[str] | None = None, others: dict | None = None) -> dict | None:
    """Dashboard tabs for a history (a phase view or the raw trackers). Sites that are not in the
    daily tracker (tracked=False) are listed with their final 'to date' figure and status
    'Not tracked'; they stay out of pace, balances, projections and the site lists."""
    if not hist:
        return None
    dl = _deadline()
    dates = [t.date for t in hist]
    rep, d0 = dates[-1], dates[0]
    days_left = max(1, (dl - rep).days)
    series = _series(hist)
    current = [series[_k(s)] for s in hist[-1].sites]
    keys = {_k(s): (s.key or s.site).lower() for s in hist[-1].sites}

    # ---- sites ----
    sites = []
    for ss in current:
        today, cum, bal = ss.at(rep)
        if not ss.tracked:
            sites.append({
                "key": ss.key, "agency": ss.agency, "short": agency_short(ss.agency), "site": ss.site,
                "today": today, "cum": cum, "bal": 0.0, "pct": None, "pace": 0.0, "last": None, "idle": None,
                "status": "Not tracked", "tags": [], "finish": None, "leftover": 0.0, "need": 0.0, "tracked": False,
                "sid": ss.key, "count_key": keys.get(ss.key, ss.site.lower()), "phase": ss.phase, "base": ss.base,
            })
            continue
        pace = _pace(ss.days, rep, PACE_WINDOW)
        last = ss.last_dispatch()
        idle = (rep - last).days if last else None
        fin = _finish(bal, pace, rep)
        tags = []
        if bal <= 0:
            status = "Cleared"
        elif last and idle < ACTIVE_DAYS:
            status = "Active"
        elif idle is None or idle >= STALLED_DAYS:
            status = "Stalled"
        else:
            status = "Slowing"
        if bal > 0 and bal <= QUICK_MT:
            tags.append("quick")
        leftover = max(0.0, bal - pace * days_left)
        if bal > 0 and leftover > 0:
            tags.append("long")
        sites.append({
            "key": ss.key, "agency": ss.agency, "short": agency_short(ss.agency), "site": ss.site,
            "today": today, "cum": cum, "bal": bal, "pct": _pct(cum, bal), "pace": pace,
            "last": last, "idle": idle, "status": status, "tags": tags, "finish": fin,
            "leftover": leftover, "need": bal / days_left if bal > 0 else 0.0, "tracked": True,
            "sid": ss.key, "count_key": keys.get(ss.key, ss.site.lower()), "phase": ss.phase, "base": ss.base,
        })

    # ---- agencies (fixed order: most RDF handled first; colour by fixed slot) ----
    names = sorted({s["agency"] for s in sites}, key=lambda a: -sum(x["cum"] + x["bal"] for x in sites if x["agency"] == a))
    from data.rdf_report import EXTRA_AGENCIES
    for extra in (EXTRA_AGENCIES if extra_agencies is None else extra_agencies):
        if extra.lower() not in {n.lower() for n in names}:
            names.append(extra)
    agencies = []
    for name in names:
        mine = [s for s in sites if s["agency"] == name]
        mt = [s for s in mine if s["tracked"]]
        pts = _agency_points([series[s["key"]] for s in mt])
        today = sum(s["today"] for s in mine)
        cum = sum(s["cum"] for s in mine)
        cum_t = sum(s["cum"] for s in mt)
        bal = sum(s["bal"] for s in mt)
        pace = _pace(pts, rep, PACE_WINDOW) if pts else 0.0
        # Straight line from the first day on file to 100% on the deadline.
        if pts and d0 in pts:
            c0, b0 = pts[d0][1], pts[d0][2]
            p0 = _pct(c0, b0)
            expected = p0 + (1 - p0) * min(1.0, (rep - d0).days / max(1, (dl - d0).days))
        else:
            expected = None
        fin = _finish(bal, pace, rep) if mt else None
        counts = {k: sum(1 for s in mine if s["status"] == k) for k in ("Active", "Slowing", "Stalled", "Cleared", "Not tracked")}
        agencies.append({
            "name": name, "short": agency_short(name), "color": agency_color(name, names),
            "sites": len(mine), "today": today, "cum": cum, "bal": bal, "pct": _pct(cum_t, bal),
            "expected": expected, "pace": pace, "need": bal / days_left if bal > 0 else 0.0,
            "finish": fin if bal > 0 else None, "has_sites": bool(mine), "tracked": bool(mt), "counts": counts,
            "untracked": len(mine) - len(mt),
            "quick": sum(1 for s in mine if "quick" in s["tags"]),
            "daily": {d: v[0] for d, v in pts.items()},
            "finish_label": _date_label(fin) if fin else "", "late_days": (fin - dl).days if fin and fin > dl else 0,
        })
    color = {a["name"]: a["color"] for a in agencies}
    for s in sites:
        s["color"] = color[s["agency"]]

    # ---- headline ----
    trk = [s for s in sites if s["tracked"]]
    tot_today = sum(s["today"] for s in sites)
    tot_cum = sum(s["cum"] for s in sites)
    tot_cum_t = sum(s["cum"] for s in trk)
    tot_bal = sum(s["bal"] for s in trk)
    proj_pts = _agency_points([ss for ss in current if ss.tracked])
    pace_all = _pace(proj_pts, rep, PACE_WINDOW)
    fin_all = _finish(tot_bal, pace_all, rep)
    lists = {
        "Active": [s for s in sites if s["status"] == "Active"],
        "Stalled": [s for s in sites if s["status"] == "Stalled"],
        "quick": sorted([s for s in sites if "quick" in s["tags"]], key=lambda s: s["bal"]),
        "long": sorted([s for s in sites if "long" in s["tags"]], key=lambda s: -s["leftover"]),
        "Cleared": [s for s in sites if s["status"] == "Cleared"],
        "Not tracked": [s for s in sites if not s["tracked"]],
    }

    # ---- view rows (formatted) ----
    def site_row(s):
        tags = [{"Active": ("Active", "ok"), "Slowing": ("Slowing", "warn"), "Stalled": ("Stalled", "bad"),
                 "Cleared": ("Cleared", "done"), "Not tracked": ("Not tracked", "off")}[s["status"]]]
        if "quick" in s["tags"]:
            tags.append(("Quick win", "quick"))
        if "long" in s["tags"]:
            tags.append(("Long haul", "long"))
        filters = [_slug(s["status"])] + s["tags"] + ["ag-" + _slug(s["agency"])]
        t = s["tracked"]
        return {
            "sid": s["sid"], "tracked": t, "today_raw": f"{s['today']:.2f}", "cum_raw": f"{s['cum']:.2f}",
            "bal_raw": f"{s['bal']:.2f}", "agency_full": s["agency"], "site_name": s["base"], "phase": s["phase"],
            "site_key": s["count_key"],
            "site": s["site"], "agency": s["short"], "color": s["color"], "tags": tags, "filters": " ".join(filters),
            "today": fmt(s["today"]), "today_v": s["today"], "pace_v": s["pace"],
            "cum": fmt(s["cum"]), "cum_v": s["cum"], "bal": fmt(s["bal"]) if t else "—", "bal_v": s["bal"] if t else -1,
            "pct": f"{_r(s['pct'] * 100)}%" if t else "—", "pct_v": s["pct"] if t else -1,
            "pace": fmt(s["pace"]) if t else "—",
            "last": (day(s["last"]) if s["last"] else "never") if t else "—",
            "last_v": -(s["idle"] if s["idle"] is not None else 9999) if t else -99999,
            "finish": ("not in tracker" if not t else "cleared" if s["bal"] <= 0
                       else _date_label(s["finish"]) if s["finish"] else "no pace"),
            "finish_v": (s["finish"] - rep).days if s["finish"] and t else 99999 if t else 199999,
            "late": t and (bool(s["finish"] and s["finish"] > dl) or (s["bal"] > 0 and not s["finish"])),
            "need": fmt(s["need"]),
        }

    heat_rows = []
    for a in agencies:
        for s in sorted([x for x in sites if x["agency"] == a["name"] and x["tracked"]], key=lambda x: -x["bal"]):
            ss = series[s["key"]]
            heat_rows.append({"agency": s["agency"], "site": s["site"], "color": s["color"],
                              "cells": [ss.at(d)[0] if ss.at(d) else None for d in dates]})

    ag_with = [a for a in agencies if a["has_sites"]]
    ag_trk = [a for a in ag_with if a["tracked"]]
    on_track = sum(1 for a in ag_trk if a["bal"] > 0 and a["finish"] and a["finish"] <= dl)
    return {
        "rep": rep, "rep_label": _date_label(rep), "dl_label": _date_label(dl), "days_left": days_left,
        "first_label": _date_label(d0), "n_days": len(dates),
        "dates": [d.isoformat() for d in dates],
        "kpi": {
            "today": fmt(tot_today), "need": fmt(tot_bal / days_left),
            "cum": fmt(tot_cum + (others["cum"] if others and others.get("n") else 0)), "bal": fmt(tot_bal),
            "pct": f"{_r(_pct(tot_cum_t, tot_bal) * 100)}%" if trk else "—", "pace": fmt(pace_all),
            "finish": _date_label(fin_all) if fin_all else "no recent dispatch",
            "late": not fin_all or fin_all > dl,
            "short_x": (f"{_r((tot_bal / days_left) / pace_all)}×" if pace_all > 0 else "—"),
        },
        "counts": {"active": len(lists["Active"]), "stalled": len(lists["Stalled"]), "quick": len(lists["quick"]),
                   "long": len(lists["long"]), "cleared": len(lists["Cleared"]), "sites": len(sites),
                   "untracked": len(lists["Not tracked"]), "tracked": len(trk),
                   "unique": len({s["count_key"] for s in sites}),
                   "unique_left": len({s["count_key"] for s in trk if s["bal"] > 0}),
                   "agencies_on_track": on_track, "agencies": len(ag_trk)},
        "others": {"n": others["n"], "cum": fmt(others["cum"])} if others and others.get("n") else None,
        "stack_chart": stacked_daily_chart(dates, ag_trk),
        "finish_chart": finish_chart([a for a in ag_trk if a["bal"] > 0], rep, dl),
        "heatmap": heatmap(dates, heat_rows),
        "agencies": [{
            "name": a["name"], "short": a["short"], "color": a["color"], "slug": _slug(a["name"]),
            "sites": a["sites"], "has_sites": a["has_sites"], "tracked": a["tracked"], "untracked": a["untracked"],
            "today": fmt(a["today"]), "cum": fmt(a["cum"]),
            "bal": fmt(a["bal"]) if a["tracked"] else "—", "pct": f"{_r(a['pct'] * 100)}%" if a["tracked"] else "—",
            "pct_w": f"{a['pct'] * 100:.1f}%",
            "exp_w": f"{a['expected'] * 100:.1f}%" if a["expected"] is not None else "",
            "exp": f"{_r(a['expected'] * 100)}%" if a["expected"] is not None else "—",
            "behind": a["expected"] is not None and a["pct"] + 1e-9 < a["expected"],
            "pace": fmt(a["pace"]) if a["tracked"] else "—", "need": fmt(a["need"]) if a["tracked"] else "—",
            "finish": ("not in tracker" if a["has_sites"] and not a["tracked"]
                       else "cleared" if a["has_sites"] and a["bal"] <= 0
                       else a["finish_label"] or ("no recent dispatch" if a["has_sites"] else "—")),
            "late": a["tracked"] and a["bal"] > 0 and (not a["finish"] or a["finish"] > dl),
            "counts": a["counts"], "quick": a["quick"],
        } for a in agencies],
        "sites": [site_row(s) for s in sorted(sites, key=lambda s: (names.index(s["agency"]), -s["today"], -s["bal"]))],
        "top": {
            "quick": [site_row(s) for s in lists["quick"][:5]],
            "long": [dict(site_row(s), leftover=fmt(s["leftover"])) for s in lists["long"][:5]],
            "stalled": [site_row(s) for s in sorted(lists["Stalled"], key=lambda s: -s["bal"])[:5]],
        },
    }


def _slug(s: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---------------------------------------------------------------------------
# Date range: progress per agency between two report days
# ---------------------------------------------------------------------------

def date_range(hist: list[Tracker], start: date, end: date) -> dict:
    """Disposed per agency from `start` to `end` (inclusive), via the cumulative column.

    Baseline = the last report before `start`; if there is none, `start`'s own
    figures minus its day's disposal. Sites are matched by agency + site name.
    """
    if not hist:
        return {"ok": False, "error": "No trackers on file."}
    dates = [t.date for t in hist]
    if start > end:
        start, end = end, start
    in_range = [d for d in dates if start <= d <= end]
    if not in_range:
        return {"ok": False, "error": "No report days between those dates."}
    first, last = in_range[0], in_range[-1]
    before = [d for d in dates if d < first]
    series = _series(hist)
    end_sites = [series[_k(s)] for s in hist[dates.index(last)].sites if s.tracked]

    def base_of(ss: SiteSeries):
        if before:
            _, v = ss.on_or_before(before[-1])
            if v:
                return v[1], v[2]
        v = ss.at(first)
        if v:
            return v[1] - v[0], v[2] + v[0]
        return 0.0, None

    rows: dict[str, dict] = {}
    for ss in end_sites:
        today, cum_end, bal_end = ss.at(last)
        cum0, bal0 = base_of(ss)
        moved_days = {d for d in in_range if ss.at(d) and ss.at(d)[0] > 0}
        r = rows.setdefault(ss.agency, {"name": ss.agency, "short": agency_short(ss.agency), "disposed": 0.0,
                                        "bal0": 0.0, "bal1": 0.0, "days": set(), "sites_moved": 0, "sites": 0})
        r["disposed"] += max(0.0, cum_end - cum0)
        r["bal0"] += bal0 if bal0 is not None else bal_end + max(0.0, cum_end - cum0)
        r["bal1"] += bal_end
        r["days"] |= moved_days
        r["sites"] += 1
        r["sites_moved"] += 1 if moved_days or cum_end - cum0 > 0 else 0
    base_date = before[-1] if before else None
    span = (last - base_date).days if base_date else (last - first).days + 1
    names = list(rows)
    out = []
    for name in sorted(names, key=lambda n: -rows[n]["disposed"]):
        r = rows[name]
        out.append({
            "name": name, "short": r["short"], "color": agency_color(name, names),
            "disposed": fmt(r["disposed"]), "disposed_v": r["disposed"],
            "days": len(r["days"]), "avg": fmt(r["disposed"] / max(1, span)),
            # Share of what was there at the start that went out. Uses the end balance (+ disposed)
            # because some sheets don't update the balance column every day.
            "cleared_pct": f"{_r(_pct(r['disposed'], r['bal1']) * 100)}%",
            "bal0": fmt(r["bal0"]), "bal1": fmt(r["bal1"]),
            "sites": f"{r['sites_moved']} of {r['sites']}",
        })
    total = sum(r["disposed"] for r in rows.values())
    vmax = max([r["disposed_v"] for r in out] + [1])
    for r in out:
        r["bar_w"] = f"{r['disposed_v'] / vmax * 100:.1f}%"
    return {
        "ok": True, "from_label": _date_label(first), "to_label": _date_label(last), "report_days": len(in_range),
        "span": span, "baseline": _date_label(base_date) if base_date else f"{_date_label(first)} (first day on file)",
        "rows": out, "total": fmt(total), "total_avg": fmt(total / max(1, span)),
        "total_bal0": fmt(sum(r["bal0"] for r in rows.values())), "total_bal1": fmt(sum(r["bal1"] for r in rows.values())),
        "total_days": len({d for r in rows.values() for d in r["days"]}),
        "from_iso": first.isoformat(), "to_iso": last.isoformat(),
    }
