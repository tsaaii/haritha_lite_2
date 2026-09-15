"""
Day-wise summary PDF builder for the per-site dashboard.

Renders the structure produced by data.site_daywise.build_daywise() into a
portrait-A4 PDF that mirrors the reference layout: a header band (site /
agency / date range / transfer party), then one table per material type with
per-day rows (Date, Start Time, End Time, No of Trips, Net Weight MT) and a
bold TOTAL row.

Self-contained — depends only on ReportLab, same as data/site_pdf.py.
"""
from __future__ import annotations

import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

# Muted, print-friendly palette (PDFs are usually printed B/W or on white).
_HEADER_BG = colors.HexColor("#1f2937")     # slate
_HEADER_FG = colors.white
_BAND_BG = colors.HexColor("#e5e7eb")       # light grey
_TOTAL_BG = colors.HexColor("#d1d5db")
_ZEBRA = colors.HexColor("#f3f4f6")
_GRID = colors.HexColor("#9ca3af")

_USABLE_WIDTH = A4[0] - 40  # 20pt margins both sides


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _fmt_date_dmy(yyyy_mm_dd: str) -> str:
    s = (yyyy_mm_dd or "").strip()
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%d-%m-%Y")
    except ValueError:
        return s or "—"


def _fmt_int(n) -> str:
    try:
        return f"{int(round(float(n))):,}"
    except (TypeError, ValueError):
        return "0"


def _fmt_mt(n) -> str:
    try:
        return f"{float(n):,.3f}"
    except (TypeError, ValueError):
        return "0.000"


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "dw_title", parent=base["Title"], fontSize=16, leading=20,
            alignment=1, spaceAfter=2),
        "subtitle": ParagraphStyle(
            "dw_sub", parent=base["Normal"], fontSize=10, leading=13,
            alignment=1, textColor=colors.HexColor("#374151"), spaceAfter=8),
        "material": ParagraphStyle(
            "dw_mat", parent=base["Heading2"], fontSize=11, leading=14,
            spaceBefore=10, spaceAfter=4, textColor=_HEADER_BG),
        "meta": ParagraphStyle(
            "dw_meta", parent=base["Normal"], fontSize=9, leading=12),
        "empty": ParagraphStyle(
            "dw_empty", parent=base["Normal"], fontSize=11, leading=15,
            alignment=1, spaceBefore=30),
        "attr": ParagraphStyle(
            "dw_attr", parent=base["Normal"], fontSize=8, leading=10,
            alignment=1, textColor=colors.grey),
    }


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------

def _meta_band(site_name: str, agency_name: str,
               start: str, end: str, party: str) -> Table:
    if start and end:
        period = f"{_fmt_date_dmy(start)}  to  {_fmt_date_dmy(end)}"
    elif start:
        period = f"From {_fmt_date_dmy(start)}"
    elif end:
        period = f"Up to {_fmt_date_dmy(end)}"
    else:
        period = "All dates"

    rows = [
        ["From / To Date:", period, "Transfer Party:", party or "All"],
    ]
    tbl = Table(rows, colWidths=[90, 230, 95, _USABLE_WIDTH - 415])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, 0), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, _GRID),
        ("LINEABOVE", (0, 0), (-1, -1), 0.5, _GRID),
    ]))
    return tbl


def _material_table(material: dict) -> Table:
    header = ["S.No", "Date", "Start Time", "End Time",
              "No of Trips", "Net Weight (MT)"]
    data = [header]

    for i, day in enumerate(material["days"], 1):
        data.append([
            str(i),
            _fmt_date_dmy(day["date"]),
            day.get("start_time") or "—",
            day.get("end_time") or "—",
            _fmt_int(day["trips"]),
            _fmt_mt(day["net_mt"]),
        ])

    total = material["total"]
    data.append(["", "TOTAL", "", "",
                 _fmt_int(total["trips"]), _fmt_mt(total["net_mt"])])

    col_widths = [40, 95, 95, 95, 80, _USABLE_WIDTH - 405]
    tbl = Table(data, colWidths=col_widths, repeatRows=1)

    last = len(data) - 1
    tbl.setStyle(TableStyle([
        # Header
        ("BACKGROUND", (0, 0), (-1, 0), _HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), _HEADER_FG),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        # Body
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),     # S.No
        ("ALIGN", (1, 1), (3, -1), "CENTER"),     # date + times
        ("ALIGN", (4, 1), (-1, -1), "RIGHT"),     # trips + weight
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, last - 1), [colors.white, _ZEBRA]),
        # Total row
        ("BACKGROUND", (0, last), (-1, last), _TOTAL_BG),
        ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
        ("ALIGN", (1, last), (1, last), "RIGHT"),
        ("SPAN", (1, last), (3, last)),
        # Grid
        ("GRID", (0, 0), (-1, -1), 0.5, _GRID),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def build_daywise_pdf(*, site_name: str, agency_name: str,
                      summary: dict, start: str = "", end: str = "") -> bytes:
    """Render the day-wise summary dict into PDF bytes."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20, rightMargin=20, topMargin=24, bottomMargin=28,
        title=f"{site_name} — Day-wise Summary",
        author="Swachha Andhra Monitor — Advitia Labs",
    )
    st = _styles()
    party = summary.get("transfer_party") or "All"
    el: list = []

    el.append(Paragraph(site_name or "Site", st["title"]))
    if agency_name:
        el.append(Paragraph(
            f"{agency_name} &mdash; Day-wise Summary", st["subtitle"]))
    else:
        el.append(Paragraph("Day-wise Summary", st["subtitle"]))

    el.append(_meta_band(site_name, agency_name, start, end, party))
    el.append(Spacer(1, 6))

    materials = summary.get("materials") or []
    if not materials:
        el.append(Paragraph(
            "No records matched the selected date range and transfer party.",
            st["empty"]))
    else:
        for mat in materials:
            el.append(Paragraph(
                f"MATERIAL TYPE: {mat['material_type']}", st["material"]))
            el.append(_material_table(mat))
            el.append(Spacer(1, 4))

        gt = summary.get("grand_total") or {}
        el.append(Spacer(1, 6))
        el.append(Paragraph(
            f"<b>Across all material types:</b> "
            f"{_fmt_int(gt.get('trips', 0))} trips, "
            f"{_fmt_mt(gt.get('net_mt', 0))} MT.", st["meta"]))

    el.append(Spacer(1, 14))
    ts = datetime.now().strftime("%d-%m-%Y %H:%M:%S")
    el.append(Paragraph(
        f"Generated by Swachha Andhra Monitor — Advitia Labs at {ts}",
        st["attr"]))

    doc.build(el)
    return buf.getvalue()