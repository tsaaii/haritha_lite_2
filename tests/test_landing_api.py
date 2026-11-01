"""Contact form + visit tracker APIs (views/landing_api.py).

    python -m unittest discover -s tests -v
"""
from __future__ import annotations

import json
import os
import sys
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SECRET_KEY", "test-only")

from main import app  # noqa: E402
from views import landing_api as api  # noqa: E402

UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
GEO = {"X-Appengine-User-Ip": "49.36.12.77", "X-Appengine-City": "bengaluru", "X-Appengine-Region": "ka",
       "X-Appengine-Country": "IN", "X-Appengine-Citylatlong": "12.971599,77.594566"}


def token(age_s: float) -> str:
    with app.test_request_context():
        from itsdangerous import URLSafeTimedSerializer
        return URLSafeTimedSerializer(app.secret_key, salt="landing-contact-form").dumps(int(time.time() - age_s))


class Base(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.c = app.test_client()
        api.contact_limit = api.RateLimit(5, 3600)
        api.seen_limit = api.RateLimit(120, 600)
        p = mock.patch.object(api, "forward", return_value=(True, ""))
        self.fwd = p.start()
        self.addCleanup(p.stop)

    def h(self, **extra):
        return {"Origin": "https://advitiaum.com", "User-Agent": UA, **GEO, **extra}


class ContactTests(Base):
    def lead(self, **kw):
        d = {"name": "Garry Tan", "email": "garry@ycombinator.com", "interest": "investing",
             "details": "Saw the demo.", "website": "", "t": token(30), "ref": "yc-garry", "vid": "abc123"}
        d.update(kw)
        return d

    def post(self, data, headers=None):
        return self.c.post("/api/contact", json=data, base_url="https://advitiaum.com", headers=headers or self.h())

    def test_valid_lead_is_forwarded_with_anonymised_ip_and_geo(self):
        r = self.post(self.lead())
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertTrue(r.get_json()["ok"])
        action, lead = self.fwd.call_args[0]
        self.assertEqual(action, "lead")
        self.assertEqual(lead["ip"], "49.36.12.0")
        self.assertEqual((lead["city"], lead["region"], lead["country"]), ("Bengaluru", "IN-KA", "IN"))
        self.assertEqual(lead["interest"], "Investing")
        self.assertEqual(lead["ref"], "yc-garry")
        self.assertNotIn("49.36.12.77", json.dumps(lead))

    def test_cross_site_post_rejected(self):
        r = self.post(self.lead(), headers={**self.h(), "Origin": "https://evil.example"})
        self.assertEqual(r.status_code, 400)
        self.fwd.assert_not_called()

    def test_honeypot_and_too_fast_are_silently_dropped(self):
        for d in (self.lead(website="http://spam"), self.lead(t=token(0.5))):
            r = self.post(d)
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.get_json()["ok"])
        self.fwd.assert_not_called()

    def test_bad_or_expired_token(self):
        for t in ("garbage", token(3 * 24 * 3600)):
            self.assertEqual(self.post(self.lead(t=t)).status_code, 400)

    def test_field_validation(self):
        cases = [({"name": "G"}, "name"), ({"email": "nope"}, "email"), ({"email": "a@b"}, "email"),
                 ({"interest": "free-stuff"}, "interest"), ({"interest": "other", "details": ""}, "details")]
        for kw, field in cases:
            r = self.post(self.lead(**kw))
            self.assertEqual(r.status_code, 422, kw)
            self.assertEqual(r.get_json()["field"], field)
        self.fwd.assert_not_called()

    def test_upstream_down_gives_email_fallback(self):
        self.fwd.return_value = (False, "not-configured")
        r = self.post(self.lead())
        self.assertEqual(r.status_code, 502)
        self.assertIn("wecare@advitiaum.com", r.get_json()["error"])

    def test_rate_limit(self):
        codes = [self.post(self.lead()).status_code for _ in range(6)]
        self.assertEqual(codes, [200] * 5 + [429])

    def test_no_js_form_post_redirects_back(self):
        r = self.c.post("/api/contact", data=self.lead(), base_url="https://advitiaum.com", headers=self.h())
        self.assertEqual(r.status_code, 303)
        self.assertEqual(r.headers["Location"], "/?sent=1#contact")
        page = self.c.get("/?sent=1").get_data(as_text=True)
        self.assertIn('data-state="sent"', page)


class SeenTests(Base):
    def beacon(self, headers=None, **kw):
        d = {"event": "view", "visit_id": "AbCdEfGh12345678", "vid": "v1", "n": "2", "ref": "sequoia",
             "screen": "390x844", "path": "/?r=sequoia"}
        d.update(kw)
        return self.c.post("/api/seen", data=json.dumps(d), content_type="application/json",
                           base_url="https://advitiaum.com", headers=headers or self.h())

    def test_view_is_enriched(self):
        self.assertEqual(self.beacon().status_code, 204)
        action, rec = self.fwd.call_args[0]
        self.assertEqual(action, "visit")
        self.assertEqual(rec["ip"], "49.36.12.0")
        self.assertEqual(rec["city"], "Bengaluru")
        self.assertEqual(rec["latlng"], "12.971599,77.594566")
        self.assertEqual((rec["device"], rec["os"], rec["browser"]), ("Mobile", "iOS", "Safari"))
        self.assertEqual(rec["ref"], "sequoia")

    def test_update_carries_engagement_only(self):
        self.beacon(event="update", duration="95", scroll="80", sections="traction > platform")
        rec = self.fwd.call_args[0][1]
        self.assertEqual(rec["duration"], "95")
        self.assertNotIn("city", rec)

    def test_bots_and_junk_are_dropped(self):
        bot = {**self.h(), "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)"}
        headless = {**self.h(), "User-Agent": "Mozilla/5.0 HeadlessChrome/120"}
        no_origin = {k: v for k, v in self.h().items() if k != "Origin"}
        self.beacon(headers=bot)
        self.beacon(headers=headless)
        self.beacon(headers=no_origin)
        self.beacon(visit_id="x")              # malformed id
        self.beacon(event="purchase")          # unknown event
        self.fwd.assert_not_called()

    def test_inputs_are_capped(self):
        self.beacon(referrer="x" * 5000)
        self.assertLessEqual(len(self.fwd.call_args[0][1]["referrer"]), 300)


class HelperTests(unittest.TestCase):
    def test_anonymize(self):
        self.assertEqual(api.anonymize_ip("203.0.113.199"), "203.0.113.0")
        self.assertEqual(api.anonymize_ip("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd::/48")
        self.assertEqual(api.anonymize_ip("not-an-ip"), "")

    def test_page_has_form(self):
        body = app.test_client().get("/").get_data(as_text=True)
        self.assertIn('id="contact-form"', body)
        self.assertIn('name="t" value="', body)
        self.assertNotIn('id="privacy"', body)
        for key in api.INTERESTS:
            self.assertIn(f'value="{key}"', body)


if __name__ == "__main__":
    unittest.main()
