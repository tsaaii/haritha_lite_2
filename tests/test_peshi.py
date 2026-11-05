"""Meeting invite builder (/peshi): password + captcha sign-in, lockout, headers.

    python -m unittest tests.test_peshi -v
"""
from __future__ import annotations

import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.pop("PESHI_PASSWORD_HASH", None)   # test the built-in password

import captcha  # noqa: E402
from main import app  # noqa: E402

PASSWORD = "gideon4488"


def sign_in(client, password=PASSWORD, wrong_captcha=False):
    client.get("/peshi/")
    with client.session_transaction() as s:
        a, n = s[captcha._CAPTCHA_ANSWER_KEY], s[captcha._CAPTCHA_NONCE_KEY]
    return client.post("/peshi/login", data={
        "password": password, "captcha_answer": str(a + 1 if wrong_captcha else a), "captcha_nonce": n})


class PeshiTest(unittest.TestCase):
    def setUp(self):
        captcha._failures.clear()
        self.c = app.test_client()

    def test_redirects(self):
        for path in ("/peshi", "/PESHI", "/Peshi/"):
            r = self.c.get(path)
            self.assertEqual(r.status_code, 301, path)
            self.assertTrue(r.headers["Location"].endswith("/peshi/"), path)

    def test_login_page_hides_builder(self):
        r = self.c.get("/peshi/")
        self.assertEqual(r.status_code, 200)
        html = r.get_data(as_text=True)
        self.assertIn("Security check", html)
        self.assertNotIn("peshi.js", html)
        self.assertNotIn(PASSWORD, html)
        self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        self.assertIn("noindex", r.headers["X-Robots-Tag"])

    def test_sign_in_shows_builder_then_logout(self):
        r = sign_in(self.c)
        self.assertEqual(r.status_code, 302)
        html = self.c.get("/peshi/").get_data(as_text=True)
        self.assertIn("peshi.js", html)
        self.assertIn("For any queries, contact Gideon, PA to MD, SAC", html)
        self.c.get("/peshi/logout")
        self.assertNotIn("peshi.js", self.c.get("/peshi/").get_data(as_text=True))

    def test_wrong_captcha_never_checks_password(self):
        r = sign_in(self.c, wrong_captcha=True)
        self.assertEqual(r.status_code, 400)
        self.assertNotIn("peshi.js", self.c.get("/peshi/").get_data(as_text=True))
        self.assertFalse(captcha._failures)   # captcha misses don't count as password tries

    def test_wrong_password_locks_after_five(self):
        for i in range(captcha.MAX_FAILURES - 1):
            self.assertEqual(sign_in(self.c, "gideon").status_code, 401)
        self.assertEqual(sign_in(self.c, "gideon").status_code, 429)
        r = sign_in(self.c)                     # right password, still locked
        self.assertEqual(r.status_code, 429)
        self.assertIn("Retry-After", r.headers)

    def test_env_hash_overrides(self):
        from werkzeug.security import generate_password_hash
        os.environ["PESHI_PASSWORD_HASH"] = generate_password_hash("other-pass")
        try:
            self.assertEqual(sign_in(self.c).status_code, 401)
            self.assertEqual(sign_in(self.c, "other-pass").status_code, 302)
        finally:
            del os.environ["PESHI_PASSWORD_HASH"]


if __name__ == "__main__":
    unittest.main()
