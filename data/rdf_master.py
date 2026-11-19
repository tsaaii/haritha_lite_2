"""
The RDF "true copy": one master row per site per phase, built from two sources.

    data/rdf_master/phase_sheet.csv    every site of every phase (Old, Phase 1, Phase 1 - 15% Excess,
                                       Phase 2, Phase 3) with target and RDF disposed so far. Shipped with
                                       the code; a newer copy uploaded from the gear panel is kept at
                                       RDF_TRACKER_DIR/master/phase_sheet.csv and wins.
    the daily RDF tracker              (data/rdf_tracker.py) live figures for the sites it lists.

Rules (agreed with the user, Nov 2026):
  * The daily tracker takes precedence. A tracker row is matched to its phase-sheet row by the
    awarded quantity ("Total Qty awarded to ULB" = phase sheet target_mt, within 1 MT); ties are
    broken by agency, then by site name. Rows the data can't settle are decided in OVERRIDES.
  * Phase-sheet rows that no tracker row matches are "not tracked": cumulative = the sheet's
    rdf_disposed_mt (final), disposed today = 0, balance not tracked (left out of Left and Done %).
  * Phases are never added together site by site; the All phases view lists every row and its
    totals are the sum over phases.
  * Coastline Projects before Phase 3 is Tharuni Associates.
  * Sites count = unique sites (dumpsites): spelling variants merge (SITE_ALIASES), Gudur(N)/(K)
    and Atmakur(N)/(K) stay separate, every Donthali row is Nellore Donthali.
  * Quick edits (dashboard pencil) live in RDF_TRACKER_DIR/master/edits.json, newest last.
    Figures (today / to date / left) change the latest report day only, and a later upload of that
    day's sheet wins. Agency, phase and site name apply to every day. Each edit can be undone.

The views (`view(hist, phase)`) are lists of Trackers whose SiteDays carry the master fields
(sid, phase, tracked, key), so the report, dashboard and PDF code work on any phase unchanged.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import secrets
import threading
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone

from data import rdf_tracker
from data.rdf_tracker import SiteDay, Tracker

logger = logging.getLogger(__name__)

SHEET_PATH = os.environ.get("RDF_PHASE_SHEET") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "rdf_master", "phase_sheet.csv")
_UP_SHEET = "master/phase_sheet.csv"
_EDITS = "master/edits.json"
_SNAPSHOT = "master/master.csv"

# Phase codes, newest first (the order of the tabs). "un" = tracker rows with no phase yet.
PHASES = [("all", "All phases"), ("p3", "Phase 3"), ("p2", "Phase 2"), ("p1x", "Phase 1 – 15%"),
          ("p1", "Phase 1"), ("old", "Old")]
PHASE_LABEL = dict(PHASES) | {"un": "Needs a phase"}
PHASE_SHORT = {"p3": "P3", "p2": "P2", "p1x": "P1 15%", "p1": "P1", "old": "Old", "un": "?"}
PHASE_ORDER = ["p3", "p2", "p1x", "p1", "old", "un"]
SHEET_PHASE = {"phase 3 - current": "p3", "phase 3": "p3", "phase 2": "p2", "phase 1 - 15% excess": "p1x",
               "phase 1 - 15%": "p1x", "phase 1": "p1", "old": "old"}
EDIT_FIELDS = ("today", "cum", "bal", "agency", "phase", "site")
VALUE_FIELDS = ("today", "cum", "bal")

AGENCY = {"saurashta enviro": "Saurashtra Enviro", "saurashtra enviro": "Saurashtra Enviro",
          "tharuni associates": "Tharuni Associates", "zigma global": "Zigma Global",
          "iway associates": "Iway Associates", "coastline projects": "Coastline Projects",
          "raghu ram hume pipes": "Raghu Ram Hume Pipes", "card box company": "Card Box Company",
          "pr constructions": "PR Constructions", "avinash agencies": "Avinash Agencies"}

# Site (dumpsite) names. Keys are lower-case location / tracker names.
SITE_ALIASES = {
    "anantapur": "Ananthapur", "ananthapur": "Ananthapur", "gunthakal": "Guntakal", "guntakal": "Guntakal",
    "jaggaiahpeta": "Jaggaiahpet", "jaggaiahpet": "Jaggaiahpet", "nidadavolu": "Nidadavole",
    "nidadavole": "Nidadavole", "ponnur": "Ponnuru", "ponnuru": "Ponnuru", "palasa": "Palasa-Kasibugga",
    "palasa-kasibugga": "Palasa-Kasibugga", "yemmignur": "Yemmiganur", "yemmiganur": "Yemmiganur",
    "proddatur1": "Proddaturu1", "proddatur2": "Proddaturu2", "proddatur": "Proddaturu", "proddaturu": "Proddaturu",
    "gargeyapuram": "Kurnool Gargeyapuram", "joharapuram": "Kurnool Joharapuram", "donthali": "Nellore Donthali",
    "allipuram": "Nellore Allipuram", "atmakur (k)": "Atmakur(K)", "atmakur(k)": "Atmakur(K)",
    "palakollu": "Palacole2", "gudur": "Gudur(N)",
}


def agency_name(s: str) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return AGENCY.get(s.lower(), s)


def _base(site: str) -> str:
    """Tracker site name without the '#<Sl.No>' the parser adds to repeated names."""
    return re.sub(r"\s*#\d+$", "", site or "").strip()


def site_name(s: str) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return SITE_ALIASES.get(s.lower(), s)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def _num(s) -> float | None:
    s = str(s or "").replace(",", "").strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Phase sheet
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SheetRow:
    rid: str          # stable id: agency-location-target
    phase: str        # phase code
    agency: str       # agency as the user wants it shown (Coastline rule applied)
    location: str
    town: str
    target: float
    rdf: float | None
    site: str         # display / count name


class SheetError(ValueError):
    pass


_REQUIRED = ("location", "site_name", "phase", "agency_name", "target_mt", "rdf_disposed_mt")


def parse_sheet(raw: bytes) -> list[SheetRow]:
    text = raw.decode("utf-8-sig", errors="replace")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or any(c not in (rows[0].keys()) for c in _REQUIRED):
        raise SheetError("This isn't the phase sheet: it needs the columns " + ", ".join(_REQUIRED) + ".")
    out, seen = [], {}
    for r in rows:
        phase = SHEET_PHASE.get(re.sub(r"\s+", " ", r["phase"] or "").strip().lower())
        loc = re.sub(r"\s+", " ", r["location"] or "").strip()
        if not phase or not loc:
            continue
        ag = _rule_agency(agency_name(r["agency_name"]), phase)
        target = _num(r["target_mt"]) or 0.0
        rid = f"{_slug(agency_name(r['agency_name']))}-{_slug(loc)}-{int(round(target))}"
        seen[rid] = seen.get(rid, 0) + 1
        if seen[rid] > 1:
            rid += f"-{seen[rid]}"
        out.append(SheetRow(rid, phase, ag, loc, (r["site_name"] or "").strip() or loc, target,
                            _num(r["rdf_disposed_mt"]), site_name(loc)))
    if not out:
        raise SheetError("No rows with a known phase (Old, Phase 1, Phase 1 - 15% Excess, Phase 2, Phase 3).")
    return out


def _rule_agency(agency: str, phase: str) -> str:
    """Coastline Projects before Phase 3 is Tharuni Associates (user, 19 Nov 2026)."""
    if agency == "Coastline Projects" and phase != "p3":
        return "Tharuni Associates"
    return agency


_sheet_cache: dict[str, tuple[bytes, list[SheetRow]]] = {}
_sheet_lock = threading.Lock()


def sheet_raw() -> tuple[bytes, str]:
    """(bytes, where) of the phase sheet in force: the uploaded one, else the shipped one."""
    try:
        up = rdf_tracker.read_file(_UP_SHEET)
    except Exception:
        logger.exception("rdf_master: could not read the uploaded phase sheet; using the built-in one")
        up = None
    if up:
        return up, "uploaded"
    with open(SHEET_PATH, "rb") as f:
        return f.read(), "built-in"


def sheet() -> list[SheetRow]:
    raw, _ = sheet_raw()
    with _sheet_lock:
        hit = _sheet_cache.get("s")
        if hit and hit[0] == raw:
            return hit[1]
    rows = parse_sheet(raw)
    with _sheet_lock:
        _sheet_cache["s"] = (raw, rows)
    return rows


def store_sheet(raw: bytes) -> int:
    rows = parse_sheet(raw)
    rdf_tracker.write_file(_UP_SHEET, raw)
    return len(rows)


# ---------------------------------------------------------------------------
# Matching tracker rows to the phase sheet
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Spec:
    phase: str
    find: tuple[str, str, str] | None = None   # (sheet phase, sheet agency, location prefix); None = tracker-only
    agency: str | None = None
    site: str | None = None       # display name override
    key: str | None = None        # count key override
    split: bool = False           # share the tracker figures by sheet target


# (tracker site name, awarded) -> where it goes. Decided with the user, 19 Nov 2026.
OVERRIDES: dict[tuple[str, float], list[Spec]] = {
    ("gudivada", 40000): [Spec("p2", ("p2", "Coastline Projects", "gudivada"))],
    ("machilipatnam", 69077): [Spec("p1", ("p1", "Tharuni Associates", "machilipatnam"), split=True),
                               Spec("p1x", ("p1x", "Tharuni Associates", "machilipatnam"), split=True)],
    ("gudivada", 42953): [Spec("p1", ("p1", "Tharuni Associates", "gudivada"))],
    ("eluru", 53348): [Spec("p1", ("p1", "Tharuni Associates", "eluru"))],
    ("pedana", 46410.41): [Spec("p3", ("p3", "Avinash Agencies", "pedana"), agency="Avinash Agencies")],
    ("kuppam", 15000): [Spec("p3", ("p3", "Raghu Ram Hume Pipes", "kuppam"))],
    ("dhone", 50000): [Spec("p1", ("p1", "Saurashtra Enviro", "dhone"))],
    ("adoni", 10000): [Spec("p1", ("p1", "Saurashtra Enviro", "adoni"))],
    ("palakollu", 35000): [Spec("p3", ("p3", "Iway Associates", "palacole2"))],
    ("kurnool 15% (yemmigunur)", 25700): [Spec("p1x", ("p1x", "Saurashtra Enviro", "yemmiganur"),
                                               site="Yemmiganur 15%", key="Yemmiganur")],
    ("dharmavaram 15%", 11325): [Spec("p1x", ("p1x", "Tharuni Associates", "dharmavaram"))],
    ("salur", 16301.49): [Spec("p3", None, agency="Tharuni Associates")],
    ("kadapa", 34999.74): [Spec("p3", None, agency="Tharuni Associates")],
    ("donthali", 63268): [Spec("p3", ("p3", "PR Constructions", "donthali"), agency="PR Constructions")],
}
# Left out of every view, every day (user, 19 Nov 2026).
EXCLUDE: set[tuple[str, float]] = {("nandyal 15 % (allagadda, nandikotkur)", 21524)}


@dataclass(frozen=True)
class Place:
    sid: str
    phase: str
    agency: str
    site: str
    key: str
    share: float
    rid: str | None      # matched phase-sheet row


def _find(rows: list[SheetRow], phase: str, agency: str, loc: str) -> SheetRow | None:
    c = [r for r in rows if r.phase == phase and r.location.lower().startswith(loc)
         and (r.agency == agency or agency_name(agency) == r.agency or _rule_agency(agency, phase) == r.agency)]
    return c[0] if len(c) == 1 else None


def place(rows: list[SheetRow], agency: str, site: str, awarded: float) -> list[Place]:
    """Where one tracker row goes. [] = excluded; phase 'un' = could not be placed."""
    base = _base(site)
    if any(k == base.lower() and abs(a - awarded) < 0.01 for k, a in EXCLUDE):
        return []
    ag = agency_name(agency)
    tkey = f"t:{_slug(ag)}-{_slug(base)}-{int(round(awarded))}"
    specs = None
    for (k, a), v in OVERRIDES.items():
        if k == base.lower() and abs(a - awarded) < 0.01:
            specs = v
            break
    if specs:
        found = [(sp, _find(rows, *sp.find) if sp.find else None) for sp in specs]
        tot = sum(r.target for sp, r in found if sp.split and r) or 1.0
        out = []
        for sp, r in found:
            ph = sp.phase
            a = _rule_agency(sp.agency or (r.agency if r else ag), ph)
            nm = sp.site or (r.site if r else site_name(re.sub(r"\s+\d+(\.\d+)?$", "", base)))
            out.append(Place(f"{ph}:{r.rid if r else tkey}", ph, a, nm, sp.key or (r.site if r else nm),
                             (r.target / tot) if sp.split and r else 1.0, r.rid if r else None))
        return out
    cand = [r for r in rows if abs(r.target - awarded) < 1.0]
    if len(cand) > 1:
        cand = [r for r in cand if r.agency == _rule_agency(ag, r.phase) or agency_name(r.agency) == ag] or cand
    if len(cand) > 1:
        pre = base.lower()[:4]
        cand = [r for r in cand if r.location.lower().startswith(pre) or r.town.lower().startswith(pre)] or cand
    if len(cand) == 1:
        r = cand[0]
        return [Place(f"{r.phase}:{r.rid}", r.phase, _rule_agency(ag, r.phase), r.site, r.site, 1.0, r.rid)]
    nm = site_name(re.sub(r"\s+\d+(\.\d+)?$", "", base))
    return [Place(f"un:{tkey}", "un", ag, nm, nm, 1.0, None)]


# ---------------------------------------------------------------------------
# Edits (quick edit in the dashboard)
# ---------------------------------------------------------------------------

_edits_lock = threading.Lock()


def edits() -> list[dict]:
    try:
        raw = rdf_tracker.read_file(_EDITS)
    except Exception:
        logger.exception("rdf_master: could not read edits")
        return []
    if not raw:
        return []
    try:
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, list) else []
    except ValueError:
        logger.warning("rdf_master: edits.json is not valid JSON; ignoring it")
        return []


def _save_edits(items: list[dict]) -> None:
    rdf_tracker.write_file(_EDITS, json.dumps(items, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")


class EditError(ValueError):
    pass


def add_edits(sid: str, changes: dict, day: date | None, ip: str, current: dict) -> list[dict]:
    """Record field changes for one master row. `current` = the row's shown values (for 'old')."""
    if not sid:
        raise EditError("Which site?")
    made = []
    now = datetime.now(timezone.utc).isoformat()
    for f, v in changes.items():
        if f not in EDIT_FIELDS:
            raise EditError(f"{f} can't be edited.")
        if f in VALUE_FIELDS and not current.get("tracked", True) and f != "cum":
            raise EditError("This site isn't in the daily tracker: only its 'To date' figure can be edited.")
        if f in VALUE_FIELDS:
            try:
                v = round(float(str(v).replace(",", "")), 2)
            except ValueError:
                raise EditError(f"{ {'today': 'Today', 'cum': 'To date', 'bal': 'Left'}[f] } must be a number.")
            if v < 0 or v > 10_000_000:
                raise EditError("Figures must be between 0 and 1,00,00,000 MT.")
        elif f == "phase":
            if v not in PHASE_ORDER or v == "un":
                raise EditError("Pick a phase.")
        else:
            v = re.sub(r"\s+", " ", str(v or "")).strip()[:80]
            if not v:
                raise EditError("Name can't be empty.")
        if str(current.get(f, "")) == str(v):
            continue
        made.append({"id": secrets.token_hex(4), "at": now, "ip": ip[:45], "sid": sid, "field": f,
                     "old": current.get(f, ""), "new": v,
                     "day": day.isoformat() if f in VALUE_FIELDS and day and current.get("tracked", True) else None,
                     "undone": False})
    if made:
        with _edits_lock:
            items = edits() + made
            _save_edits(items[-2000:])
    return made


def undo_edit(edit_id: str) -> dict:
    with _edits_lock:
        items = edits()
        for e in items:
            if e.get("id") == edit_id and not e.get("undone"):
                e["undone"] = True
                _save_edits(items)
                return e
    raise EditError("That edit is already undone or no longer on file.")


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

def _apply_identity(sid: str, phase: str, agency: str, site: str, key: str, idx: dict) -> tuple[str, str, str, str]:
    e = idx.get(sid, {})
    if "phase" in e:
        phase = e["phase"]
    if "agency" in e:
        agency = e["agency"]
    if "site" in e:
        site = key = e["site"]
    return phase, agency, site, key


def _edit_index(items: list[dict]):
    """identity[sid][field] = value; values[(sid, day or None)][field] = (value, at). Latest wins."""
    ident: dict[str, dict] = {}
    vals: dict[tuple[str, str | None], dict] = {}
    for e in items:
        if e.get("undone") or e.get("field") not in EDIT_FIELDS:
            continue
        if e["field"] in VALUE_FIELDS:
            vals.setdefault((e["sid"], e.get("day")), {})[e["field"]] = (float(e["new"]), e["at"])
        else:
            ident.setdefault(e["sid"], {})[e["field"]] = e["new"]
    return ident, vals


def _parse_at(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)


@dataclass
class Book:
    """Everything a view needs, built once per request."""
    rows: list[SheetRow]
    places: dict[tuple[str, str, float], list[Place]]
    tracked_rids: set[str]
    ident: dict
    vals: dict
    uploads: dict


def book(hist: list[Tracker], uploads: dict | None = None, items: list[dict] | None = None) -> Book:
    rows = sheet()
    places: dict[tuple[str, str, float], list[Place]] = {}
    tracked: set[str] = set()
    for t in hist:
        for s in t.sites:
            k = (s.agency, s.site, s.awarded)
            if k not in places:
                places[k] = place(rows, s.agency, s.site, s.awarded)
            tracked |= {p.rid for p in places[k] if p.rid}
    ident, vals = _edit_index(items if items is not None else edits())
    if uploads is None:
        try:
            uploads = rdf_tracker.uploaded_at()
        except Exception:
            logger.exception("rdf_master: could not list upload times")
            uploads = {}
    return Book(rows, places, tracked, ident, vals, uploads)


def _value_edit(b: Book, sid: str, d: date | None, tracked: bool) -> dict:
    """Value edits for one row on one day. Tracked rows: that day's edits, unless the day's sheet was
    uploaded after the edit. Not-tracked rows: edits with no day, every day."""
    if not tracked:
        return {f: v for f, (v, _) in b.vals.get((sid, None), {}).items()}
    e = b.vals.get((sid, d.isoformat() if d else None), {})
    up = b.uploads.get(d)
    return {f: v for f, (v, at) in e.items() if up is None or _parse_at(at) >= up}


def rows_for_day(b: Book, t: Tracker) -> list[SiteDay]:
    """Every master row on one report day (all phases)."""
    out: list[SiteDay] = []
    for s in t.sites:
        for p in b.places.get((s.agency, s.site, s.awarded), []):
            ph, ag, nm, key = _apply_identity(p.sid, p.phase, p.agency, p.site, p.key, b.ident)
            v = _value_edit(b, p.sid, t.date, True)
            out.append(SiteDay(ag, nm, v.get("today", round(s.today * p.share, 2)), v.get("cum", round(s.cum * p.share, 2)),
                               v.get("bal", round(s.bal * p.share, 2)), awarded=round(s.awarded * p.share, 2),
                               sid=p.sid, phase=ph, tracked=True, src=_base(s.site), key=key))
    for r in b.rows:
        if r.rid in b.tracked_rids:
            continue
        sid = f"{r.phase}:{r.rid}"
        ph, ag, nm, key = _apply_identity(sid, r.phase, r.agency, r.site, r.site, b.ident)
        v = _value_edit(b, sid, None, False)
        out.append(SiteDay(ag, nm, v.get("today", 0.0), v.get("cum", r.rdf or 0.0), v.get("bal", 0.0),
                           awarded=r.target, sid=sid, phase=ph, tracked=False, src=r.town, key=key))
    return out


def _names(days: list[list[SiteDay]], phase: str) -> dict[str, str]:
    """Display name per sid in a view: the All view adds the phase; repeats in a phase get (2), (3)."""
    first: dict[str, SiteDay] = {}
    for rows in days:
        for s in rows:
            first.setdefault(s.sid, s)
    out, groups = {}, {}
    for sid, s in sorted(first.items(), key=lambda kv: (-kv[1].awarded, kv[0])):
        base = s.site + (f" · {PHASE_SHORT.get(s.phase, s.phase)}" if phase == "all" else "")
        g = (s.agency, base)
        groups[g] = groups.get(g, 0) + 1
        out[sid] = base if groups[g] == 1 else f"{base} ({groups[g]})"
    return out


def view(hist: list[Tracker], phase: str = "all", b: Book | None = None) -> list[Tracker]:
    """The history as seen from one phase ('all' = every phase). Same shape as rdf_tracker.history()."""
    b = b or book(hist)
    days = [[s for s in rows_for_day(b, t) if phase == "all" or s.phase == phase] for t in hist]
    names = _names(days, phase)
    return [Tracker(t.date, tuple(replace(s, site=names[s.sid], base=s.site) for s in rows), t.sheet_date)
            for t, rows in zip(hist, days)]


def phase_counts(hist: list[Tracker], b: Book | None = None) -> dict[str, int]:
    """Rows per phase on the latest day (for the phase switcher)."""
    if not hist:
        return {}
    b = b or book(hist)
    out: dict[str, int] = {}
    for s in rows_for_day(b, hist[-1]):
        out[s.phase] = out.get(s.phase, 0) + 1
    out["all"] = sum(out.values())
    return out


def unassigned(hist: list[Tracker], b: Book | None = None) -> list[SiteDay]:
    if not hist:
        return []
    b = b or book(hist)
    return [s for s in rows_for_day(b, hist[-1]) if s.phase == "un"]


# ---------------------------------------------------------------------------
# The master file (download + snapshot in the bucket)
# ---------------------------------------------------------------------------

def master_csv(hist: list[Tracker], b: Book | None = None) -> bytes:
    """Latest day, every phase: Phase, Agency, Site, Awarded, Disposed on <day>, Cumulative, Balance."""
    buf = io.StringIO()
    w = csv.writer(buf)
    if not hist:
        w.writerow(["Phase", "Agency", "Site", "Awarded (MT)", "Disposed today (MT)", "Cumulative disposed (MT)", "Balance (MT)"])
        return buf.getvalue().encode("utf-8")
    b = b or book(hist)
    t = hist[-1]
    rows = rows_for_day(b, t)
    names = _names([rows], "p")
    rows.sort(key=lambda s: (PHASE_ORDER.index(s.phase) if s.phase in PHASE_ORDER else 9, s.agency, s.site))
    w.writerow(["Phase", "Agency", "Site", "Awarded (MT)", f"Disposed on {t.date.day} {t.date:%b} (MT)",
                "Cumulative disposed (MT)", "Balance (MT)"])
    for s in rows:
        w.writerow([PHASE_LABEL.get(s.phase, s.phase), s.agency, names[s.sid], f"{s.awarded:.2f}", f"{s.today:.2f}",
                    f"{s.cum:.2f}", f"{s.bal:.2f}" if s.tracked else ""])
    return buf.getvalue().encode("utf-8")


def save_snapshot(hist: list[Tracker]) -> None:
    """Keep the current true copy in the bucket too (best effort)."""
    try:
        rdf_tracker.write_file(_SNAPSHOT, master_csv(hist))
    except Exception:
        logger.exception("rdf_master: could not save the master snapshot")
