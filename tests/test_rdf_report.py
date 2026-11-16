"""RDF disposal report (/rdf): PIN + captcha sign-in, upload, figures, gist, PDF.

Runs against temp folders (built-in history from data/rdf_history + an empty upload store), so it is offline.

    python -m unittest tests.test_rdf_report -v
"""
from __future__ import annotations

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
os.environ["RDF_REPORT_PIN_HASH"] = generate_password_hash("24680")   # test PIN, overrides the built-in one

import captcha  # noqa: E402
import config  # noqa: E402
from data import rdf_report, rdf_tracker  # noqa: E402
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


def sign_in(client, pin="24680", base="http://localhost", next_url="/rdf/"):
    client.get("/rdf/", base_url=base)                    # renders the captcha
    with client.session_transaction(base_url=base) as s:
        a, n = str(s[captcha._CAPTCHA_ANSWER_KEY]), s[captcha._CAPTCHA_NONCE_KEY]
    return client.post("/rdf/login", base_url=base,
                       data={"pin": pin, "captcha_answer": a, "captcha_nonce": n, "next": next_url})


class Base(unittest.TestCase):
    def setUp(self):
        reset_store()
        captcha._failures.clear()
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
        r = self.c.post("/rdf/login", data={"pin": "24680", "captcha_answer": "99999", "captcha_nonce": n})
        self.assertEqual(r.status_code, 400)
        self.assertIn(b"security check", r.data)
        self.assertEqual(self.c.get("/rdf/api/trackers").status_code, 401)

    def test_wrong_pin_then_lockout(self):
        r = sign_in(self.c, pin="11111")
        self.assertEqual(r.status_code, 401)
        self.assertIn(b"Incorrect PIN", r.data)
        for _ in range(captcha.MAX_FAILURES):
            r = sign_in(self.c, pin="11111")
        self.assertEqual(r.status_code, 429)
        self.assertEqual(sign_in(self.c).status_code, 429)   # right PIN still blocked

    def test_builtin_pin_is_a_5_digit_hash(self):
        from views import rdf_report as v
        self.assertTrue(v._DEFAULT_PIN_HASH.startswith("scrypt:"))

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
        self.assertEqual(j["pdf_name"], f"Daily_RDF_tracker_{config.today_ist():%d-%m-%Y}.pdf")
        self.assertIn("2. Tharuni sent RDF from Kadapa, Kakinada, Srikakulam and Vizianagaram sites.", j["gist"])

    def test_pdf_download(self):
        self.upload(SEED[-1])
        r = self.c.get("/rdf/report.pdf")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.mimetype, "application/pdf")
        self.assertTrue(r.data.startswith(b"%PDF-"))
        self.assertIn(f'filename="Daily_RDF_tracker_{config.today_ist():%d-%m-%Y}.pdf"', r.headers["Content-Disposition"])

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
