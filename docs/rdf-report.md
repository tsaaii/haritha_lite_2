# RDF disposal report — advitiaum.com/rdf

The daily RDF disposal report for Swachha Andhra Corporation, built from the Claude Design
handoff ("RDF Disposal Report").

**Open it:** `https://advitiaum.com/rdf`. Enter the 5-digit report PIN and answer the security
question. `/RDF` and the old `/rdf_report/` both lead here, and so does `https://rdf.advitiaum.com/`
once that subdomain is mapped (step 4 below).

**Tabs**

| Tab | What it shows |
| --- | --- |
| **Overview** | One-line status, headline tiles, site-group counts (each click opens that list in Sites), daily disposal by agency (stacked bars), the "Disposed so far" chart, top 5 quick wins, long haul and stalled sites, and the WhatsApp summary |
| **Agencies** | % done per agency against where it should be today (a straight line from the first day on file to 100% on the deadline), the projected finish date per agency at its 7-day pace, and the agency table. Click an agency to see its sites |
| **Sites** | Filter chips (All, Active, Stalled, Quick wins, Long haul, Cleared, and each agency), search, a sortable table with status tags, and a site × day activity heatmap |
| **Date range** | Pick From/To (or Last 7 / 14 days / Everything) to see each agency's MT disposed, MT/day, days with dispatch, sites that moved, and the balance at the start and end |
| **Report** | The printable sheet: exactly what the PDF contains. Ctrl/Cmd+P prints this tab from anywhere |

**Site groups** (set in `data/rdf_dashboard.py`, adjustable with environment variables):
- **Active**: sent RDF in the last 3 calendar days (`RDF_ACTIVE_DAYS`).
- **Stalled**: RDF left, but nothing sent for 7 or more days, or never (`RDF_STALLED_DAYS`).
- **Quick win**: 1,000 MT or less left (`RDF_QUICK_MT`).
- **Long haul**: at its last-7-day pace (`RDF_SITE_PACE_DAYS`), RDF is still left on the deadline.
- **Slowing**: sent something 3–6 days ago. **Cleared**: nothing left.

Pace and range figures are differences of the *cumulative* column, so a missing day never skews them.

**Daily use: one step.** Click the **gear icon**, then pick or drop the day's tracker CSV.
That single action does everything:
1. The sheet is checked, then stored under its "as on" date.
2. The report on screen updates in place: figures, graph (one more point) and tables.
3. The **WhatsApp summary** above the report updates, e.g.
   `1. Saurashtra sent RDF from Kurnool and Yemmiganur sites.`. Use **Copy** and paste it into
   WhatsApp, or **Open in WhatsApp**, which opens a new message with the text filled in.
4. The export-ready A4 PDF downloads as `Daily_RDF_tracker_DD-MM-YYYY.pdf`. The date is the
   sheet's own date, so `Daily_RDF_tracker-14-10-2026.csv` gives `Daily_RDF_tracker_14-10-2026.pdf`.

If a file isn't a tracker, the panel stays open and says why, and nothing changes.
**Save as PDF** downloads the same PDF again at any time.

| Piece | File |
| --- | --- |
| Routes, PIN + captcha sign-in, upload / gist API | `views/rdf_report.py` (registered in `main.py`) |
| CSV parsing + storage (local or GCS) + CLI | `data/rdf_tracker.py` |
| Report sheet figures, chart (SVG + shared marks), WhatsApp gist | `data/rdf_report.py` |
| Dashboard tabs: site groups, agency progress, projections, heatmap, date range | `data/rdf_dashboard.py` |
| Export-ready A4 PDF (ReportLab, vector) | `data/rdf_report_pdf.py` |
| Page / sheet partial / PIN page / styles / gear panel | `templates/rdf_report/`, `static/rdf_report/` |
| **Hardcoded history** (one sheet per day, deployed with the code) | `data/rdf_history/` |
| Tests | `tests/test_rdf_report.py` (`python -m unittest tests.test_rdf_report -v`) |

## How the data works

- **Two sources, one graph.** The graphs and tables are built from:
  1. **Built-in history** in `data/rdf_history/`, one CSV per day (now 1–13 Oct). This ships with
     the code, so it shows up on every deploy and needs no bucket setup.
  2. **Uploads** from the gear icon, stored in the bucket. Each upload adds one point to the graphs.

  If an upload has the same "as on" date as a built-in day, the upload wins. Removing that upload
  brings the built-in day back. In the gear panel, built-in days are labelled "built-in history"
  and have no Remove button.
- **Hardcoding more history**: put the sheets in `data/rdf_history/`, then commit and deploy:
  ```bash
  python -m data.rdf_tracker add-history ~/Downloads/Daily_RDF_tracker-*.csv   # files them as YYYY-MM-DD.csv
  git add data/rdf_history && git commit -m "RDF: add history" && gcloud app deploy app.yaml --quiet
  ```
  Uploading the same sheets from the gear icon also works, and needs no deploy.

- **Storage**: `RDF_TRACKER_DIR` (app.yaml) is `gs://advitia-weighbridge-data/rdf_report`. It holds:
  ```
  trackers/2026-10-13.csv      one file per day, named by the sheet's "as on Dt" date
  uploads/<time>_<file name>   every upload exactly as received (audit trail)
  ```
- **Which day a sheet belongs to**: the date in the `as on Dt: DD.MM.YYYY` header. A file named
  `Daily_RDF_tracker-14-10-2026.csv` reports **13 Oct**. If you upload a corrected sheet for a
  date that is already on file, it replaces that day. The gear panel says "replaced that day".
- **Figures** come straight from the latest sheet. *Today* is the "RDF disposed as on" column,
  *To date* is the "Cumulative RDF disposed" column, and *Left* is the "Balance RDF to be
  disposed" column. Nothing is estimated.
- **Graph**: one point per day on file: MT disposed each day (green), MT a day needed to clear
  by the deadline (red dashed), and MT left (dark).
- **Removing a day**: gear icon › Remove. The report updates in place. The raw upload stays in `uploads/`.
- **PDF**: generated on the server from the same figures and chart geometry as the page. It is
  ink-light like the design (colour only in text and lines) and has page numbers. The PDF uses
  Times because the Palatino files are not shipped, so its typeface differs slightly from the page.
- **WhatsApp summary**: lists every agency with RDF disposed on the report day, in alphabetical
  order, with its sites in alphabetical order. A site appears once even if the sheet splits it
  (`Kurnool 3.0 (Package 4)` and `Kurnool 2.0 (Additional Qty)` both become "Kurnool"; `Tirupati #26`
  becomes "Tirupati"). Agency short names are in `AGENCY_SHORT` in `data/rdf_report.py`. Site
  spellings come from the sheet.
- Every page load lists `trackers/` and re-reads only the files that changed, so an upload
  shows up immediately on every App Engine instance.

Settings (app.yaml `env_variables`, all optional): `RDF_DEADLINE` (default `2026-11-15`),
`RDF_PACE_DAYS` (3), `RDF_RECLAIM_COUNT` (10), and `RDF_EXTRA_AGENCIES` ("PR Constructions").
`RDF_EXTRA_AGENCIES` lists agencies that are shown before they appear in a tracker.

## Deploy on Google Cloud (App Engine, same app as advitiaum.com)

Run these from the repo root. You need `gcloud` signed in as a project owner.

```bash
# 0. Point gcloud at the project that serves advitiaum.com
gcloud config set project <PROJECT_ID>
gcloud app describe --format='value(defaultHostname)'     # sanity check

# 1. Let the app write to the bucket (it already reads sites_master.csv from it)
gcloud storage buckets add-iam-policy-binding gs://advitia-weighbridge-data \
  --member="serviceAccount:<PROJECT_ID>@appspot.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# 2. Deploy (the same command as the rest of the site), then open https://advitiaum.com/rdf
gcloud app deploy app.yaml --quiet

# 3. Optional: also serve it at rdf.advitiaum.com. App Engine issues and renews the HTTPS certificate itself.
gcloud app domain-mappings create rdf.advitiaum.com --certificate-management=AUTOMATIC
#    The command prints a DNS record. At your DNS provider for advitiaum.com, add:
#        Type CNAME   Name rdf   Value ghs.googlehosted.com.
#    Then wait for the certificate (usually 15–60 min):
gcloud app domain-mappings describe rdf.advitiaum.com     # sslSettings shows the certificate id once ready
```

If step 3 says the domain is not verified, run `gcloud domains verify advitiaum.com`, follow the
Search Console steps, and run step 3 again. If advitiaum.com is already mapped to this app, it
is already verified.

### Changing the PIN

The PIN is hardcoded, as requested: its hash is `_DEFAULT_PIN_HASH` in `views/rdf_report.py`.
To change it without editing code, set `RDF_REPORT_PIN_HASH` in app.yaml `env_variables` to the
output of `python -c "from werkzeug.security import generate_password_hash as g; print(g('NEW-PIN'))"`,
then redeploy.

## Run locally

```bash
source .venv/bin/activate
python main.py                              # http://localhost:8080/rdf
```

## Security notes

- There is one shared PIN, and anyone who has it can upload or remove days. Sign-in needs the PIN
  *and* a math captcha. Wrong PINs share the main login's lockout: 5 tries per IP, then 15 minutes
  blocked. Only the PIN's hash is in this public repo, but a 5-digit PIN can be recovered from its hash
  offline, so treat it as a light gate, not a secret.
- After sign-in, access is held in the Flask session cookie, which is signed with `SECRET_KEY`.
  **`SECRET_KEY` is committed in `app.yaml` in this public repo.** Anyone who reads it can forge
  a session and skip the PIN, and the same applies to the main `/login`. Rotate it and keep it
  out of git. For example, move `SECRET_KEY` into a git-ignored `secrets.yaml` that contains an
  `env_variables:` block, and add `includes: [secrets.yaml]` to app.yaml.
