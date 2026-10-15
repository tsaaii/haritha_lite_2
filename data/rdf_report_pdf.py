"""
Export-ready A4 PDF of the RDF disposal report (ReportLab, vector).

Same content, order and colour coding as the printed page
(templates/rdf_report/_sheet.html + the @media print rules): headline
figures, "Disposed so far" chart, by agency, closest to reclaim, by site.
Ink-light like the design: no filled blocks, colour only in text and lines.

Sizes are the design's CSS px x 0.75 (A4 at 96 dpi), so 14px text -> 10.5pt.
"""
from __future__ import annotations

import io
from html import escape

from reportlab.graphics.shapes import Circle, Drawing, Line, PolyLine, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from data import rdf_report

PX = 0.75
TOKENS = {
    "--green-700": "#0F7A3E", "--green-600": "#0FA14E", "--red-600": "#C2402F",
    "--ink-900": "#121A14", "--ink-700": "#33413A", "--ink-500": "#5C6B62", "--ink-300": "#9AA79F",
    "--ink-200": "#CBD4CE", "--ink-100": "#E8EDEA", "--white": "#FFFFFF",
}
SERIF, SERIF_B = "Times-Roman", "Times-Bold"   # built-in; closest to Palatino without shipping font files


def hexof(css: str) -> str:
    """'var(--green-700)' -> '#0F7A3E'."""
    css = css.strip()
    if css.startswith("var("):
        return TOKENS.get(css[4:-1].strip(), "#121A14")
    return css


def col(css: str):
    return colors.HexColor(hexof(css))


INK9, INK7, INK5 = col("var(--ink-900)"), col("var(--ink-700)"), col("var(--ink-500)")
INK3, INK2, INK1 = col("var(--ink-300)"), col("var(--ink-200)"), col("var(--ink-100)")
GREEN7 = col("var(--green-700)")


def _st(name, size_px, color=INK9, bold=False, align=0, leading=1.3, **kw):
    return ParagraphStyle(name, fontName=SERIF_B if bold else SERIF, fontSize=size_px * PX,
                          leading=size_px * PX * leading, textColor=color, alignment=align, **kw)


S = {
    "org": _st("org", 12, GREEN7, leading=1.35),
    "title": _st("title", 20, leading=1.25),
    "date": _st("date", 16, align=2), "meta": _st("meta", 14, INK5, align=2, leading=1.35),
    "kl": _st("kl", 11, INK5), "kv": _st("kv", 20, leading=1.15),
    "status": _st("status", 13),
    "h2": _st("h2", 16, bold=True, leading=1.35), "sub": _st("sub", 13, INK5),
    "range": _st("range", 13, INK5, align=2), "legend": _st("legend", 12, INK5),
    "proj": _st("proj", 14),
    "th": _st("th", 12, INK5), "thr": _st("thr", 12, INK5, align=2),
    "td": _st("td", 14), "tdr": _st("tdr", 14, align=2),
    "sh": _st("sh", 11, INK5), "shr": _st("shr", 11, INK5, align=2),
    "sd": _st("sd", 13), "sdr": _st("sdr", 13, align=2),
    "band": _st("band", 15, bold=True), "bandr": _st("bandr", 13, bold=True, align=2),
    "foot": _st("foot", 12, INK5),
}


def P(text, style, color: str | None = None, bold=False):
    t = escape(str(text))
    if bold:
        t = f"<b>{t}</b>"
    if color:
        t = f'<font color="{hexof(color)}">{t}</font>'
    return Paragraph(t, S[style])


def _kv(value, unit="", color="var(--ink-900)"):
    u = f' <font size="{11 * PX}" color="{hexof("var(--ink-500)")}">{unit}</font>' if unit else ""
    return Paragraph(f'<font color="{hexof(color)}">{escape(value)}</font>{u}', S["kv"])


# ---------------------------------------------------------------------------
# Chart
# ---------------------------------------------------------------------------

def _chart(marks: list[tuple], width_pt: float) -> Drawing:
    W, H = rdf_report.CHART_W, rdf_report.CHART_H
    k = width_pt / W
    d = Drawing(width_pt, H * k)

    def X(v):
        return v * k

    def Y(v):
        return (H - v) * k                   # SVG y-down -> PDF y-up

    for m in marks:
        if m[0] == "line":
            _, x1, y1, x2, y2, st = m
            d.add(Line(X(x1), Y(y1), X(x2), Y(y2), strokeColor=col(st), strokeWidth=1 * k))
        elif m[0] == "path":
            _, xy, st, w, dash = m
            pl = PolyLine([c for a, b in xy for c in (X(a), Y(b))], strokeColor=col(st),
                          strokeWidth=w * k, strokeLineJoin=1, fillColor=None)
            if dash:
                pl.strokeDashArray = [float(v) * k for v in dash.split()]
            d.add(pl)
        elif m[0] == "dot":
            _, cx, cy, r, fill, ring = m
            d.add(Circle(X(cx), Y(cy), r * k, fillColor=col(fill),
                         strokeColor=colors.white if ring else None, strokeWidth=1.2 * k if ring else 0))
        else:
            _, tx, ty, s, fill, anchor, bold = m
            d.add(String(X(tx), Y(ty), s, fontName=SERIF_B if bold else SERIF, fontSize=11 * k,
                         fillColor=col(fill), textAnchor=anchor))
    return d


def _legend(deadline_short: str):
    def sw(kind):
        dr = Drawing(16 * PX, 8)
        c = {"g": "var(--green-600)", "r": "var(--red-600)", "k": "var(--ink-700)"}[kind]
        ln = Line(0, 4, 16 * PX, 4, strokeColor=col(c), strokeWidth=2.25 if kind != "r" else 1.5)
        if kind == "r":
            ln.strokeDashArray = [3, 2]
        dr.add(ln)
        return dr
    items = [("g", "MT disposed each day (left)"),
             ("r", f"MT a day needed to clear by {deadline_short} (left)"),
             ("k", "MT left to dispose (right)")]
    row, widths = [], []
    for kind, label in items:
        row += [sw(kind), P(label, "legend")]
        widths += [16 * PX + 4.5, None]
    widths = [w if w is not None else stringWidth(items[i // 2][1], SERIF, 12 * PX) + 10.5
              for i, w in enumerate(widths)]
    t = Table([row], colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

PAD = 10 * PX          # row side padding in the design
GAP = 10 * PX          # grid gap


def _widths(total: float, fixed_px: list[float | None]) -> list[float]:
    """Design grid columns -> ReportLab colWidths. None = flexible (shared equally)."""
    fixed = [(f * PX + GAP) if f is not None else None for f in fixed_px]
    flex = (total - sum(f for f in fixed if f is not None)) / max(1, fixed.count(None))
    return [f if f is not None else flex for f in fixed]


def _table(rows, widths, styles, repeat=0):
    t = Table(rows, colWidths=widths, repeatRows=repeat, hAlign="LEFT")
    base = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), GAP / 2), ("RIGHTPADDING", (0, 0), (-1, -1), GAP / 2),
        ("LEFTPADDING", (0, 0), (0, -1), PAD), ("RIGHTPADDING", (-1, 0), (-1, -1), PAD),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    t.setStyle(TableStyle(base + styles))
    return t


def _agency_table(r: dict, width: float):
    ws = _widths(width - 2 * PAD + GAP, [None, 78, 88, 96, 96, 52])
    ws[0] += 2 * PAD - GAP
    head = [P("Agency", "th")] + [P(h, "thr") for h in ("Today (MT)", "Needed/day", "To date (MT)", "Left (MT)", "Done")]
    rows = [head]
    for a in r["ag_rows"]:
        name = Paragraph(f'{escape(a["name"])} <font size="{11 * PX}" color="{hexof(a["status_color"])}">'
                         f'· {escape(a["status"])}</font>', S["td"])
        rows.append([name, P(a["today"], "tdr", a["today_color"], bold=True), P(a["need"], "tdr", "var(--ink-700)"),
                     P(a["cum"], "tdr", "var(--green-700)"), P(a["bal"], "tdr"), P(a["pct"], "tdr")])
    k = r["k"]
    rows.append([P("All agencies", "td", bold=True)] +
                [P(v, "tdr", bold=True) for v in (k["today"], k["need"], k["cum"], k["bal"], k["pct"])])
    n = len(rows)
    return _table(rows, ws, [
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, INK3),
        ("LINEBELOW", (0, 1), (-1, n - 2), 0.75, INK1),
        ("LINEABOVE", (0, n - 1), (-1, n - 1), 1.5, INK2),
        ("TOPPADDING", (0, n - 1), (-1, n - 1), 7.5), ("BOTTOMPADDING", (0, n - 1), (-1, n - 1), 7.5),
    ], repeat=1)


def _least_table(r: dict, width: float):
    flex = width - 2 * PAD - (28 + 96 + 52) * PX - 4 * GAP
    ws = [28 * PX + PAD + GAP / 2, flex * 1.4 / 2.4 + GAP, flex / 2.4 + GAP, 96 * PX + GAP, 52 * PX + PAD + GAP / 2]
    rows = [[P("#", "th"), P("Site", "th"), P("Agency", "th"), P("Left (MT)", "thr"), P("Done", "thr")]]
    for s in r["least"]:
        rows.append([P(s["rank"], "td", "var(--ink-500)"), P(s["site"], "td"), P(s["agency"], "td", "var(--ink-500)"),
                     P(s["bal"], "tdr", bold=True), P(s["pct"], "tdr")])
    return _table(rows, ws, [
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, INK3),
        ("LINEBELOW", (0, 1), (-1, -1), 0.75, INK1),
        ("TOPPADDING", (0, 1), (-1, -1), 2.25), ("BOTTOMPADDING", (0, 1), (-1, -1), 2.25),
    ], repeat=1)


def _group_table(g: dict, width: float):
    ws = _widths(width - 2 * PAD + GAP, [None, 78, 96, 96, 52])
    ws[0] += 2 * PAD - GAP
    band = [Paragraph(f'{escape(g["name"])} <font name="{SERIF}" size="{11 * PX}" color="{hexof("var(--ink-500)")}">'
                      f'· {escape(g["count"])}</font>', S["band"]),
            P(g["today"], "bandr", g["today_color"]), P(g["cum"], "bandr", "var(--green-700)"),
            P(g["bal"], "bandr"), P(g["pct"], "bandr")]
    head = [P("Site", "sh")] + [P(h, "shr") for h in ("Today (MT)", "To date (MT)", "Left (MT)", "Done")]
    rows = [band, head]
    for s in g["sites"]:
        rows.append([P(s["site"], "sd"), P(s["today"], "sdr", s["today_color"], bold=s["today_weight"] == 700),
                     P(s["cum"], "sdr", "var(--green-700)"), P(s["bal"], "sdr"), P(s["pct"], "sdr")])
    return _table(rows, ws, [
        ("LINEBELOW", (0, 0), (-1, 0), 1.125, INK9),
        ("TOPPADDING", (0, 0), (-1, 0), 4.5),
        ("TOPPADDING", (0, 1), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 1), (-1, -1), 1.5),
        ("LINEBELOW", (0, 2), (-1, -1), 0.75, INK1),
    ], repeat=2)


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------

def _rule(width, color, weight=0.75, before=0, after=0):
    t = Table([[""]], colWidths=[width], rowHeights=[0.1])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), weight, color),
                           ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return [Spacer(1, before), t, Spacer(1, after)]


def _page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont(SERIF, 8)
    canvas.setFillColor(INK5)
    canvas.drawRightString(A4[0] - 12 * mm, 7 * mm, f"Page {doc.page}")
    canvas.restoreState()


def filename(r: dict) -> str:
    return f"RDF_disposal_report_{r['rep_iso']}.pdf"


def build_pdf(r: dict) -> bytes:
    buf = io.BytesIO()
    fp = 6   # SimpleDocTemplate's frame padding; margins below are net of it (12mm / 14mm like @page)
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm - fp, rightMargin=12 * mm - fp,
                            topMargin=14 * mm - fp, bottomMargin=14 * mm - fp,
                            title=f"RDF disposal report · {r['rep_label']}",
                            author="Swachha Andhra Corporation", subject="Daily RDF disposal")
    W = doc.width - 2 * fp
    gap = 18 * PX
    k = r["k"]
    story = []

    # Header
    left = [P("SWACHHA ANDHRA CORPORATION", "org"), P("RDF disposal report", "title")]
    right = [P(r["rep_label"], "date"), P(f"Target: clear by {r['deadline_label']}", "meta"), P(r["days_label"], "meta")]
    hdr = Table([[left, right]], colWidths=[W * 0.55, W * 0.45])
    hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                             ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 7.5),
                             ("LINEBELOW", (0, 0), (-1, -1), 0.75, INK3)]))
    story += [hdr, Spacer(1, gap)]

    # Headline figures (one line of six)
    kp = [[P(f"Disposed on {r['rep_day']}", "kl"), P("Needed per day", "kl"), P("Disposed to date", "kl"),
           P("Left to dispose", "kl"), P("Done", "kl"), P("Sites", "kl")],
          [_kv(k["today"], "MT", "var(--green-700)"), _kv(k["need"], "MT"), _kv(k["cum"], "MT", "var(--green-700)"),
           _kv(k["bal"], "MT"), _kv(k["pct"]), _kv(str(k["sites"]))]]
    kw = [W * f for f in (0.17, 0.17, 0.20, 0.20, 0.13, 0.13)]
    kt = Table(kp, colWidths=kw)
    kt.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0.75),
                            ("BOTTOMPADDING", (0, 1), (-1, 1), 6), ("LINEBELOW", (0, 1), (-1, 1), 0.75, INK2)]))
    story.append(KeepTogether([kt, Spacer(1, 6), P(f"Status: {k['verdict']}", "status", k["status_color"])]))
    story.append(Spacer(1, gap))

    # Chart
    ch = Table([[P("Disposed so far · all agencies", "h2"), P(r["range_label"], "range")]], colWidths=[W * 0.7, W * 0.3])
    ch.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                            ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
    chart = _chart(r["chart_marks"], min(W, 520 * PX))
    story.append(KeepTogether([ch, Spacer(1, 7.5), _legend(r["deadline_short"]), Spacer(1, 7.5), chart,
                               Spacer(1, 7.5), P(r["proj_text"], "proj")]))
    story.append(Spacer(1, gap))

    # By agency
    story += [P("By agency", "h2"), Spacer(1, 7.5), _agency_table(r, W), Spacer(1, gap)]

    # Closest to reclaim
    story.append(KeepTogether([
        P("Closest to reclaim", "h2"), Spacer(1, 3),
        P(f"The {len(r['least'])} sites with the least RDF left, across all agencies.", "sub"),
        Spacer(1, 7.5), _least_table(r, W)]))
    story.append(Spacer(1, gap))

    # By site
    story += [P("By site", "h2"), Spacer(1, 3),
              P(f"Every site in the {r['rep_day']} tracker, grouped by agency. "
                f"Today = RDF disposed on {r['rep_day']}, as reported in the tracker.", "sub"),
              Spacer(1, 9)]
    for g in r["groups"]:
        story += [_group_table(g, W), Spacer(1, 7.5)]

    # Footer
    story += _rule(W, INK2, before=gap - 7.5, after=9)
    ft = Table([[P(f"Source: daily RDF tracker, {r['rep_label']}. Quantities in metric tonnes (MT).", "foot"),
                 Paragraph("SWACHHA ANDHRA CORPORATION", ParagraphStyle("fr", parent=S["foot"], alignment=2))]],
               colWidths=[W * 0.68, W * 0.32])
    ft.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(ft)

    doc.build(story, onFirstPage=_page_number, onLaterPages=_page_number)
    return buf.getvalue()
