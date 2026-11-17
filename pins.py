"""
One PIN for the whole Swachha Andhra area: /sac portal, /reports (old /login) and /rdf.

PINs live in a YAML file named by PIN_FILE (local path or gs:// URL, default
"pin.yaml" next to this file). The file holds HASHES only, never the PINs:

    pin_length: 4
    pins:
      - name: md-office
        role: admin          # admin: may upload the phase sheet; viewer: read only
        hash: "scrypt:32768:8:1$..."
      - name: field-team
        role: viewer
        hash: "scrypt:32768:8:1$..."

Make an entry with:   python pins.py add <name> <admin|viewer>
(it asks for the PIN twice and prints the YAML lines to paste).

Until a PIN file exists, ONE built-in 4-digit admin PIN works everywhere (its hash
is BUILTIN_PIN_HASH below; the PIN itself is not written in this public repo).
SAC_PIN_HASH (a werkzeug hash) overrides it without a code change.

The file is re-read every PIN_CACHE_SECONDS (default 300), so a new pin.yaml
on GCS takes effect within five minutes without a redeploy.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from werkzeug.security import check_password_hash, generate_password_hash

import config

logger = logging.getLogger(__name__)

ROLES = ("admin", "viewer")
_HERE = Path(__file__).resolve().parent
_CACHE_SECONDS = int(os.environ.get("PIN_CACHE_SECONDS", "300"))


@dataclass(frozen=True)
class Pin:
    name: str
    role: str
    hash: str


@dataclass(frozen=True)
class PinBook:
    pins: tuple[Pin, ...]
    length: int
    source: str          # "file", or "builtin" when there is no usable pin.yaml


# The interim PIN for /sac, /reports and /rdf until pin.yaml is set up.
BUILTIN_PIN_HASH = "scrypt:32768:8:1$sfQBT0uSwvNw9Vb4$1e26624a768e46a52e56e015678e74d63416d122462c27920a41666fff135574c274a83d28c8d429debe7a7192e95606a1f7933f18df3d3082b775f6606933ce"

_lock = Lock()
_cached: tuple[float, PinBook] | None = None


def _pin_file() -> str:
    return os.environ.get("PIN_FILE", "").strip() or str(_HERE / "pin.yaml")


def _read(path: str) -> str | None:
    if config.is_gcs_path(path):
        from google.cloud import storage  # type: ignore
        bucket, key = config.parse_gcs_path(path)
        blob = storage.Client().bucket(bucket).blob(key)
        return blob.download_as_text() if blob.exists() else None
    p = Path(path)
    return p.read_text(encoding="utf-8") if p.is_file() else None


def _builtin_hash() -> str:
    return os.environ.get("SAC_PIN_HASH", "").strip() or BUILTIN_PIN_HASH


def parse(text: str) -> PinBook:
    """Parse pin.yaml text. Raises ValueError with a readable message on bad input."""
    import yaml

    data = yaml.safe_load(text) or {}
    if not isinstance(data, dict):
        raise ValueError("pin file must be a mapping with a 'pins' list")
    length = int(data.get("pin_length") or 4)
    if not 4 <= length <= 8:
        raise ValueError("pin_length must be between 4 and 8")
    out = []
    for i, e in enumerate(data.get("pins") or [], 1):
        if not isinstance(e, dict):
            raise ValueError(f"pins entry {i} is not a mapping")
        name, role, h = str(e.get("name") or f"pin-{i}"), str(e.get("role") or "viewer").lower(), str(e.get("hash") or "")
        if role not in ROLES:
            raise ValueError(f"pins entry {i} ({name}): role must be admin or viewer")
        if not h.startswith(("scrypt:", "pbkdf2:")):
            raise ValueError(f"pins entry {i} ({name}): hash must come from `python pins.py add`")
        out.append(Pin(name, role, h))
    if not out:
        raise ValueError("pin file has no pins")
    return PinBook(tuple(out), length, "file")


def _load() -> PinBook:
    path = _pin_file()
    try:
        text = _read(path)
    except Exception:
        logger.exception("pins: could not read %s", path)
        text = None
    if text is not None:
        try:
            return parse(text)
        except Exception as exc:
            logger.error("pins: %s is invalid (%s); using the built-in PIN", path, exc)
    return PinBook((Pin("builtin", "admin", _builtin_hash()),), 4, "builtin")


def book() -> PinBook:
    global _cached
    with _lock:
        if _cached and _cached[0] > time.time():
            return _cached[1]
    b = _load()
    with _lock:
        _cached = (time.time() + _CACHE_SECONDS, b)
    return b


def invalidate() -> None:
    global _cached
    with _lock:
        _cached = None


def pin_length() -> int:
    return book().length


def verify(pin: str) -> Pin | None:
    """The matching Pin, or None. Checks every entry so timing does not reveal which one matched."""
    pin = (pin or "").strip()
    b = book()
    if not pin.isdigit() or len(pin) != b.length:
        return None
    found = None
    for p in b.pins:
        try:
            if check_password_hash(p.hash, pin) and found is None:
                found = p
        except Exception:
            logger.warning("pins: unreadable hash for %s", p.name)
    return found


def _main(argv: list[str]) -> int:
    import getpass

    if len(argv) != 3 or argv[0] != "add" or argv[2] not in ROLES:
        print("usage: python pins.py add <name> <admin|viewer>")
        return 2
    pin = getpass.getpass("PIN: ")
    if pin != getpass.getpass("PIN again: "):
        print("PINs did not match.")
        return 1
    if not pin.isdigit() or not 4 <= len(pin) <= 8:
        print("A PIN is 4 to 8 digits.")
        return 1
    print(f'  - name: {argv[1]}\n    role: {argv[2]}\n    hash: "{generate_password_hash(pin)}"')
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
