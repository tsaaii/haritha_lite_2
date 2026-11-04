"""RDF disposal report (/rdf): PIN + captcha sign-in, upload, figures, gist, PDF.

Runs against a temp folder (RDF_TRACKER_DIR) seeded from data/rdf_seed, so it is offline.

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
from data import rdf_report, rdf_tracker  # noqa: E402
from main import app  # noqa: E402

# Other test modules may have imported data.rdf_tracker first; point it at the temp store either way.
rdf_tracker.TRACKER_DIR = TMP
SEED = sorted(glob.glob(os.path.join(ROOT, "data", "rdf_seed", "*.csv")))
XRW = {"X-Requested-With": "rdf-report"}


def reset_store(drop_last: bool = True):
    shutil.rmtree(TMP, ignore_errors=True)
    os.makedirs(os.path.join(TMP, "trackers"))
    for p in SEED[:-1] if drop_last else SEED:
        shutil.copy(p, os.path.join(TMP, "trackers"))


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
        self.assertEqual(j["pdf_name"], "Daily_RDF_tracker_14-10-2026.pdf")
        self.assertIn("2. Tharuni sent RDF from Kadapa, Kakinada, Srikakulam and Vizianagaram sites.", j["gist"])

    def test_pdf_download(self):
        self.upload(SEED[-1])
        r = self.c.get("/rdf/report.pdf")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.mimetype, "application/pdf")
        self.assertTrue(r.data.startswith(b"%PDF-"))
        self.assertIn('filename="Daily_RDF_tracker_14-10-2026.pdf"', r.headers["Content-Disposition"])

    def test_not_a_tracker(self):
        bad = os.path.join(TMP, "bad.csv")
        with open(bad, "w") as f:
            f.write("a,b\n1,2\n")
        j = self.upload(bad).get_json()
        self.assertFalse(j["ok"])
        self.assertIn("Agency", j["results"][0]["error"])

    def test_upload_needs_page_header(self):
        self.assertEqual(self.upload(SEED[-1], headers={}).status_code, 400)

    def test_same_day_replaces(self):
        self.upload(SEED[-1])
        j = self.upload(SEED[-1], "again.csv").get_json()
        self.assertTrue(j["results"][0]["replaced"])
        self.assertEqual(len(self.c.get("/rdf/api/trackers").get_json()["days"]), len(SEED))


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
