"""New /sac dashboard + portal: one PIN for /sac, /reports and /rdf, phase-sheet upload, live tickets.

Offline: temp PIN file and sheet store; the weighbridge API is replaced by stubs.

    python -m unittest tests.test_sac -v
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SECRET_KEY", "test-secret")
from werkzeug.security import generate_password_hash  # noqa: E402

import captcha  # noqa: E402
import pins  # noqa: E402
from data import phase_data, records_api, site_api  # noqa: E402
from main import app  # noqa: E402

TMP = tempfile.mkdtemp(prefix="sac-test-")
PIN_YAML = f"""pin_length: 4
pins:
  - name: boss
    role: admin
    hash: "{generate_password_hash('1234')}"
  - name: field
    role: viewer
    hash: "{generate_password_hash('5678')}"
"""
SEED = open(os.path.join(ROOT, "data", "phase_data_seed.csv"), "rb").read()
XRW = {"X-Requested-With": "sac"}


def captcha_for(client):
    client.get("/sac")
    with client.session_transaction() as s:
        return str(s[captcha._CAPTCHA_ANSWER_KEY]), s[captcha._CAPTCHA_NONCE_KEY]


def login(client, pin="1234", next_url=""):
    a, n = captcha_for(client)
    return client.post("/sac/login", headers=XRW, json={"pin": pin, "captcha_answer": a, "captcha_nonce": n, "next": next_url})


class Base(unittest.TestCase):
    def setUp(self):
        shutil.rmtree(TMP, ignore_errors=True)
        os.makedirs(TMP)
        with open(os.path.join(TMP, "pin.yaml"), "w") as f:
            f.write(PIN_YAML)
        self._env = {k: os.environ.get(k) for k in ("PIN_FILE", "PHASE_DATA_CSV")}
        os.environ["PIN_FILE"] = os.path.join(TMP, "pin.yaml")
        os.environ["PHASE_DATA_CSV"] = os.path.join(TMP, "store", "phase_data.csv")
        pins.invalidate()
        phase_data.invalidate_cache()
        captcha._failures.clear()
        self.c = app.test_client()

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        pins.invalidate()
        phase_data.invalidate_cache()


class Routes(Base):
    def test_public_dashboard_and_old_page(self):
        r = self.c.get("/sac")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"Swachha Andhra Corporation", r.data)
        self.assertIn(b"Built by Advitia Labs", r.data)
        self.assertNotIn(b'id="login" ', r.data.replace(b'id="login" hidden', b""))  # popup closed by default
        self.assertEqual(self.c.get("/sac-old").status_code, 200)

    def test_login_query_opens_popup_with_pin_boxes(self):
        r = self.c.get("/sac?login=1")
        self.assertNotIn(b'id="login" hidden', r.data)
        self.assertEqual(r.data.count(b'aria-label="PIN digit'), 4)

    def test_signed_out_redirects_to_popup(self):
        for path in ("/sac/portal", "/reports", "/login?next=/reports"):
            r = self.c.get(path)
            self.assertIn(r.status_code, (302, 303), path)
            self.assertIn("/sac?login=1", r.headers["Location"], path)


class Login(Base):
    def test_right_pin_signs_in_everywhere(self):
        r = login(self.c)
        self.assertTrue(r.get_json()["ok"])
        self.assertEqual(r.get_json()["next"], "/sac/portal")
        self.assertEqual(self.c.get("/sac/portal").status_code, 200)
        self.assertEqual(self.c.get("/reports").status_code, 200)
        self.assertNotIn(b'name="pin"', self.c.get("/rdf/").data)   # RDF report, not its PIN page

    def test_next_is_kept_but_only_same_site(self):
        self.assertEqual(login(self.c, next_url="/rdf/").get_json()["next"], "/rdf/")
        self.c = app.test_client()
        self.assertEqual(login(self.c, next_url="//evil.example").get_json()["next"], "/sac/portal")

    def test_wrong_pin_counts_down_then_locks(self):
        r = login(self.c, pin="0000")
        self.assertEqual(r.status_code, 401)
        self.assertIn("4 tries left", r.get_json()["error"])
        for _ in range(4):
            r = login(self.c, pin="0000")
        self.assertEqual(r.status_code, 429)
        self.assertEqual(login(self.c).status_code, 429)   # right PIN still blocked

    def test_wrong_captcha_never_checks_pin(self):
        self.c.get("/sac")
        with self.c.session_transaction() as s:
            n = s[captcha._CAPTCHA_NONCE_KEY]
        r = self.c.post("/sac/login", headers=XRW, json={"pin": "1234", "captcha_answer": "9999", "captcha_nonce": n})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(captcha._failures)

    def test_post_needs_our_header(self):
        a, n = captcha_for(self.c)
        r = self.c.post("/sac/login", json={"pin": "1234", "captcha_answer": a, "captcha_nonce": n})
        self.assertEqual(r.status_code, 400)

    def test_rdf_form_uses_same_pins(self):
        self.c.get("/rdf/")
        with self.c.session_transaction() as s:
            a, n = str(s[captcha._CAPTCHA_ANSWER_KEY]), s[captcha._CAPTCHA_NONCE_KEY]
        self.c.post("/rdf/login", data={"pin": "5678", "captcha_answer": a, "captcha_nonce": n})
        self.assertEqual(self.c.get("/sac/portal").status_code, 200)

    def test_logout_signs_out_everywhere(self):
        login(self.c)
        self.c.get("/sac/logout")
        self.assertEqual(self.c.get("/reports").status_code, 302)
        self.assertIn(b'name="pin"', self.c.get("/rdf/").data)

    def test_builtin_pin_without_pin_file(self):
        os.environ["PIN_FILE"] = os.path.join(TMP, "missing.yaml")
        saved = os.environ.pop("SAC_PIN_HASH", None)
        try:
            pins.invalidate()
            b = pins.book()
            self.assertEqual((b.source, b.length, b.pins[0].role), ("builtin", 4, "admin"))
            self.assertEqual(b.pins[0].hash, pins.BUILTIN_PIN_HASH)
            self.assertTrue(pins.BUILTIN_PIN_HASH.startswith("scrypt:"))
        finally:
            if saved is not None:
                os.environ["SAC_PIN_HASH"] = saved

    def test_bad_pin_file_is_reported(self):
        with self.assertRaises(ValueError):
            pins.parse("pins:\n  - name: x\n    role: boss\n    hash: scrypt:1")


class Upload(Base):
    def _file(self, raw=SEED, name="sheet.csv"):
        return {"file": (io.BytesIO(raw), name)}

    def test_viewer_cannot_upload(self):
        login(self.c, pin="5678")
        r = self.c.post("/sac/api/upload/preview", headers=XRW, data=self._file(), content_type="multipart/form-data")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn(b'data-go="upload"', self.c.get("/sac/portal").data)

    def test_preview_flags_rows(self):
        login(self.c)
        d = self.c.post("/sac/api/upload/preview", headers=XRW, data=self._file(), content_type="multipart/form-data").get_json()
        self.assertTrue(d["ok"])
        self.assertEqual(d["total"], 291)
        self.assertTrue(any("Material total is far above" in i["msg"] for i in d["issues"]))

    def test_missing_columns_refused(self):
        login(self.c)
        r = self.c.post("/sac/api/upload/preview", headers=XRW, data=self._file(b"location,phase\nA,Phase 2\n"),
                        content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)
        self.assertIn("agency_name", r.get_json()["error"])

    def test_publish_replaces_sheet_and_skips_rows(self):
        login(self.c)
        raw = (b"location,site_name,phase,agency_name,target_mt,remediated_mt\n"
               b"Alpha,Alpha,Phase 2,Acme,\"1,000\",500\n"
               b"Beta,Beta,Phase 1,Acme,200,200\n"
               b"Gamma,Gamma,,Acme,50,50\n")
        d = self.c.post("/sac/api/upload/publish", headers=XRW, data={**self._file(raw), "skip": json.dumps([3])},
                        content_type="multipart/form-data").get_json()
        self.assertTrue(d["ok"])
        self.assertEqual(d["published"], 1)                 # Beta skipped, Gamma has no phase
        self.assertEqual([r[0] for r in phase_data.sheet().rows], ["Alpha"])
        self.assertTrue(d["updated"].startswith("Updated "))
        self.assertIn(b"Updated ", self.c.get("/sac").data)

    def test_script_json_is_escaped(self):
        login(self.c)
        raw = (b"location,site_name,phase,agency_name,target_mt,remediated_mt\n"
               b"\"</script><b>x\",S,Phase 2,Acme,10,5\n")
        self.c.post("/sac/api/upload/publish", headers=XRW, data={**self._file(raw), "skip": "[]"}, content_type="multipart/form-data")
        self.assertNotIn(b"</script><b>", self.c.get("/sac/portal").data)


class Aggregates(unittest.TestCase):
    def test_seed_totals(self):
        rows = [tuple(i.row) for i in phase_data.parse(SEED) if not i.locked]
        slides = {s["key"]: s for s in phase_data.dashboard(rows)["slides"]}
        self.assertEqual([s for s in slides], ["all", "p3", "p2", "p1", "p1x", "old"])
        self.assertEqual(round(slides["p3"]["t"]), 4227872)
        self.assertEqual(slides["p3"]["sites"], 50)
        self.assertEqual(slides["all"]["sites"], 133)
        self.assertEqual(len(slides["all"]["agencies"]), 18)


class Live(Base):
    def setUp(self):
        super().setUp()
        self._fv, self._q = records_api.get_filter_values, site_api.query_records
        records_api.get_filter_values = lambda: {"filters": {"sites": ["Kadiri", " Tharuni Kadiri", "Kadiri"]}}
        self.calls = []

        def q(names, start=None, end=None, *a, **k):
            self.calls.append((names, start, end))
            mk = lambda site, t: {"date": end, "time": t, "site_name": site, "ticket_no": t, "vehicle_no": "AP1",  # noqa: E731
                                  "material_type": "Soil", "net_weight_mt": 1.5, "image_slots": ["first_front"]}
            return [mk("Kadiri", "T2"), mk("Tharuni Kadiri", "T1")]
        site_api.query_records = q

    def tearDown(self):
        records_api.get_filter_values, site_api.query_records = self._fv, self._q
        super().tearDown()

    def test_needs_sign_in(self):
        self.assertEqual(self.c.get("/sac/api/live/sites").status_code, 401)
        self.assertEqual(self.c.get("/sac/api/live/records?site=Kadiri").status_code, 401)

    def test_sites_and_exact_site_records(self):
        login(self.c, pin="5678")
        self.assertEqual(self.c.get("/sac/api/live/sites").get_json()["sites"], ["Kadiri", "Tharuni Kadiri"])
        d = self.c.get("/sac/api/live/records?site=Kadiri&from=2026-11-01&to=2026-11-03").get_json()
        self.assertEqual(d["trips"], 1)                     # "Tharuni Kadiri" dropped
        self.assertEqual(d["records"][0]["image_slots"], ["first_front"])
        self.assertEqual(self.calls[-1], (("Kadiri",), "2026-11-01", "2026-11-03"))

    def test_date_window_is_capped(self):
        login(self.c)
        self.c.get("/sac/api/live/records?site=Kadiri&from=2026-01-01&to=2026-11-17")
        self.assertEqual(self.calls[-1][1], "2026-10-18")   # 31 days ending on the 17th

    def test_photos_open_for_pin_users(self):
        login(self.c, pin="5678")
        from views import record_images
        with app.test_request_context():
            from flask import session
            session["auth_user"] = "pin:field"
            self.assertTrue(record_images._authorized("Kadiri"))


if __name__ == "__main__":
    unittest.main()
