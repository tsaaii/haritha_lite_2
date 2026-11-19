"""
View model for the RDF disposal report (templates/rdf_report/report.html).

Port of the Claude Design prototype ("RDF Disposal Report.dc.html" +
rdf-core.js). Figures come straight from the latest uploaded tracker:
    today = "RDF disposed as on Dt" column
    cum   = "Cumulative RDF disposed as on Dt" column
    bal   = "Balance RDF to be disposed from site" column
and the chart has one point per uploaded day, so it grows as days progress.
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from html import escape

from data.rdf_tracker import SiteDay, Tracker

DEADLINE = os.environ.get("RDF_DEADLINE", "2026-11-15")
PACE_DAYS = int(os.environ.get("RDF_PACE_DAYS", "3"))
RECLAIM_COUNT = int(os.environ.get("RDF_RECLAIM_COUNT", "10"))
# Agencies that get a row even before they appear in a tracker.
EXTRA_AGENCIES = [a.strip() for a in os.environ.get("RDF_EXTRA_AGENCIES", "PR Constructions").split(",") if a.strip()]

GREEN, RED, INK9, INK7, INK5, INK3 = ("var(--green-700)", "var(--red-600)", "var(--ink-900)",
                                      "var(--ink-700)", "var(--ink-500)", "var(--ink-300)")


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def fmt(n: float) -> str:
    """Indian grouping, 2 decimals: 139339.78 -> '1,39,339.78'."""
    neg, n = n < 0, abs(_r(n * 100) / 100)
    whole, frac = f"{n:.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return ("-" if neg else "") + whole + "." + frac


def _r(v: float) -> int:
    """JS Math.round (half up), not Python's banker's rounding."""
    return math.floor(v + 0.5)


def fk(v: float) -> str:
    if v >= 1000:
        return f"{v / 1000:.{0 if v >= 10000 else 1}f}k"
    return str(_r(v))


def decade(v: float) -> str:
    """Axis label for a power of ten: 1, 10, 100, 1k, 10k, 100k, 1M."""
    if v >= 1_000_000:
        return f"{v / 1_000_000:g}M"
    if v >= 1000:
        return f"{v / 1000:g}k"
    return f"{v:g}"


def day(d: date) -> str:
    return f"{d.day} {d.strftime('%b')}"


def _deadline() -> date:
    try:
        return date.fromisoformat(DEADLINE)
    except ValueError:
        return date(2026, 11, 15)


def _pct(c: float, b: float) -> float:
    return c / (c + b) if c + b > 0 else 0.0


def _pct_s(c: float, b: float) -> str:
    return f"{_r(_pct(c, b) * 100)}%"


# ---------------------------------------------------------------------------
# Series / projection
# ---------------------------------------------------------------------------

@dataclass
class Point:
    d: date
    today: float
    cum: float
    bal: float


def _sum(sites, k: str) -> float:
    return sum(getattr(s, k) for s in sites)


def _proj(pts: list[Point], dl: date, n: int) -> dict:
    last = pts[-1]
    win = pts[-max(1, n):]
    pace = sum(p.today for p in win) / len(win)
    days_left = max(0, (dl - last.d).days)
    clear_days = last.bal / pace if pace > 0 else math.inf
    return {
        "pace": pace, "win": len(win),
        "proj_bal": max(0.0, last.bal - pace * days_left),
        "clear_date": last.d + timedelta(days=math.ceil(clear_days)) if math.isfinite(clear_days) else None,
        "clears_in_time": clear_days <= days_left,
    }


# ---------------------------------------------------------------------------
# Chart — same geometry and marks as chartEl() in the prototype
# ---------------------------------------------------------------------------

def _nice(v: float) -> float:
    if v <= 0:
        return 1
    p = 10 ** math.floor(math.log10(v))
    return math.ceil(v / p * 2) / 2 * p


def _step(v: float) -> float:
    """Smallest 1-2-2.5-5 x 10^n at or above v (axis tick spacing)."""
    if v <= 0:
        return 1
    p = 10 ** math.floor(math.log10(v))
    return next(m * p for m in (1, 2, 2.5, 5, 10) if m * p >= v)


CHART_W, CHART_H = 640, 280


def chart_marks(pts: list[Point], dl: date) -> list[tuple]:
    """Chart as drawing primitives, top-left origin, in a 640x280 box.

    ("line", x1, y1, x2, y2, stroke)
    ("path", [(x, y), ...], stroke, width, dash)   dash "" or "6 4"
    ("dot", cx, cy, r, fill, ring)
    ("text", x, y, s, fill, anchor, bold)          y is the baseline, 11px
    Colours are CSS vars (var(--green-700)); rdf_report_pdf maps them to hex.
    """
    if not pts:
        return []
    W, H, L, R, T, B = CHART_W, CHART_H, 54, 58, 22, 34
    n = len(pts)
    slot = (W - L - R) / n

    def x(i):
        return L + slot * (i + 0.5)

    def req(p):
        return p.bal / max(1, (dl - p.d).days)

    # Left axis (MT a day: disposed and needed) is logarithmic, so small daily figures stay readable;
    # gridlines at powers of ten, and a 0 (a day with no dispatch) sits on the bottom line.
    # Right axis (MT left) stays linear from 0, with its ticks on the same gridlines.
    per_day = [v for p in pts for v in (p.today, req(p)) if v > 0] or [1.0]
    lo_e = math.floor(math.log10(max(min(per_day), 1)))
    hi_e = max(lo_e + 1, math.ceil(math.log10(max(per_day) * 1.1)))
    span = hi_e - lo_e
    m2 = _step(max(max(p.bal for p in pts), 1) * 1.05 / span) * span

    def y1(v):
        e = math.log10(v) if v > 0 else lo_e
        return T + (1 - (min(max(e, lo_e), hi_e) - lo_e) / span) * (H - T - B)

    def y2(v):
        return T + (1 - v / m2) * (H - T - B)

    out: list[tuple] = []

    def txt(xx, yy, s, fill, anchor="middle", bold=False):
        out.append(("text", xx, yy, s, fill, anchor, bold))

    def path(vals, stroke, width, dash=""):
        out.append(("path", [(x(i), v) for i, v in enumerate(vals)], stroke, width, dash))

    def dots(vals, fill, r, ring=True):
        out.extend(("dot", x(i), v, r, fill, ring) for i, v in enumerate(vals))

    for e in range(lo_e, hi_e + 1):
        yy = y1(10 ** e)
        out.append(("line", L, yy, W - R, yy, "var(--ink-100)"))
        txt(L - 6, yy + 4, decade(10 ** e), GREEN, "end")
        txt(W - R + 6, yy + 4, fk(m2 * (e - lo_e) / span), INK5, "start")
    txt(2, T - 8, "MT disposed (log scale)", GREEN, "start")
    txt(W - R + 6, T - 8, "MT left", INK5, "start")

    step = max(1, math.ceil(n / 7))
    for i, p in enumerate(pts):
        if (n - 1 - i) % step == 0:
            last = i == n - 1
            txt(x(i), H - 12, day(p.d), INK9 if last else INK5, bold=last)

    reqs = [y1(req(p)) for p in pts]
    path(reqs, "var(--red-600)", 2, "6 4")
    dots(reqs, "var(--red-600)", 3, ring=False)

    tv = [y1(p.today) for p in pts]
    path(tv, "var(--green-600)", 2.5)
    dots(tv, "var(--green-600)", 3.5)
    bv = [y2(p.bal) for p in pts]
    path(bv, INK7, 2.5)
    dots(bv, INK7, 3.5)

    # End-of-line labels. Each sits just above its line, clear of the line's last ~110px; when the
    # red and black lines end close together the lower one's label goes under its line instead,
    # and the green figure moves under its line if it would sit on another label.
    lp, top, bottom = pts[-1], T + 4, H - B - 3

    def above(vals, width=110):
        return min(v for i, v in enumerate(vals) if x(i) >= x(n - 1) - width) - 7

    def below(vals, width=110):
        return max(v for i, v in enumerate(vals) if x(i) >= x(n - 1) - width) + 15

    ry, by = reqs[-1], bv[-1]
    near = abs(ry - by) < 30
    red_y = below(reqs) if near and ry >= by else above(reqs)
    blk_y = below(bv) if near and ry < by else above(bv)
    grn_y = above(tv, 24)
    if any(abs(grn_y - o) < 13 for o in (red_y, blk_y)):
        grn_y = below(tv, 24)
    clamp = lambda v: min(max(v, top), bottom)   # noqa: E731
    txt(x(n - 1), clamp(red_y), fk(req(lp)) + " needed/day", "var(--red-600)", "end", bold=True)
    txt(x(n - 1) - 8, clamp(blk_y), fk(lp.bal) + " left", INK9, "end", bold=True)
    txt(x(n - 1), clamp(grn_y), fk(lp.today), GREEN, bold=True)
    return out


def chart_svg(pts: list[Point], dl: date) -> str:
    out = []
    for m in chart_marks(pts, dl):
        if m[0] == "line":
            _, x1, y1, x2, y2, st = m
            out.append(f'<line x1="{x1}" x2="{x2}" y1="{y1:.1f}" y2="{y2:.1f}" style="stroke:{st}"/>')
        elif m[0] == "path":
            _, xy, st, w, dash = m
            d = " ".join(f"{'L' if i else 'M'}{a:.1f},{b:.1f}" for i, (a, b) in enumerate(xy))
            out.append(f'<path d="{d}" style="fill:none;stroke:{st};stroke-width:{w};'
                       f'stroke-linejoin:round;{"stroke-dasharray:" + dash + ";" if dash else ""}"/>')
        elif m[0] == "dot":
            _, cx, cy, r, fill, ring = m
            out.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" style="fill:{fill};'
                       f'{"stroke:var(--white);stroke-width:1.2;" if ring else ""}"/>')
        else:
            _, tx, ty, s, fill, anchor, bold = m
            out.append(f'<text x="{tx:.1f}" y="{ty:.1f}" text-anchor="{anchor}" '
                       f'style="font-size:11px;font-family:var(--font-serif);fill:{fill};'
                       f'{"font-weight:700;" if bold else ""}">{escape(s)}</text>')
    if not out:
        return ""
    return (f'<svg viewBox="0 0 {CHART_W} {CHART_H}" role="img" aria-label="Disposed so far, all agencies" '
            f'style="width:100%;height:auto;display:block">{"".join(out)}</svg>')


# ---------------------------------------------------------------------------
# WhatsApp gist — "1. Tharuni sent RDF from Kadapa and Srikakulam sites."
# ---------------------------------------------------------------------------

# Short names people use in messages. Anything not listed drops a trailing company word.
AGENCY_SHORT = {
    "tharuni associates": "Tharuni", "saurashtra enviro": "Saurashtra", "zigma global": "Zigma",
    "coastline projects": "Coastline", "iway associates": "Iway", "card box company": "Card Box",
    "raghu ram hume pipes": "Raghu Ram", "pr constructions": "PR Constructions", "avinash agencies": "Avinash",
}
_SUFFIX = re.compile(r"\s+(associates|enviro|global|projects|company|constructions|pvt\.?|ltd\.?|"
                     r"private|limited|hume pipes|infra|enterprises)\b.*$", re.I)


def agency_short(name: str) -> str:
    key = re.sub(r"\s+", " ", name or "").strip()
    return AGENCY_SHORT.get(key.lower()) or (_SUFFIX.sub("", key) or key)


def site_short(name: str) -> str:
    """Town name for messages: 'Kurnool 3.0 (Package 4)' -> 'Kurnool', 'Tirupati #26' -> 'Tirupati',
    'Nellore(Donthali)-Phase-1' -> 'Nellore', 'Proddatur - Site2 (Small)' -> 'Proddatur'."""
    s = re.sub(r"#\d+", " ", name or "")
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.split(r"\s+-\s+", s)[0]
    s = re.sub(r"[-\s]*phase[-\s]*\d+", " ", s, flags=re.I)
    s = re.sub(r"\b\d+(\.\d+)?\s*%?", " ", s)
    s = re.sub(r"\s+", " ", s).strip(" -,")
    return s or (name or "").strip()


def _join(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def gist(t: Tracker) -> str:
    """Agencies that disposed RDF on the report day, alphabetical; their sites alphabetical."""
    sent: dict[str, dict[str, str]] = {}
    for s in t.sites:
        if s.today > 0:
            sites = sent.setdefault(agency_short(s.agency), {})
            town = site_short(s.src or s.site)
            sites.setdefault(town.lower(), town)
    if not sent:
        return f"No agency sent RDF on {day(t.date)}."
    lines = []
    for i, ag in enumerate(sorted(sent, key=str.lower), 1):
        towns = sorted(sent[ag].values(), key=str.lower)
        lines.append(f"{i}. {ag} sent RDF from {_join(towns)} site{'s' if len(towns) > 1 else ''}.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def _tracked(sites):
    return [s for s in sites if s.tracked]


def _pct_t(sites) -> str:
    """Done % over the sites the daily tracker reports (others have no balance)."""
    t = _tracked(sites)
    return _pct_s(_sum(t, "cum"), _sum(t, "bal")) if t else "—"


def unique_sites(sites) -> int:
    return len({(s.key or s.site).lower() for s in sites})


def build(hist: list[Tracker], phase_label: str = "", extra_agencies: list[str] | None = None,
          gist_tracker: Tracker | None = None, others: dict | None = None) -> dict | None:
    """Report for a history (a phase view from data/rdf_master.py, or the raw trackers).

    `others` = {"n": sites, "cum": MT}: RDF already disposed at the phase's sites that are not in the
    daily upload. Those sites are not listed; their total is added to "Disposed to date" and shown
    as one "Other sites" line under By agency, so the agency rows still add up.
    """
    others = others if others and others.get("n") else None
    if not hist:
        return None
    dl = _deadline()
    rep_t = hist[-1]
    rep, S = rep_t.date, list(rep_t.sites)
    days = max(1, (dl - rep).days)
    extras = EXTRA_AGENCIES if extra_agencies is None else extra_agencies

    T = _tracked(S)
    today, cum, bal = _sum(S, "today"), _sum(S, "cum"), _sum(T, "bal")
    need = bal / days
    on_pace = today >= need
    if not T:
        verdict, status_color = "No site in this phase is in the daily upload; Disposed to date is its final figure.", INK5
    elif on_pace:
        verdict, status_color = f"On pace for {day(dl)}.", GREEN
    elif today > 0:
        verdict, status_color = f"About {_r(need / today)}× short of the daily need.", INK9
    else:
        verdict, status_color = "Nothing disposed today.", RED

    ag: dict[str, list[SiteDay]] = {}
    lower = {s.agency.lower() for s in S}
    for name in extras:
        if name.lower() not in lower:
            ag[name] = []
    for s in S:
        ag.setdefault(s.agency, []).append(s)
    ag_list = [{"name": k, "sites": v, "today": _sum(v, "today"), "cum": _sum(v, "cum"), "bal": _sum(_tracked(v), "bal"),
                "tracked": bool(_tracked(v))} for k, v in ag.items()]
    ag_list.sort(key=lambda a: (-(len(a["sites"]) > 0), -a["today"], -a["bal"]))

    def status(a):
        if not a["sites"]:
            return "No sites yet", INK5
        if a["bal"] <= 0:
            return "Cleared", GREEN
        if a["today"] >= a["bal"] / days:
            return "On pace", GREEN
        if a["today"] > 0:
            return "Behind", INK9
        return "Nothing today", RED

    ag_rows = []
    for a in ag_list:
        st, col = status(a)
        ag_rows.append({
            "name": a["name"], "status": st, "status_color": col,
            "today": fmt(a["today"]), "today_color": GREEN if a["today"] > 0 else RED,
            "need": fmt(a["bal"] / days) if a["tracked"] else "—",
            "cum": fmt(a["cum"]), "bal": fmt(a["bal"]) if a["tracked"] else "—", "pct": _pct_t(a["sites"]),
        })

    if others:
        ag_rows.append({"name": f"Other sites ({others['n']})", "status": "earlier work, final figure", "status_color": INK5,
                        "today": fmt(0), "today_color": INK3, "need": "—", "cum": fmt(others["cum"]), "bal": "—", "pct": "—",
                        "other": True})

    def site_row(s: SiteDay) -> dict:
        moved = s.today > 0
        return {"site": s.site, "agency": s.agency, "today": fmt(s.today),
                "today_color": GREEN if moved else INK3, "today_weight": 700 if moved else 400,
                "cum": fmt(s.cum), "bal": fmt(s.bal) if s.tracked else "—",
                "pct": _pct_s(s.cum, s.bal) if s.tracked else "—"}

    least = sorted((s for s in T if s.bal > 0), key=lambda s: s.bal)[:RECLAIM_COUNT]
    least_rows = [dict(site_row(s), rank=i + 1) for i, s in enumerate(least)]

    groups = []
    for a in ag_list:
        if not a["sites"]:
            continue
        cnt = len(a["sites"])
        groups.append({
            "name": a["name"], "count": f"{cnt} site{'' if cnt == 1 else 's'}",
            "today": fmt(a["today"]), "today_color": GREEN if a["today"] > 0 else RED,
            "cum": fmt(a["cum"]), "bal": fmt(a["bal"]) if a["tracked"] else "—", "pct": _pct_t(a["sites"]),
            "sites": [site_row(s) for s in sorted(a["sites"], key=lambda s: (-s.today, -s.cum))],
        })

    series = [Point(t.date, _sum(t.sites, "today"), _sum(t.sites, "cum"), _sum(_tracked(t.sites), "bal")) for t in hist]
    P = _proj(series, dl, PACE_DAYS)
    if P["pace"] <= 0:
        proj_text = f"Nothing disposed recently; at this pace nothing clears by {day(dl)}."
    else:
        tail = (f"everything clears by {day(P['clear_date'])}." if P["clears_in_time"]
                else f"{fmt(P['proj_bal'])} MT will still be left on {day(dl)}.")
        proj_text = f"At {fmt(P['pace'])} MT a day (last {P['win']} days), {tail}"

    return {
        "rep_label": f"{day(rep)} {rep.year}", "rep_day": day(rep),
        "deadline_label": f"{day(dl)} {dl.year}", "deadline_short": day(dl),
        "days_label": f"{days} days to go",
        "range_label": f"{day(series[0].d)} to {day(rep)}",
        "k": {"today": fmt(today), "need": fmt(need), "cum": fmt(cum + (others["cum"] if others else 0)), "bal": fmt(bal),
              "pct": _pct_t(S), "sites": unique_sites(S), "verdict": verdict, "status_color": status_color},
        "phase_label": phase_label,
        "others": {"n": others["n"], "cum": fmt(others["cum"])} if others else None,
        "chart": chart_svg(series, dl), "chart_marks": chart_marks(series, dl), "proj_text": proj_text,
        "rep_iso": rep.isoformat(), "sheet_date": rep_t.sheet_date, "gist": gist(gist_tracker or rep_t),
        "ag_rows": ag_rows, "least": least_rows, "groups": groups,
    }
