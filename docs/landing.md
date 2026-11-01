# Advitia Labs landing page (`/` and `/main`)

Built from the Claude Design export "Advitia Website v2". Canonical URL: `https://advitiaum.com/`.

## Files

| Path | What |
| --- | --- |
| `views/landing.py` | Blueprint. Serves `/` and `/main`, sets CSP + cache headers, computes the `?v=` asset hash. |
| `templates/landing/index.html` | All copy, server-rendered (readable without JS, indexable). |
| `static/landing/css/landing.css` | Tokens + styles. Edit colours/type here. |
| `static/landing/js/landing.js` | React islands: animated hero word, platform steps + site scene, ledger bar, forecast chart. |
| `static/landing/js/calculator.js` | Methane / CO₂ / credit calculator (vanilla JS). Factors at the top of the file. |
| `static/landing/vendor/` | React 18.3.1 UMD production builds (vendored: no CDN, no build step). |
| `static/landing/fonts/` | TeX Gyre Pagella woff2 (GUST Font License), a free Palatino-style face. |
| `static/landing/img/og.png` | 1200×630 link-preview image. |
| `tests/test_landing.py` | Routing contract + asset checks: `python -m unittest discover -s tests -v` |

## Editing content

- **Copy, traction numbers, email:** `templates/landing/index.html` (email is `CONTACT_EMAIL` in `views/landing.py`).
- **Step cards (7 legacy, 6 household):** `LEGACY`, `LEGACY_X` and `HH` arrays in `landing.js`.
- **Live site scene outputs/shares:** `OUT` in `landing.js`.
- **Calculator factors:** `CF` and `GWP` in `calculator.js`.

Figures in the dashboard mock, the live scene and the calculator are illustrative and labelled as such on the page.
Traction figures (120+ sites, 12M MT, 400+ acres) are presented as real.

## Caching

`app.yaml` serves `/static/landing` with a 7-day cache. CSS/JS URLs carry `?v=<hash>`, so every deploy that
changes them busts caches. If you change a font, vendor file or image, give it a new filename.
The HTML itself is cached for 5 minutes.

## Behaviour notes

- Animations idle when off-screen; step autoplay pauses on mouse hover or keyboard focus, and on touch
  devices when the visitor taps a step ("Paused · tap to resume").
- `prefers-reduced-motion` gets a static hero word and no CSS animation.
- Each React island is wrapped in an error boundary; if one fails the rest of the page still works.
- Content-Security-Policy allows scripts only from this origin; don't add inline `<script>` blocks.
