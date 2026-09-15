"""
Hardcoded credentials for the dashboard.

To change credentials:
    1. Pick a new username.
    2. Generate a new password hash:
           >>> from werkzeug.security import generate_password_hash
           >>> generate_password_hash("your_new_password")
       Paste the result into PASSWORD_HASH below.
    3. Restart the app.

Default credentials below: admin / haritha2026
"""
from __future__ import annotations

from werkzeug.security import check_password_hash


# ---- Edit me to change credentials ----
USERNAME = "eng_sac"
PASSWORD_HASH = (
"scrypt:32768:8:1$TYioXJttp8XhgavQ$72d29ec64debf47f1013dbcdc5a6703245ea7e3f0ef35257d99eb408e58dd267c412b5a07e6cb1142bcbd6540e0dab42824691fa3033e76f4edbb4e9bd45f2ac"
)


def verify_credentials(username: str, password: str) -> bool:
    """True if (username, password) match the configured credentials.

    Username comparison is case-insensitive and whitespace-trimmed.
    """
    if not username or not password:
        return False
    if username.strip().lower() != USERNAME.lower():
        return False
    try:
        return check_password_hash(PASSWORD_HASH, password)
    except Exception:
        return False
