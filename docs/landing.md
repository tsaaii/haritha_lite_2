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

- **Leads** tab: one row per contact-form message. Each lead emails `NOTIFY_TO`
  (`wecare@advitiaum.com, saiteja7050@gmail.com`) with Reply-To set to the sender
  ([preview](img/email-lead-notification.png)), and the sender gets an automatic confirmation
  ([preview](img/email-auto-reply.png)) whose replies go to `REPLY_TO` (`wecare@advitiaum.com`).
- **Visits** tab: one row per page view (location, network, device, link, engagement).
- **Summary** tab: live tables (visits by country, top cities, opened `?r=` links, networks, devices,
  visits per day) and a world map. Bots and datacenter traffic are left out.

### Part A — Set up the form emails (about 10 minutes)

1. **Pick the sending account.** Emails are sent *from the Google account that owns the script*.
   Sign in as `wecare@advitiaum.com` if it is a Google Workspace mailbox; otherwise use
   `saiteja7050@gmail.com` (replies still go to wecare@ via `REPLY_TO`).
2. Go to <https://sheets.new> and name the sheet **Advitia website**.
3. **Extensions → Apps Script.** Delete the sample code, paste all of `apps_script/landing/Code.gs`, press **Save**.
4. In `CONFIG` at the top, replace `CHANGE-ME-long-random-string` with a long random string, e.g. the output of
   `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`. Keep a copy for step 8.
   Optional switches: `AUTO_REPLY` (confirmation to the sender), `NOTIFY_ON_LINK_OPEN`, `NOTIFY_TO`, `REPLY_TO`.
5. In the function menu next to **Debug**, choose **setup** → **Run**. Google asks for permission:
   *Review permissions → your account → Advanced → Go to (unsafe) → Allow* (the warning appears because the
   script is yours and unverified). This creates the Leads, Visits and Summary tabs and the daily cleanup.
6. **Deploy → New deployment →** gear icon **→ Web app**. Description `website`, Execute as **Me**,
   Who has access **Anyone**. **Deploy**, then copy the **Web app URL** (ends in `/exec`).
7. Open that URL in a browser. You should see `{"ok":true,"service":"advitia-landing","build":"2026-11-01-v2"}`.
8. In `app.yaml` set:
   ```yaml
   LANDING_SCRIPT_URL: "https://script.google.com/macros/s/…/exec"
   LANDING_SCRIPT_TOKEN: "<the same string as CONFIG.TOKEN>"
   ```
9. `gcloud app deploy app.yaml`.
10. **Test:** open <https://advitiaum.com/#contact>, send a message using an address you can read.
    Within a minute: a row in **Leads**, a "New lead" email in both inboxes, and the confirmation in the
    address you entered. Nothing arrived? See *Troubleshooting* below.

After any later change to `Code.gs`: **Deploy → Manage deployments → pencil → Version: New version → Deploy**
(the URL stays the same; check step 7 shows the new `build`).

### Part B — Use the location tracker

1. **Optional, adds company / ISP names:** sign up free at <https://ipinfo.io/signup>, copy the token from the
   dashboard into `IPINFO_TOKEN` in `app.yaml`, redeploy. Without it everything works except the Network column.
2. **Make a link per person** you send the site to: `https://advitiaum.com/?r=yc-garry`,
   `https://advitiaum.com/?r=greenfund-priya`. Letters, digits and `. _ - @ +` only.
3. **Open the site yourself** (once, from your phone) to check it works. A row appears in **Visits** after
   about 2 seconds; the engagement columns fill in when you leave or switch tabs.
4. **Summary tab:** the world map and tables update on their own. Read it top-down: *Opened links* shows who
   opened their link and when it was last opened; *Top cities* and *Top networks* show where everyone else is.
5. **Visits tab, to dig into one visitor:** select row 1 → **Data → Create a filter**. Filter
   *Link (?r=)* to one person to see each visit, how long they stayed (*Engaged (s)*), how far they scrolled and
   which sections they read. Click **map** in a row to see the location. Filter *Datacenter?* to hide `yes` rows.
6. **Get alerts on your phone:** each `?r=` link opening already emails you. Install the Google Sheets app to
   check the Summary tab on the go.
7. **Your own visits:** open the site once with `?r=me` from each of your devices, then filter out *Visitor ID*s
   that show `me` under *First link ever*.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| Form says "We couldn't send that just now" | `LANDING_SCRIPT_URL` empty or wrong, or the token differs from `CONFIG.TOKEN`. Check step 7 and redeploy. |
| Row in Leads but no email | The script owner hit Gmail's daily quota (≈100 recipients/day on a personal account, 1,500 on Workspace), or the mail is in Spam. Apps Script editor → **Executions** shows the error. |
| No rows in Visits | Ad blockers can block the beacon for some visitors; ensure the deploy has `track.js`. Logs Explorer `textPayload:"LANDING_VISIT"` shows what the server received. |
| Network column empty | `IPINFO_TOKEN` not set, or the free quota is exhausted. |
| City empty | App Engine could not geolocate that IP (common for some mobile carriers); country is usually still set. |

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
