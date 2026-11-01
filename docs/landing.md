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
| `views/landing_api.py` | `POST /api/contact` (lead form) and `POST /api/seen` (visit beacon). |
| `static/landing/js/contact.js`, `track.js` | Form validation/submit; visit tracker beacon. |
| `apps_script/landing/Code.gs` | Google Sheet + email backend for leads and visits. |
| `tests/` | `python -m unittest discover -s tests -v` and `node tests/landing_apps_script.test.js` |

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

## Contact form and visit tracker

Both go through one Google Apps Script (`apps_script/landing/Code.gs`) bound to a Google Sheet:

- **Leads** tab: one row per contact-form message. Every lead is also emailed to `NOTIFY_TO`
  (`wecare@advitiaum.com, saiteja7050@gmail.com`), with Reply-To set to the sender.
- **Visits** tab: one row per page view, with city / region / country / map link, network (ISP or company),
  anonymised IP, device, OS, browser, screen, language, time zone, referrer, UTM tags, `?r=` link,
  visitor ID + visit number, engaged seconds, scroll depth, sections reached, CTA clicks, platform tab and form status.

### One-time setup (about 10 minutes)

1. Create a Google Sheet called **Advitia website**, signed in as the account that should send the lead
   emails (e.g. `wecare@advitiaum.com`).
2. **Extensions → Apps Script**. Replace the code with `apps_script/landing/Code.gs`.
3. In `CONFIG`, set `TOKEN` to a long random string, for example the output of
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
4. Run **setup** once from the editor (pick `setup` in the function menu → Run). Approve the permissions
   (Sheets, send email, triggers). This creates both tabs and the daily 12-month retention cleanup.
5. **Deploy → New deployment → Web app**. Execute as: *Me*. Who has access: *Anyone*. Copy the `/exec` URL.
   Opening that URL in a browser should show `{"ok":true,"service":"advitia-landing",...}`.
6. In `app.yaml` set `LANDING_SCRIPT_URL` to the `/exec` URL and `LANDING_SCRIPT_TOKEN` to the same token.
7. Optional, recommended: sign up free at ipinfo.io, copy the token into `IPINFO_TOKEN`. This fills the
   **Network** column (e.g. "Reliance Jio", "Sequoia Capital Operations", "Amazon.com" → flagged as datacenter).
8. `gcloud app deploy app.yaml`, then submit the form once yourself and check the Sheet and your inbox.

When you change `Code.gs` later: **Deploy → Manage deployments → Edit → New version** (the URL stays the same).

### Tracking who opened your link

Send each person their own link: `https://advitiaum.com/?r=yc-garry`, `https://advitiaum.com/?r=sequoia-surge`.
The Visits row shows the `?r=` value, and you get an email "Link opened: yc-garry — San Francisco, CA, US"
the first time each visit starts (turn off with `NOTIFY_ON_LINK_OPEN: false`). The browser remembers the
first link, so a later visit without `?r=` still shows it under **First link ever**.
Use only letters, digits and `. _ - @ +` in the `r` value.

### What is filtered out

Crawlers and link-preview bots (they don't run JavaScript), headless/automated browsers (`navigator.webdriver`,
bot user agents), prerendered or background tabs (a view counts only after 1.5 s visible), and cross-site posts.
Visits from cloud networks (AWS, Google Cloud, Azure, …) are kept but marked **Datacenter? = yes**; most are
scrapers, but VPN users land there too.

### Privacy

IPs are anonymised before storage (IPv4 last octet zeroed, IPv6 /48). The full IP is only used in memory for the
network lookup and spam rate limits. The footer privacy note (`#privacy`) discloses this; visit rows older
than 12 months are deleted daily. If someone asks for deletion, filter the Visits tab by their Visitor ID or email.

### If the script is down or not configured

The form shows "We couldn't send that just now. Please email us at wecare@advitiaum.com", and every lead is
also written to Cloud Logging. Find them in Logs Explorer with `textPayload:"LANDING_LEAD"` (visits: `"LANDING_VISIT"`).
