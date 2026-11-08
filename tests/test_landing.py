"""Landing page + routing contract.

    python -m unittest discover -s tests -v

Stdlib only (no pytest in requirements.txt).
"""
from __future__ import annotations

import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SECRET_KEY", "test-only")

from main import app  # noqa: E402


class LandingTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.c = app.test_client()

    def test_root_and_main_serve_pitch_page(self):
        for path in ("/", "/main", "/main/"):
            r = self.c.get(path, base_url="https://advitiaum.com")
            self.assertEqual(r.status_code, 200, path)
            body = r.get_data(as_text=True)
            self.assertIn("One ledger. Two jobs.", body)
            self.assertIn("Four ways every site makes money.", body)
            self.assertIn("RDF as alternative fuel", body)
            self.assertIn("Every tonne, accounted for.", body)
            self.assertIn('rel="canonical" href="https://advitiaum.com/"', body)
            self.assertIn("script-src 'self'", r.headers["Content-Security-Policy"])
            self.assertEqual(r.headers["X-Frame-Options"], "DENY")

    def test_no_inline_scripts_so_csp_holds(self):
        body = self.c.get("/").get_data(as_text=True)
        for tag in re.findall(r"<script\b[^>]*>", body):
            self.assertTrue("src=" in tag or "application/ld+json" in tag, tag)

    def test_every_referenced_landing_asset_exists(self):
        body = self.c.get("/").get_data(as_text=True)
        paths = set(re.findall(r'(?:href|src)="(/static/landing/[^"?]+)', body))
        self.assertGreaterEqual(len(paths), 7)
        for p in paths:
            self.assertTrue(os.path.isfile(os.path.join(ROOT, p.lstrip("/"))), p)

    def test_contact_email_everywhere(self):
        body = self.c.get("/").get_data(as_text=True)
        self.assertNotIn("advitia.com", body)
        self.assertIn("mailto:wecare@advitiaum.com", body)

    def test_dashboard_moved_to_sac(self):
        with app.test_request_context():
            from flask import url_for
            self.assertEqual(url_for("overview"), "/sac")
        rules = {r.rule: r.endpoint for r in app.url_map.iter_rules()}
        self.assertEqual(rules["/sac"], "overview")
        self.assertEqual(rules["/"], "landing.index")

    def test_rdf_host_root_still_serves_rdf_report(self):
        r = self.c.get("/", base_url="https://rdf.advitiaum.com")
        self.assertNotIn("One ledger. Two jobs.", r.get_data(as_text=True))

    def test_existing_endpoints_untouched(self):
        rules = {r.rule for r in app.url_map.iter_rules()}
        for rule in ("/healthz", "/login", "/logout", "/reports", "/sites/<slug>",
                     "/rdf_report/", "/rdf_planning/", "/admin/refresh-cache"):
            self.assertIn(rule, rules)
        self.assertEqual(self.c.get("/healthz").status_code, 200)


if __name__ == "__main__":
    unittest.main()
