# RDF disposal report — rdf.advitiaum.com

The daily RDF disposal report for Swachha Andhra Corporation, built from the Claude Design
handoff ("RDF Disposal Report"). You open it with a PIN. The **gear icon** uploads each day's
tracker CSV, and **Save as PDF** prints the A4 report. Every upload adds a day to the
"Disposed so far" graph, so the graph grows as the days go by.

| Piece | File |
| --- | --- |
| Routes, PIN login, upload API | `views/rdf_report.py` (registered in `main.py`) |
| CSV parsing + storage (local or GCS) + CLI | `data/rdf_tracker.py` |
| Figures, statuses, chart SVG | `data/rdf_report.py` |
| Page / PIN page / styles / gear panel | `templates/rdf_report/`, `static/rdf_report/` |
| The 12 trackers from the design session (1–13 Oct) | `data/rdf_seed/` |

URLs: `https://rdf.advitiaum.com/` (the report is served at `/` on any `rdf.*` host) and
`https://advitiaum.com/rdf_report/`.

## How the data works

- **Storage**: `RDF_TRACKER_DIR` (app.yaml) is `gs://advitia-weighbridge-data/rdf_report`. It holds:
  ```
  trackers/2026-10-13.csv      one file per day, named by the sheet's "as on Dt" date
  uploads/<time>_<file name>   every upload exactly as received (audit trail)
  pin_hash                     hash of the report PIN
  ```
- **Which day a sheet belongs to**: the date in the `as on Dt: DD.MM.YYYY` header. A file named
  `Daily_RDF_tracker-14-10-2026.csv` reports **13 Oct**. If you upload a corrected sheet for a
  date that is already on file, it replaces that day. The gear panel says "replaced that day".
- **Figures** come straight from the latest sheet. *Today* is the "RDF disposed as on" column,
  *To date* is the "Cumulative RDF disposed" column, and *Left* is the "Balance RDF to be
  disposed" column. Nothing is estimated.
- **Graph**: one point per day on file: MT disposed each day (green), MT a day needed to clear
  by the deadline (red dashed), and MT left (dark).
- **Removing a day**: gear icon › Remove. The raw upload stays in `uploads/`.
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

# 2. Load the history so far (1–13 Oct). The files are already named by date.
gcloud storage cp data/rdf_seed/*.csv gs://advitia-weighbridge-data/rdf_report/trackers/

# 3. Set the PIN. It is typed at a prompt, so it is not saved in your shell history.
#    Only the hash is stored, in the bucket and not in this public repo.
python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
gcloud auth application-default login
RDF_TRACKER_DIR=gs://advitia-weighbridge-data/rdf_report python -m data.rdf_tracker set-pin

# 4. Deploy (the same command as the rest of the site)
gcloud app deploy app.yaml --quiet

# 5. Map the subdomain. App Engine issues and renews the HTTPS certificate itself.
gcloud app domain-mappings create rdf.advitiaum.com --certificate-management=AUTOMATIC
#    The command prints a DNS record. At your DNS provider for advitiaum.com, add:
#        Type CNAME   Name rdf   Value ghs.googlehosted.com.
#    Then wait for the certificate (usually 15–60 min):
gcloud app domain-mappings describe rdf.advitiaum.com     # sslSettings shows the certificate id once ready
```

If step 5 says the domain is not verified, run `gcloud domains verify advitiaum.com`, follow the
Search Console steps, and run step 5 again. If advitiaum.com is already mapped to this app, it
is already verified.

Until step 3 is done, the PIN page shows "The report PIN has not been set up yet".

### Changing the PIN later

Run step 3 again. There is no need to redeploy, because the new PIN takes effect within 5 minutes.
People who are already signed in stay signed in until their 8-hour session ends.

## Run locally

```bash
source .venv/bin/activate
mkdir -p rdf_tracker_data/trackers && cp data/rdf_seed/*.csv rdf_tracker_data/trackers/
python -m data.rdf_tracker set-pin          # writes rdf_tracker_data/pin_hash
python main.py                              # http://localhost:8080/rdf_report/
```

## Security notes

- There is one shared PIN, and anyone who has it can upload or remove days. Wrong PINs share the
  main login's lockout: 5 tries per IP, then 15 minutes blocked.
- After sign-in, access is held in the Flask session cookie, which is signed with `SECRET_KEY`.
  **`SECRET_KEY` is committed in `app.yaml` in this public repo.** Anyone who reads it can forge
  a session and skip the PIN, and the same applies to the main `/login`. Rotate it and keep it
  out of git. For example, move `SECRET_KEY` into a git-ignored `secrets.yaml` that contains an
  `env_variables:` block, and add `includes: [secrets.yaml]` to app.yaml.
