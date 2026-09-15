# Field report apps — `/tharuni` and `/apurban`

Two mobile-first, offline-tolerant daily site report forms served by haritha_lite
(Flask, App Engine) at `https://advitiaum.com/tharuni/` and `https://advitiaum.com/apurban/`.
Data lands in Google Sheets in your Google Drive. Each brand gets its own Drive
folder, its own daily spreadsheet, its own site registry and its own PIN.

```
phone  --HTTPS-->  advitiaum.com/<brand>/api/*  (Flask, views/field.py)
                        |  POST {action, token, ...}
                        v
               Apps Script web app (one per brand)  --->  Drive folder + Sheets
```

## Files added to the repo

| Path | Purpose |
|---|---|
| `views/field.py` | Blueprint: pages, manifest, service worker, JSON proxy |
| `templates/field/{_head,form,pending}.html`, `templates/field/sw.js` | Pages + service worker template |
| `static/field/field.css`, `form.js`, `pending.js` | Shared UI |
| `static/field/tharuni/logo.png`, `static/field/apurban/logo.png` | Brand logos |
| `apps_script/field_report/Code.gs` | Google Apps Script backend (paste into two projects) |

## Repo changes (two edits)

**`main.py`** — register the blueprint:

```python
from views.field import bp as field_bp          # with the other view imports
...
    app.register_blueprint(record_images_bp)
    app.register_blueprint(field_bp)              # after record_images_bp
```

**`app.yaml`** — add under `env_variables:` (values come from steps 1–2 below):

```yaml
  TH_SCRIPT_URL: "https://script.google.com/macros/s/…/exec"
  TH_SCRIPT_TOKEN: "<long random string>"
  AP_SCRIPT_URL: "https://script.google.com/macros/s/…/exec"
  AP_SCRIPT_TOKEN: "<different long random string>"
  # optional: TH_CUTOFF / AP_CUTOFF (HH:mm, shown to operators; default 17:10)
```

Generate tokens with `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

## Step 1 — Apps Script for Tharuni (≈5 min)

1. Sign in to the Google account that should own the sheets. Go to **script.google.com → New project**, name it `Tharuni field report`.
2. Replace `Code.gs` with `apps_script/field_report/Code.gs`.
3. Edit `CONFIG` at the top:
   - `FOLDER_NAME: 'Tharuni_daily_reports'`, `REGISTRY_NAME: '_Tharuni_site_registry'`
   - `PIN: '43210'` (change if you like)
   - `TOKEN:` paste the value you will put in `TH_SCRIPT_TOKEN`
4. Select the `setupOnce` function → **Run** → approve Drive + Sheets permissions. The folder now exists in Drive.
5. **Deploy → New deployment → Web app**: Execute as **Me**, Who has access **Anyone** → Deploy. Copy the `/exec` URL into `TH_SCRIPT_URL`.

## Step 2 — Apps Script for AP Urban

Repeat step 1 in a **second** project named `AP Urban field report` with:
`FOLDER_NAME: 'APUrban_daily_reports'`, `REGISTRY_NAME: '_APUrban_site_registry'`,
`PIN: '98765'`, a different `TOKEN`. Copy its `/exec` URL into `AP_SCRIPT_URL`.

## Step 3 — Deploy haritha_lite

```bash
git add views/field.py templates/field static/field apps_script docs/field-apps.md main.py app.yaml
git commit -m "Add /tharuni and /apurban field report apps"
gcloud app deploy app.yaml --quiet
```

## Step 4 — Verify (2 min)

```bash
BASE=https://advitiaum.com
curl -s -o /dev/null -w "%{http_code}\n" $BASE/tharuni/            # 200
curl -s -o /dev/null -w "%{http_code}\n" $BASE/apurban/            # 200
curl -s $BASE/tharuni/api/sites                                    # {"ok":true,"sites":[]}
curl -s $BASE/apurban/api/sites                                    # {"ok":true,"sites":[]}
curl -s -X POST $BASE/apurban/api/status -H 'content-type: application/json' \
     -d '{"pin":"98765","date":"2026-09-15"}'                      # {"ok":true,...}
```

Then on a phone: open `https://advitiaum.com/apurban/`, send a test report,
confirm `APUrban_daily_reports/2026-09-15 - All Site Status` appears in Drive.
Open `https://advitiaum.com/apurban/pending`, enter `98765`, see the row.
Delete the test row from the sheet (or leave it — the next real report from the
same site replaces it).

If `/api/sites` returns a 502 mentioning "Anyone", the Apps Script deployment is
not public — redeploy with **Who has access: Anyone**.

## Step 5 — Roll out

- **Operators:** send the URL on WhatsApp. Chrome → ⋮ → **Add to Home screen**. After
  the first open, the form loads even with no signal; reports made offline are kept on the
  phone and sent when the phone is next online with the page open (or in the background
  when the app is reopened).
- **Office:** bookmark `/tharuni/pending` and `/apurban/pending`. The
  "Open this day's Google Sheet" link only works for people the folder is shared with —
  share `Tharuni_daily_reports` / `APUrban_daily_reports` with the office accounts.

## Updating later

- UI/proxy changes: edit the repo, `gcloud app deploy`. Every deploy gets a new
  `GAE_VERSION`, which becomes the service-worker cache key, so phones pick up the new
  shell on their next online open.
- Apps Script changes: edit in the editor, then **Deploy → Manage deployments → ✎ →
  Version: New version → Deploy**. The URL stays the same.

## Behaviour notes

- A second send from the same site on the same day **replaces** the earlier row.
- Anything not tapped in "Quantities" is recorded as 0.
- The sheet day is the day the report was **captured** on the phone (sent as `capturedAt`),
  so a report queued overnight lands in yesterday's sheet, not today's. Captures older than
  7 days or in the future fall back to the server date.
- Cut-off time is informational. Nothing is locked after it.
- Pending = every site that has ever reported (registry) minus sites in that day's sheet.
