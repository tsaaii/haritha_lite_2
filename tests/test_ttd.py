"""TTD dashboard (/TTD): sign-in with captcha and lockout, figures, reports, PDF, camera pass-through.

The Adex cloud API is faked at the HTTP layer (requests.get), so these tests run offline.

    python -m unittest tests.test_ttd -v
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SECRET_KEY", "test-secret")

import captcha  # noqa: E402
from main import app  # noqa: E402
from views import ttd  # noqa: E402

TODAY = ttd._today()
D1 = (TODAY - timedelta(days=1)).isoformat()
D0 = TODAY.isoformat()
JPEG = b"\xff\xd8" + b"x" * 100


SEEN_PARAMS: list = []


class FakeResp:
    def __init__(self, status=200, json_body=None, content=b"", headers=None):
        self.status_code, self._j, self.content, self.headers = status, json_body, content, headers or {}

    def json(self):
        return self._j

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def fake_adex(url, params=None, headers=None, timeout=None):
    """Stands in for the Adex cloud API (adex-lite3/cloud)."""
    assert headers.get("X-Api-Key") == "read-key", "the read key must be sent from the server"
    path = url.split("/v1/sites/ttd/", 1)[1]
    params = params or {}
    if path == "totals":
        return FakeResp(json_body={"site": "ttd", "trips": 40, "net_kg": 1_000_000, "pending": 1, "materials": {
            "MSW": {"trips": 30, "net_kg": 12_825_500}, "Soil": {"trips": 5, "net_kg": 4_100_250},
            "Inert": {"trips": 2, "net_kg": 900_000}, "CnD": {"trips": 1, "net_kg": 300_000},
            "RDF": {"trips": 1, "net_kg": 1_250_000}, "Scrap": {"trips": 1, "net_kg": 12_340}}})
    if path == "summary":
        days = [
            {"date": D1, "trips": 3, "pending": 0, "net_kg": 9000,
             "by_material": {"MSW": {"trips": 2, "net_kg": 7000}, "Soil": {"trips": 1, "net_kg": 2000}}},
            {"date": D0, "trips": 2, "pending": 1, "net_kg": 5500,
             "by_material": {"MSW": {"trips": 1, "net_kg": 4500}, "Weird": {"trips": 1, "net_kg": 1000}}},
        ]
        days = [d for d in days if params["from"] <= d["date"] <= params["to"]]
        return FakeResp(json_body={"days": days})
    if path == "live/state":
        return FakeResp(json_body={"plant_online": True, "weight": {"connected": True, "weight": 9620, "stable": True},
                                   "cams": [["front", "Front camera"]], "max_minutes": 10})
    if path == "live/front.jpg":
        return FakeResp(content=JPEG, headers={"X-Age": "0.4"})
    if path == "live/back.jpg":
        return FakeResp(status=204)
    if path == "live/cam3.jpg":
        SEEN_PARAMS.append(dict(params))
        return FakeResp(content=JPEG, headers={"X-Age": "0.2"})
    if path == "live/cam9.jpg":
        return FakeResp(status=410, json_body={"detail": "Viewing stopped after 5 minutes. Click Watch to see it again."})
    return FakeResp(status=404, json_body={"detail": "no"})


ENV = {"ADEX_API_URL": "https://adex.example.run.app", "TTD_SITE_ID": "ttd", "TTD_READ_KEY": "read-key"}


class TTDBase(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.c = app.test_client()
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        self.http = mock.patch("views.ttd.requests.get", side_effect=fake_adex)
        self.http.start()
        ttd._cache.clear()
        captcha._failures.clear()

    def tearDown(self):
        self.http.stop()
        self.env.stop()

    def captcha_answer(self):
        with self.c.session_transaction() as s:
            return str(s[captcha._CAPTCHA_ANSWER_KEY]), s[captcha._CAPTCHA_NONCE_KEY]

    def login(self, user="admin-ttd", pw="ttd@tirumala", answer=None):
        self.c.get("/TTD")
        a, n = self.captcha_answer()
        return self.c.post("/TTD", data={"username": user, "password": pw, "captcha_answer": answer or a,
                                         "captcha_nonce": n})


class TestSignIn(TTDBase):
    def test_login_page_has_both_logos_and_captcha(self):
        r = self.c.get("/TTD")
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn("ttd/tharuni.png", html)
        self.assertIn("ttd/ttd.png", html)
        self.assertIn('name="captcha_answer"', html)
        self.assertIn("script-src 'self'", r.headers["Content-Security-Policy"])
        self.assertNotIn("<script>", html)          # no inline scripts, so the CSP holds
        self.assertEqual(r.headers["X-Frame-Options"], "DENY")

    def test_lowercase_path_redirects(self):
        r = self.c.get("/ttd")
        self.assertEqual(r.status_code, 301)
        self.assertTrue(r.headers["Location"].endswith("/TTD"))

    def test_correct_login_opens_dashboard(self):
        r = self.login()
        self.assertEqual(r.status_code, 302)
        page = self.c.get("/TTD").get_data(as_text=True)
        self.assertIn("Awarded legacy quantity", page)
        self.assertIn("51,290", page)
        self.assertIn("Live cameras", page)

    def test_username_case_insensitive(self):
        self.assertEqual(self.login(user="  ADMIN-TTD ").status_code, 302)

    def test_wrong_captcha_rejected_before_password(self):
        r = self.login(answer="99999")
        self.assertEqual(r.status_code, 400)
        self.assertIn("sum was not right", r.get_data(as_text=True))
        self.assertEqual(captcha._failures, {})     # captcha failure does not touch the password counter

    def test_wrong_password_then_lockout(self):
        for _ in range(captcha.MAX_FAILURES - 1):
            self.assertEqual(self.login(pw="wrong").status_code, 401)
        r = self.login(pw="wrong")
        self.assertEqual(r.status_code, 429)
        r = self.login()                             # even the right password is refused while locked
        self.assertEqual(r.status_code, 429)
        self.assertIn("Too many failed attempts", r.get_data(as_text=True))

    def test_captcha_cannot_be_replayed(self):
        self.c.get("/TTD")
        a, n = self.captcha_answer()
        self.c.post("/TTD", data={"username": "x", "password": "y", "captcha_answer": a, "captcha_nonce": n})
        r = self.c.post("/TTD", data={"username": "admin-ttd", "password": "ttd@tirumala",
                                      "captcha_answer": a, "captcha_nonce": n})
        self.assertEqual(r.status_code, 400)

    def test_main_dashboard_login_does_not_open_ttd(self):
        with self.c.session_transaction() as s:
            s["auth_user"] = "eng_sac"
        self.assertEqual(self.c.get("/TTD/api/overview").status_code, 401)

    def test_logout(self):
        self.login()
        self.c.get("/TTD/logout")
        self.assertEqual(self.c.get("/TTD/api/overview").status_code, 401)

    def test_password_hash_override(self):
        from werkzeug.security import generate_password_hash
        with mock.patch.dict(os.environ, {"TTD_PASSWORD_HASH": generate_password_hash("new-pass-1")}):
            self.assertEqual(self.login().status_code, 401)
            captcha._failures.clear()
            self.assertEqual(self.login(pw="new-pass-1").status_code, 302)


class TestData(TTDBase):
    def setUp(self):
        super().setUp()
        self.login()

    def test_everything_needs_sign_in(self):
        anon = app.test_client()
        for p in ("/TTD/api/overview", "/TTD/api/report", "/TTD/api/live/state", "/TTD/api/live/front.jpg",
                  "/TTD/report.pdf"):
            self.assertEqual(anon.get(p).status_code, 401, p)

    def test_overview_figures(self):
        o = self.c.get("/TTD/api/overview").get_json()
        self.assertEqual(o["awarded_mt"], 51290)
        self.assertEqual(o["processed_mt"], 12825.5)                 # MSW = legacy inward, all time
        self.assertEqual(o["balance_mt"], round(51290 - 12825.5, 2))
        self.assertEqual(o["pct"], 25.0)
        self.assertEqual(o["disposed"], {"Soil": 4100.25, "Inert": 900.0, "CnD": 300.0, "RDF": 1250.0, "Scrap": 12.34})
        self.assertEqual(o["trips_today"], 3)                          # 2 complete + 1 awaiting empty weight
        self.assertEqual(o["trips_today_complete"], 2)
        self.assertEqual(o["inward_today_mt"], 4.5)
        # Climate impact, by hand: CH4/t = 0.8*0.06*0.5*0.5*16/12 = 0.016; 12,825.5 MT -> 205.208 t CH4
        # -> x28 = 5,745.824 t CO2e -> /0.060 = 95,764 trees; x0.85 = 4,884 credits; RDF 1,250 x 0.5 = 625 t plastic
        i = o["impact"]
        self.assertEqual((i["ch4_t"], i["co2e_t"], i["trees"], i["carbon_credits"], i["epr_plastic_t"]),
                         (205.2, 5745.8, 95764, 4884, 625.0))
        self.assertEqual(i["inputs"]["ch4_per_t"], 0.016)

    def test_impact_factors_configurable_and_safe(self):
        with mock.patch.dict(os.environ, {"TTD_CH4_DOC": "0.12", "TTD_RDF_PLASTIC_SHARE": "0.6", "TTD_GWP_CH4": "oops"}):
            i = ttd.impact(1000, 100)
        self.assertEqual(i["factors"]["doc"], 0.12)
        self.assertEqual(i["factors"]["gwp"], 28.0)                     # bad value -> default, no crash
        self.assertEqual(i["ch4_t"], 32.0)                              # 1000 x 0.032
        self.assertEqual(i["epr_plastic_t"], 60.0)
        self.assertEqual(ttd.impact(0, 0)["trees"], 0)

    def test_impact_tiles_on_page(self):
        body = self.c.get("/TTD").get_data(as_text=True)
        for tid in ("i-trees", "i-ch4", "i-co2e", "i-cc", "i-epr", "tip-trees", "tip-ch4", "tip-cc", "tip-epr"):
            self.assertIn(f'id="{tid}"', body)
        self.assertNotIn("earned", body.lower())                        # potential, never claimed as earned

    def test_day_report_fills_every_day_and_totals(self):
        r = self.c.get(f"/TTD/api/report?view=day&from={D1}&to={D0}").get_json()
        self.assertEqual([x["key"] for x in r["rows"]], [D1, D0])
        self.assertEqual(r["rows"][0]["MSW"], 7.0)
        self.assertEqual(r["rows"][0]["Soil"], 2.0)
        self.assertEqual(r["rows"][1]["Others"], 1.0)                  # unknown material lands in Others
        self.assertEqual(r["total"]["trips"], 5)
        self.assertEqual(r["total"]["disposed"], 2.0)

    def test_month_report_groups(self):
        frm = (TODAY - timedelta(days=40)).isoformat()
        r = self.c.get(f"/TTD/api/report?view=month&from={frm}&to={D0}").get_json()
        keys = [x["key"] for x in r["rows"]]
        self.assertEqual(keys, sorted(set(keys)))
        self.assertTrue(all(len(k) == 7 for k in keys))
        self.assertEqual(r["total"]["MSW"], 11.5)
        self.assertEqual(keys[0], D1[:7])                              # no empty months before the first trip

    def test_report_range_limits_and_bad_view(self):
        self.assertEqual(self.c.get("/TTD/api/report?view=year").status_code, 400)
        old = (TODAY - timedelta(days=400)).isoformat()
        self.assertEqual(self.c.get(f"/TTD/api/report?view=day&from={old}&to={D0}").status_code, 400)
        self.assertEqual(self.c.get(f"/TTD/api/report?view=month&from={old}&to={D0}").status_code, 200)

    def test_pdf(self):
        r = self.c.get(f"/TTD/report.pdf?view=day&from={D1}&to={D0}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data[:4], b"%PDF")
        self.assertIn("attachment", r.headers["Content-Disposition"])
        self.assertGreater(len(r.data), 20000)                        # both logos embedded

    def test_camera_pass_through(self):
        st = self.c.get("/TTD/api/live/state").get_json()
        self.assertTrue(st["plant_online"])
        r = self.c.get("/TTD/api/live/front.jpg?q=high")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data, JPEG)
        self.assertEqual(r.headers["X-Age"], "0.4")
        self.assertEqual(self.c.get("/TTD/api/live/back.jpg").status_code, 204)
        self.assertEqual(self.c.get("/TTD/api/live/..%2Fsecret.jpg").status_code, 404)
        self.assertEqual(self.c.get("/TTD/api/live/window.jpg").status_code, 404)

    def test_watch_starts_a_session_and_time_limit_passes_through(self):
        SEEN_PARAMS.clear()
        self.assertEqual(self.c.get("/TTD/api/live/cam3.jpg?q=low&start=1").status_code, 200)
        self.assertEqual(self.c.get("/TTD/api/live/cam3.jpg?q=low").status_code, 200)
        self.assertEqual(SEEN_PARAMS, [{"q": "low", "start": 1}, {"q": "low"}])   # only the Watch click starts one
        r = self.c.get("/TTD/api/live/cam9.jpg")
        self.assertEqual(r.status_code, 410)
        self.assertIn("Click Watch", r.get_json()["error"])

    def test_cameras_tab_does_not_autostart(self):
        js = open(os.path.join(app.static_folder, "ttd", "ttd.js"), encoding="utf-8").read()
        self.assertIn("start=1", js)
        page = self.c.get("/TTD").get_data(as_text=True)
        self.assertIn("Watch all", page)
        self.assertIn("only when you click Watch", page)

    def test_service_not_configured_or_down(self):
        with mock.patch.dict(os.environ, {"TTD_READ_KEY": ""}):
            ttd._cache.clear()
            r = self.c.get("/TTD/api/overview")
            self.assertEqual(r.status_code, 503)
            self.assertIn("not configured", r.get_json()["error"])
        import requests
        with mock.patch("views.ttd.requests.get", side_effect=requests.ConnectionError("down")):
            ttd._cache.clear()
            r = self.c.get("/TTD/api/overview")
            self.assertEqual(r.status_code, 503)
            self.assertIn("Can't reach", r.get_json()["error"])


class TestSecretManager(TTDBase):
    def test_read_key_from_secret_manager(self):
        import base64
        calls = []

        def fake(url, params=None, headers=None, timeout=None):
            calls.append(url)
            if "metadata.google.internal" in url:
                return FakeResp(json_body={"access_token": "tok"})
            if "secretmanager.googleapis.com" in url:
                assert headers["Authorization"] == "Bearer tok"
                return FakeResp(json_body={"payload": {"data": base64.b64encode(b"read-key\n").decode()}})
            return fake_adex(url, params, headers, timeout)

        ttd._secret.update(value=None, at=0)
        env = {"TTD_READ_KEY": "", "TTD_READ_KEY_SECRET": "projects/p/secrets/ttd-read-key/versions/latest"}
        with mock.patch.dict(os.environ, env), mock.patch("views.ttd.requests.get", side_effect=fake):
            self.login()
            r = self.c.get("/TTD/api/overview")
            self.assertEqual(r.status_code, 200, r.get_json())
            self.c.get("/TTD/api/live/state")
        self.assertEqual(sum("secretmanager" in u for u in calls), 1)   # fetched once, then cached
        ttd._secret.update(value=None, at=0)


class TestOtherPagesUntouched(unittest.TestCase):
    def test_existing_routes_still_registered(self):
        rules = {r.rule for r in app.url_map.iter_rules()}
        for p in ("/login", "/reports", "/sac", "/", "/healthz"):
            self.assertIn(p, rules)


if __name__ == "__main__":
    unittest.main()
