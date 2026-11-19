"""RDF disposal report (/rdf): PIN + captcha sign-in, upload, figures, gist, PDF.

Runs against temp folders (built-in history from data/rdf_history + an empty upload store), so it is offline.

    python -m unittest tests.test_rdf_report -v
"""
from __future__ import annotations

import csv
from datetime import date, timedelta
import glob
import io
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SECRET_KEY", "test-secret")
TMP = tempfile.mkdtemp(prefix="rdf-test-")
os.environ["RDF_TRACKER_DIR"] = TMP
from werkzeug.security import generate_password_hash  # noqa: E402
os.environ["SAC_PIN_HASH"] = generate_password_hash("2468")   # test PIN, overrides the built-in one
# No pin.yaml: the shared PIN book (pins.py) uses the built-in PIN (here the test one above).
NO_PIN_FILE = os.path.join(TMP, "no-pin.yaml")

import captcha  # noqa: E402
import pins  # noqa: E402
import config  # noqa: E402
from data import rdf_master, rdf_report, rdf_tracker  # noqa: E402
from main import app  # noqa: E402

HIST = os.path.join(TMP, "_history")
# Other test modules may have imported data.rdf_tracker first; point it at the temp folders either way.
rdf_tracker.TRACKER_DIR = os.path.join(TMP, "store")
rdf_tracker.HISTORY_DIR = HIST
SEED = sorted(glob.glob(os.path.join(ROOT, "data", "rdf_history", "*.csv")))
XRW = {"X-Requested-With": "rdf-report"}


def reset_store(drop_last: bool = True):
    """Built-in history = the shipped days (minus the last, which tests upload); no uploads yet."""
    shutil.rmtree(TMP, ignore_errors=True)
    os.makedirs(os.path.join(TMP, "store", "trackers"))
    os.makedirs(HIST)
    for p in SEED[:-1] if drop_last else SEED:
        shutil.copy(p, HIST)


def answer(client) -> str:
    with client.session_transaction() as s:
        return str(s[captcha._CAPTCHA_ANSWER_KEY])


def sign_in(client, pin="2468", base="http://localhost", next_url="/rdf/"):
    client.get("/rdf/", base_url=base)                    # renders the captcha
    with client.session_transaction(base_url=base) as s:
        a, n = str(s[captcha._CAPTCHA_ANSWER_KEY]), s[captcha._CAPTCHA_NONCE_KEY]
    return client.post("/rdf/login", base_url=base,
                       data={"pin": pin, "captcha_answer": a, "captcha_nonce": n, "next": next_url})


class Base(unittest.TestCase):
    def setUp(self):
        reset_store()
        captcha._failures.clear()
        os.environ["PIN_FILE"] = NO_PIN_FILE
        pins.invalidate()
        self.c = app.test_client()


class SignIn(Base):
    def test_page_shows_pin_and_captcha(self):
        r = self.c.get("/rdf/")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b'name="pin"', r.data)
        self.assertIn(b'name="captcha_answer"', r.data)

    def test_paths_redirect_to_rdf(self):
        for p in ("/rdf", "/RDF", "/RDF/", "/rdf_report", "/rdf_report/"):
            r = self.c.get(p)
            self.assertEqual(r.status_code, 301, p)
            self.assertTrue(r.location.endswith("/rdf/"), p)

    def test_right_pin_and_captcha(self):
        r = sign_in(self.c)
        self.assertEqual((r.status_code, r.location), (302, "/rdf/"))
        r = self.c.get("/rdf/")
        self.assertIn(b"RDF disposal report", r.data)
        self.assertIn(b"12 Oct 2026", r.data)

    def test_wrong_captcha_never_checks_pin(self):
        self.c.get("/rdf/")
        with self.c.session_transaction() as s:
            n = s[captcha._CAPTCHA_NONCE_KEY]
        r = self.c.post("/rdf/login", data={"pin": "2468", "captcha_answer": "99999", "captcha_nonce": n})
        self.assertEqual(r.status_code, 400)
        self.assertIn(b"security check", r.data)
        self.assertEqual(self.c.get("/rdf/api/trackers").status_code, 401)

    def test_wrong_pin_then_lockout(self):
        r = sign_in(self.c, pin="1111")
        self.assertEqual(r.status_code, 401)
        self.assertIn(b"Incorrect PIN", r.data)
        for _ in range(captcha.MAX_FAILURES):
            r = sign_in(self.c, pin="1111")
        self.assertEqual(r.status_code, 429)
        self.assertEqual(sign_in(self.c).status_code, 429)   # right PIN still blocked

    def test_builtin_pin_is_a_hash(self):
        self.assertTrue(pins.BUILTIN_PIN_HASH.startswith("scrypt:"))

    def test_apis_need_sign_in(self):
        self.assertEqual(self.c.get("/rdf/api/gist").status_code, 401)
        self.assertEqual(self.c.post("/rdf/api/upload", headers=XRW).status_code, 401)
        self.assertEqual(self.c.get("/rdf/report.pdf").status_code, 302)

    def test_rdf_subdomain_root(self):
        base = "https://rdf.advitiaum.com"
        self.assertIn(b'name="pin"', self.c.get("/", base_url=base).data)
        r = sign_in(self.c, base=base, next_url="/")
        self.assertEqual(r.location, "/")
        self.assertIn(b"Save as PDF", self.c.get("/", base_url=base).data)


class Upload(Base):
    def setUp(self):
        super().setUp()
        sign_in(self.c)

    def upload(self, path, name=None, headers=XRW):
        with open(path, "rb") as f:
            return self.c.post("/rdf/api/upload", headers=headers, content_type="multipart/form-data",
                               data={"files": (io.BytesIO(f.read()), name or os.path.basename(path))})

    def test_upload_updates_sheet_gist_and_pdf_link(self):
        j = self.upload(SEED[-1], "Daily_RDF_tracker-14-10-2026.csv").get_json()
        self.assertTrue(j["ok"])
        self.assertEqual(j["results"][0]["date"], "2026-10-13")
        self.assertIn("13 Oct 2026", j["sheet_html"])
        self.assertIn("1,422.66", j["sheet_html"])
        # named for the day it is downloaded (IST), not the sheet's date
        self.assertEqual(j["pdf_name"], f"Daily_RDF_tracker_All-phases_{config.today_ist():%d-%m-%Y}.pdf")
        # Coastline's work before Phase 3 (Eluru, Machilipatnam) is Tharuni's (user rule, 19 Nov 2026).
        self.assertIn("2. Tharuni sent RDF from Eluru, Kadapa, Kakinada, Machilipatnam, Srikakulam and Vizianagaram sites.", j["gist"])

    def test_pdf_download(self):
        self.upload(SEED[-1])
        r = self.c.get("/rdf/report.pdf")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.mimetype, "application/pdf")
        self.assertTrue(r.data.startswith(b"%PDF-"))
        self.assertIn(f'filename="Daily_RDF_tracker_All-phases_{config.today_ist():%d-%m-%Y}.pdf"', r.headers["Content-Disposition"])
        r = self.c.get("/rdf/report.pdf?phase=p3")
        self.assertIn(f'filename="Daily_RDF_tracker_Phase-3_{config.today_ist():%d-%m-%Y}.pdf"', r.headers["Content-Disposition"])

    def test_not_a_tracker(self):
        bad = os.path.join(TMP, "store", "bad.csv")
        with open(bad, "w") as f:
            f.write("a,b\n1,2\n")
        j = self.upload(bad).get_json()
        self.assertFalse(j["ok"])
        self.assertIn("Agency", j["results"][0]["error"])

    def test_upload_needs_page_header(self):
        self.assertEqual(self.upload(SEED[-1], headers={}).status_code, 400)

    def test_same_day_replaces(self):
        self.assertFalse(self.upload(SEED[-1]).get_json()["results"][0]["replaced"])
        j = self.upload(SEED[-1], "again.csv").get_json()
        self.assertTrue(j["results"][0]["replaced"])
        self.assertEqual(len(self.c.get("/rdf/api/trackers").get_json()["days"]), len(SEED))


class History(Base):
    """Hardcoded history is always on the graph; uploads add days and win on the same date."""

    def setUp(self):
        super().setUp()
        sign_in(self.c)

    def days(self):
        return {d["date"]: d for d in self.c.get("/rdf/api/trackers").get_json()["days"]}

    def test_builtin_history_shows_with_empty_store(self):
        d = self.days()
        self.assertEqual(len(d), len(SEED) - 1)
        self.assertTrue(all(x["builtin"] for x in d.values()))
        page = self.c.get("/rdf/").data
        self.assertIn(b"1 Oct to 12 Oct", page)          # chart range covers the whole history

    def test_upload_adds_a_point(self):
        with open(SEED[-1], "rb") as f:
            self.c.post("/rdf/api/upload", headers=XRW, content_type="multipart/form-data",
                        data={"files": (io.BytesIO(f.read()), "Daily_RDF_tracker-14-10-2026.csv")})
        d = self.days()
        self.assertEqual(len(d), len(SEED))
        self.assertFalse(d["2026-10-13"]["builtin"])
        self.assertIn(b"1 Oct to 13 Oct", self.c.get("/rdf/").data)
        self.assertEqual(len(rdf_report.build(rdf_tracker.history())["chart_marks"]) > 0, True)

    def test_upload_overrides_builtin_day_and_remove_restores_it(self):
        with open(SEED[5], "rb") as f:
            raw = f.read().replace(b"Tharuni associates", b"Tharuni Associates", 1)
        j = self.c.post("/rdf/api/upload", headers=XRW, content_type="multipart/form-data",
                        data={"files": (io.BytesIO(raw), "fix.csv")}).get_json()
        day = j["results"][0]["date"]
        self.assertTrue(j["results"][0]["replaced"])
        self.assertTrue(self.days()[day]["overrides_builtin"])
        r = self.c.post("/rdf/api/delete", headers=XRW, json={"date": day}).get_json()
        self.assertTrue(r["ok"])
        self.assertTrue(self.days()[day]["builtin"])     # built-in sheet is back

    def test_builtin_day_cannot_be_removed(self):
        day = next(iter(self.days()))
        r = self.c.post("/rdf/api/delete", headers=XRW, json={"date": day})
        self.assertEqual(r.status_code, 400)
        self.assertIn(day, self.days())


class Gist(unittest.TestCase):
    def tracker(self, rows):
        return rdf_tracker.Tracker(date=__import__("datetime").date(2026, 11, 3), sheet_date=None,
                                   sites=tuple(rdf_tracker.SiteDay(a, s, t, 0, 0) for a, s, t in rows))

    def test_format_like_whatsapp_example(self):
        t = self.tracker([
            ("Zigma Global", "Ananthapur", 50), ("Tharuni associates", "Proddatur - Site2 (Small)", 10),
            ("Saurashtra Enviro", "Yemmiganur", 5), ("Tharuni associates", "Kadapa 3.1", 20),
            ("Saurashtra Enviro", "Kurnool 3.0 (Package 4)", 9), ("Tharuni associates", "Jaggaiahpeta", 3),
            ("Saurashtra Enviro", "Kurnool 2.0 (Additional Qty)", 4), ("Coastline Projects", "Eluru #15", 0),
        ])
        self.assertEqual(rdf_report.gist(t), "\n".join([
            "1. Saurashtra sent RDF from Kurnool and Yemmiganur sites.",
            "2. Tharuni sent RDF from Jaggaiahpeta, Kadapa and Proddatur sites.",
            "3. Zigma sent RDF from Ananthapur site.",
        ]))

    def test_nobody_sent(self):
        self.assertEqual(rdf_report.gist(self.tracker([("Zigma Global", "Puttur", 0)])), "No agency sent RDF on 3 Nov.")

    def test_short_names(self):
        self.assertEqual(rdf_report.site_short("Nellore(Donthali)-Phase-2"), "Nellore")
        self.assertEqual(rdf_report.site_short("Nandyal 15 % (Allagadda, Nandikotkur)"), "Nandyal")
        self.assertEqual(rdf_report.site_short("Tirupati #26"), "Tirupati")
        self.assertEqual(rdf_report.agency_short("Raghu Ram Hume Pipes"), "Raghu Ram")
        self.assertEqual(rdf_report.agency_short("New Agency Pvt Ltd"), "New Agency")


class Parse(unittest.TestCase):
    def test_seed_figures_match_design_session(self):
        reset_store(drop_last=False)
        h = {t.date.isoformat(): t for t in rdf_tracker.history()}
        t = h["2026-10-11"]
        self.assertAlmostEqual(sum(s.today for s in t.sites), 832.55, places=2)
        self.assertAlmostEqual(sum(s.cum for s in t.sites), 148179.41, places=2)
        self.assertAlmostEqual(sum(s.bal for s in t.sites), 234415.32, places=2)
        self.assertEqual(t.sheet_date.isoformat(), "2026-10-12")
        self.assertEqual(len(h), 12)


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()


class Dashboard(Base):
    """Tabs: site lists, agency progress, projected finish, date range."""

    def setUp(self):
        super().setUp()
        reset_store(drop_last=False)
        from data import rdf_dashboard
        self.D = rdf_dashboard
        self.hist = rdf_tracker.history()
        self.d = rdf_dashboard.build(self.hist)

    def test_site_lists_follow_agreed_rules(self):
        c = self.d["counts"]
        self.assertEqual(c["sites"], 63)
        self.assertEqual((c["active"], c["stalled"], c["quick"], c["cleared"]), (14, 31, 15, 12))
        for s in self.d["sites"]:
            f = s["filters"].split()
            if "quick" in f:
                self.assertLessEqual(s["bal_v"], 1000)
                self.assertGreater(s["bal_v"], 0)
            if "cleared" in f:
                self.assertLessEqual(s["bal_v"], 0)
        self.assertEqual([x["site"] for x in self.d["top"]["quick"]][:2], ["Atmakur", "Salur"])

    def test_stalled_means_nothing_for_7_days(self):
        from datetime import date
        series = self.D._series(self.hist)
        rep = self.hist[-1].date
        for s in self.d["sites"]:
            if "stalled" in s["filters"].split():
                ss = next(v for v in series.values() if v.site == s["site"] and agency_short_ok(v.agency, s["agency"]))
                last = ss.last_dispatch()
                self.assertTrue(last is None or (rep - last).days >= 7, s["site"])
        self.assertIsInstance(rep, date)

    def test_agency_progress_and_finish(self):
        ag = {a["short"]: a for a in self.d["agencies"]}
        self.assertEqual(ag["Tharuni"]["pct"], "48%")
        self.assertTrue(ag["Tharuni"]["behind"])
        self.assertEqual(ag["Card Box"]["finish"], "31 Oct 2026")
        self.assertFalse(ag["Card Box"]["late"])
        self.assertEqual(ag["Iway"]["finish"], "no recent dispatch")
        self.assertIn("<svg", self.d["stack_chart"])
        self.assertIn("<svg", self.d["finish_chart"])
        self.assertIn("<svg", self.d["heatmap"])

    def test_date_range_uses_cumulative_difference(self):
        from datetime import date
        g = self.D.date_range(self.hist, date(2026, 10, 7), date(2026, 10, 13))
        self.assertTrue(g["ok"])
        self.assertEqual(g["total"], "7,993.51")              # cum 13 Oct − cum 6 Oct
        self.assertEqual(g["baseline"], "6 Oct 2026")
        tharuni = next(r for r in g["rows"] if r["short"] == "Tharuni")
        self.assertEqual(tharuni["disposed"], "3,868.18")
        g = self.D.date_range(self.hist, date(2026, 10, 1), date(2026, 10, 13))
        self.assertEqual(g["total"], "13,709.96")             # from the first day, its own disposal included
        self.assertFalse(self.D.date_range(self.hist, date(2027, 1, 1), date(2027, 1, 5))["ok"])

    def test_page_and_range_api(self):
        sign_in(self.c)
        page = self.c.get("/rdf/").data
        for label in (b'data-tab="overview"', b'data-tab="agencies"', b'data-tab="sites"', b'data-tab="range"',
                      b'data-tab="report"', b"Quick wins", b"Long haul", b"Stalled", b"Projected finish per agency",
                      b"Site activity", b"Daily disposal by agency", b"WhatsApp summary"):
            self.assertIn(label, page)
        j = self.c.get("/rdf/api/range?from=2026-10-07&to=2026-10-13").get_json()
        self.assertTrue(j["ok"])
        self.assertIn("7,993.51", j["html"])
        self.assertEqual(self.c.get("/rdf/api/range?from=x&to=y").status_code, 400)

    def test_upload_returns_dashboard(self):
        reset_store()
        sign_in(self.c)
        with open(SEED[-1], "rb") as f:
            j = self.c.post("/rdf/api/upload", headers=XRW, content_type="multipart/form-data",
                            data={"files": (io.BytesIO(f.read()), "Daily_RDF_tracker-14-10-2026.csv")}).get_json()
        self.assertIn('data-panel="sites"', j["dash_html"])
        self.assertEqual(j["range"]["max"], "2026-10-13")


def agency_short_ok(full: str, short: str) -> bool:
    return rdf_report.agency_short(full) == short


class LogChartTests(unittest.TestCase):
    """'Disposed so far': MT a day on a log left axis, MT left on a linear right axis."""

    def test_axes(self):
        from datetime import date
        P = rdf_report.Point
        pts = [P(date(2026, 10, 1), 800, 0, 238000), P(date(2026, 10, 2), 0, 0, 237200),
               P(date(2026, 10, 3), 1500, 0, 246000)]
        marks = rdf_report.chart_marks(pts, date(2026, 10, 15))   # ~20k/day needed, as in early Nov
        texts = [m for m in marks if m[0] == "text"]
        left = [m[3] for m in texts if m[5] == "end" and m[1] < 54]
        right = [m[3] for m in texts if m[5] == "start" and m[1] > 580 and m[3] != "MT left"]
        self.assertEqual(left, ["100", "1k", "10k", "100k"])
        self.assertEqual(right, ["0", "100k", "200k", "300k"])
        H, T, B = rdf_report.CHART_H, 22, 34
        green = [yy for _, yy in [m for m in marks if m[0] == "path"][1][1]]
        self.assertAlmostEqual(green[1], H - B)                        # a 0 day sits on the bottom line
        y1k, y10k = (T + (1 - e / 3) * (H - T - B) for e in (1, 2))
        self.assertTrue(y10k < green[2] < y1k)                         # 1,500 between the 1k and 10k lines
        black = [yy for _, yy in [m for m in marks if m[0] == "path"][2][1]]
        self.assertAlmostEqual(black[2], T + (1 - 246000 / 300000) * (H - T - B))   # linear right axis


NOV = os.path.join(ROOT, "tests", "fixtures", "Daily_RDF_tracker-18-11-2026.csv")


class Master(unittest.TestCase):
    """The true copy: 17 Nov tracker + phase sheet, as approved by the user (RDF_master.csv, 19 Nov)."""

    @classmethod
    def setUpClass(cls):
        reset_store()
        with open(NOV, "rb") as f:
            cls.t = rdf_tracker.parse(f.read(), os.path.basename(NOV))
        cls.hist = []
        for p in SEED:
            with open(p, "rb") as f:
                cls.hist.append(rdf_tracker.parse(f.read(), os.path.basename(p)))
        cls.hist.append(cls.t)
        cls.b = rdf_master.book(cls.hist, items=[])
        cls.rows = rdf_master.rows_for_day(cls.b, cls.t)

    def by(self, **kw):
        return [s for s in self.rows if all(getattr(s, k) == v for k, v in kw.items())]

    def test_counts_and_totals_per_phase(self):
        want = {  # phase: (rows, tracked, unique sites, cumulative, balance)
            "p3": (55, 46, 51, 144658.80, 150715.16), "p2": (24, 5, 24, 106207.54, 52730.43),
            "p1x": (48, 3, 48, 19945.02, 2184.71), "p1": (95, 9, 94, 329658.29, 22493.89),
            "old": (71, 1, 70, 480137.30, 807.10)}
        for ph, (n, tr, uq, cum, bal) in want.items():
            rs = self.by(phase=ph)
            self.assertEqual(len(rs), n, ph)
            self.assertEqual(sum(s.tracked for s in rs), tr, ph)
            self.assertEqual(rdf_report.unique_sites(rs), uq, ph)
            self.assertAlmostEqual(sum(s.cum for s in rs), cum, places=1, msg=ph)
            self.assertAlmostEqual(sum(s.bal for s in rs if s.tracked), bal, places=1, msg=ph)
        self.assertEqual(len(self.rows), 293)
        self.assertEqual(rdf_report.unique_sites(self.rows), 132)
        self.assertFalse(self.by(phase="un"))

    def test_user_decisions(self):
        self.assertFalse([s for s in self.rows if "nandyal 15" in s.src.lower()])           # excluded
        machi = [s for s in self.rows if s.tracked and s.site == "Machilipatnam" and s.phase in ("p1", "p1x")]
        self.assertEqual(sorted(round(s.awarded) for s in machi), [27216, 41861])            # split by award
        self.assertTrue(all(s.agency == "Tharuni Associates" for s in machi))
        self.assertFalse([s for s in self.rows if s.agency == "Coastline Projects" and s.phase != "p3"])
        self.assertTrue(self.by(phase="p3", agency="Coastline Projects"))
        self.assertEqual(self.by(site="Pedana", phase="p3")[0].agency, "Avinash Agencies")
        self.assertEqual({s.phase for s in self.rows if s.src in ("Salur", "Kadapa") and s.tracked}, {"p3"})
        self.assertEqual(self.by(site="Yemmiganur 15%")[0].key, "Yemmiganur")
        self.assertEqual(len(self.by(site="Nellore Donthali", phase="p3")), 3)           # one site, 3 agencies
        self.assertEqual({s.site for s in self.rows if s.site.startswith("Gudur")}, {"Gudur(N)", "Gudur(K)"})
        amal = [s for s in self.rows if s.site == "Amalapuram" and s.tracked]
        self.assertEqual([s.phase for s in amal], ["old"])
        old = self.by(phase="old", tracked=False)[0]
        self.assertEqual((old.today, old.bal), (0.0, 0.0))

    def test_history_days_match_the_same_way(self):
        # Every built-in October sheet places all its rows (none needs a phase).
        for t in self.hist[:-1]:
            self.assertFalse([s for s in rdf_master.rows_for_day(self.b, t) if s.phase == "un"], t.date)

    def test_views_keep_phases_apart(self):
        p3 = rdf_master.view(self.hist, "p3", self.b)
        self.assertEqual({s.phase for t in p3 for s in t.sites}, {"p3"})
        allv = rdf_master.view(self.hist, "all", self.b)
        self.assertTrue(all(" · " in s.site for s in allv[-1].sites))       # All view names say the phase
        r = rdf_report.build(rdf_master.view(self.hist, "old", self.b), "Old", [])
        self.assertEqual(r["k"]["sites"], 70)
        self.assertEqual(r["phase_label"], "Old")

    def test_master_csv(self):
        rows = list(csv.reader(io.StringIO(rdf_master.master_csv(self.hist, self.b).decode())))
        self.assertEqual(rows[0][:3], ["Phase", "Agency", "Site"])
        self.assertEqual(len(rows) - 1, 293)
        self.assertEqual(rows[1][0], "Phase 3")                               # phases newest first
        self.assertEqual(rows[-1][0], "Old")


class PhasesAndEdits(Base):
    def setUp(self):
        super().setUp()
        sign_in(self.c)
        with open(NOV, "rb") as f:
            self.c.post("/rdf/api/upload", headers=XRW, data={"files": (io.BytesIO(f.read()), os.path.basename(NOV))},
                        content_type="multipart/form-data")

    def sid(self, site, phase):
        hist = rdf_tracker.history()
        return next(s for s in rdf_master.rows_for_day(rdf_master.book(hist), hist[-1])
                    if s.site == site and s.phase == phase)

    def test_phase_switcher_and_views(self):
        page = self.c.get("/rdf/").data.decode()
        for label in ("All phases", "Phase 3", "Phase 2", "Phase 1 – 15%", "Phase 1", "Old"):
            self.assertIn(label, page)
        self.assertIn("RDF disposal report · All phases", page)
        p3 = self.c.get("/rdf/?phase=p3").data.decode()
        self.assertIn("RDF disposal report · Phase 3", p3)
        self.assertIn('aria-current="page">Phase 3', p3)
        old = self.c.get("/rdf/?phase=old").data.decode()
        self.assertIn("Not tracked", old)
        r = self.c.get("/rdf/api/range?from=2026-10-01&to=2026-11-17&phase=p2")
        self.assertTrue(r.get_json()["ok"])

    def test_edit_undo_and_later_upload_wins(self):
        s = self.sid("Kurnool Joharapuram", "p3")
        r = self.c.post("/rdf/api/edit", headers=XRW, json={"sid": s.sid, "changes": {"cum": "5000"}, "phase": "p3"})
        self.assertTrue(r.get_json()["ok"], r.get_json())
        self.assertEqual(self.sid("Kurnool Joharapuram", "p3").cum, 5000.0)
        edits = self.c.get("/rdf/api/edits").get_json()["edits"]
        self.assertEqual(edits[0]["field"], "To date")
        r = self.c.post("/rdf/api/undo", headers=XRW, json={"id": edits[0]["id"]})
        self.assertTrue(r.get_json()["ok"])
        self.assertEqual(self.sid("Kurnool Joharapuram", "p3").cum, s.cum)
        # edit again, then upload the same day's sheet: the sheet wins
        self.c.post("/rdf/api/edit", headers=XRW, json={"sid": s.sid, "changes": {"cum": "5000"}})
        import time
        time.sleep(1.1)
        with open(NOV, "rb") as f:
            self.c.post("/rdf/api/upload", headers=XRW, data={"files": (io.BytesIO(f.read()), "again.csv")},
                        content_type="multipart/form-data")
        self.assertEqual(self.sid("Kurnool Joharapuram", "p3").cum, s.cum)

    def test_identity_edit_moves_phase_on_every_day(self):
        s = self.sid("Salur", "p3")
        r = self.c.post("/rdf/api/edit", headers=XRW, json={"sid": s.sid, "changes": {"phase": "p2", "site": "Salur Old dump"}})
        self.assertTrue(r.get_json()["ok"])
        hist = rdf_tracker.history()
        v = rdf_master.view(hist, "p2")
        self.assertTrue(all(any(x.sid == s.sid and x.site.startswith("Salur Old dump") for x in t.sites)
                            for t in v if any(y.sid == s.sid for y in t.sites)))

    def test_untracked_rows_only_edit_to_date(self):
        s = next(x for x in rdf_master.rows_for_day(rdf_master.book(rdf_tracker.history()), rdf_tracker.history()[-1])
                 if not x.tracked)
        r = self.c.post("/rdf/api/edit", headers=XRW, json={"sid": s.sid, "changes": {"today": "10"}})
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/rdf/api/edit", headers=XRW, json={"sid": s.sid, "changes": {"cum": "123.45"}})
        self.assertTrue(r.get_json()["ok"])

    def test_master_download_and_bad_phase_sheet(self):
        r = self.c.get("/rdf/api/master.csv")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data.decode().strip().splitlines()), 294)
        r = self.c.post("/rdf/api/phase-sheet", headers=XRW, data={"file": (io.BytesIO(b"a,b\n1,2\n"), "x.csv")},
                        content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.post("/rdf/api/edit", json={}).status_code, 400)       # no X-Requested-With


class MasterFormatUpload(Base):
    """From 19 Nov 2026 the daily upload is the master sheet (same columns as Download master CSV)."""

    def setUp(self):
        super().setUp()
        sign_in(self.c)
        with open(NOV, "rb") as f:
            self.post(f.read(), os.path.basename(NOV))

    def post(self, raw, name):
        return self.c.post("/rdf/api/upload", headers=XRW, data={"files": (io.BytesIO(raw), name)},
                           content_type="multipart/form-data").get_json()

    def master(self, day="18 Nov"):
        txt = self.c.get("/rdf/api/master.csv").data.decode()
        return txt.replace("Disposed on 17 Nov 2026", "Disposed on " + day)

    def test_master_day_continues_every_site(self):
        txt = self.master()
        rows = list(csv.reader(io.StringIO(txt)))
        i = next(n for n, r in enumerate(rows) if r[2] == "Kurnool Joharapuram")
        rows[i][4], rows[i][5] = "100.00", f"{float(rows[i][5]) + 100:.2f}"           # sent 100 MT on 18 Nov
        buf = io.StringIO()
        csv.writer(buf).writerows(rows)
        j = self.post(buf.getvalue().encode(), "RDF_master_18-11-2026.csv")
        self.assertTrue(j["ok"], j)
        self.assertEqual((j["results"][0]["date"], j["results"][0]["kind"]), ("2026-11-18", "master sheet"))
        hist = rdf_tracker.history()
        b = rdf_master.book(hist)
        d17 = {s.sid: s for s in rdf_master.rows_for_day(b, hist[-2])}
        d18 = {s.sid: s for s in rdf_master.rows_for_day(b, hist[-1])}
        self.assertEqual(set(d17), set(d18))                                     # same 293 sites, same ids
        joh = next(s for s in d18.values() if s.site == "Kurnool Joharapuram")
        self.assertEqual(joh.today, 100.0)
        self.assertAlmostEqual(joh.cum - d17[joh.sid].cum, 100.0, places=2)
        self.assertIn("Kurnool Joharapuram", j["gist"])
        page = self.c.get("/rdf/?phase=p3").data.decode()
        self.assertIn("18 Nov 2026", page)

    def test_errors_are_clear(self):
        j = self.post(b"Phase,Agency,Site,Awarded (MT),Disposed on 18 Nov (MT),Cumulative disposed (MT),Balance (MT)\n"
                      b"Phase 9,X,Y,1,0,0,0\n", "x.csv")
        self.assertFalse(j["ok"])
        self.assertIn("Unknown phase", j["results"][0]["error"])
        j = self.post(b"Phase,Agency,Site,Awarded (MT),Disposed (MT),Cumulative disposed (MT),Balance (MT)\n"
                      b"Phase 3,X,Y,1,0,0,0\n", "x.csv")
        self.assertFalse(j["ok"])
        self.assertIn("missing", j["results"][0]["error"])

    def test_old_tracker_still_accepted_and_year_is_inferred(self):
        t = rdf_tracker.parse(self.master("30 Dec").encode(), "x.csv")
        today = config.today_ist()
        self.assertEqual(t.date.year, today.year if date(today.year, 12, 30) <= today + timedelta(days=7) else today.year - 1)
        with open(SEED[-1], "rb") as f:
            self.assertTrue(self.post(f.read(), "Daily_RDF_tracker-14-10-2026.csv")["ok"])
