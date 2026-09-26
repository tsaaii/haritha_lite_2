# RDF_planning — agency form

`https://advitiaum.com/rdf_planning/` (also `/RDF_planning`). Mobile-first form each agency
opens from a link, logs into with a 4-digit PIN, and uses to report RDF generated, where it
was disposed (cement / WtE plants), and the co-processing certificates for it.

| Piece | File |
| --- | --- |
| Flask proxy + session login | `views/rdf.py` (registered in `main.py`) |
| Page / styles / logic | `templates/rdf/index.html`, `static/rdf/rdf.css`, `static/rdf/rdf.js` |
| Apps Script backend | `apps_script/rdf_planning/Code.gs`, `Pdf.html`, `appsscript.json` |

Same pattern as the field apps (`docs/field-apps.md`): phones only talk to advitiaum.com;
Flask forwards to Apps Script with a shared token; Apps Script owns the sheet and Drive.
The PIN is checked once at login; after that the agency is held in the signed Flask
session, so an agency can only see and write its own rows.

## What gets written

**Google Sheet "Haritha RDF Planning"**
- `Sites` — `Phase_data.csv` imported as-is. Drives the Site / Phase / Cluster / Awarded fields.
- `RDF_plan` — one row per submission. Disposed %, certified, certificate pending and RDF at site are calculated, never typed.
- `RDF_dispatch` — one row per destination. Missing or short certificates set *Certificate pending*; a later upload clears it and updates `RDF_plan`.

**Drive (under the "Haritha RDF" folder)**
```
RDF Planning Records/All_agencies_RDF_data.csv          ← every agency, rebuilt on every change
RDF Planning Records/<Agency>/<Agency>_RDF_data.csv     ← rewritten on every change; same file as "Download all my data"
RDF Planning Records/<Agency>/<Phase>/<Site>/<ID>_<Site>.pdf  + other attachments
RDF Certificates/<Agency>/<Site>/<Phase>/<ID>_D1_<file>       ← one per co-processing certificate
```

## Step 1 — Sheet, folder, Apps Script (≈15 min)

1. In the Google account that should own the data: new Google Sheet **Haritha RDF Planning**.
   **File › Import › Upload** `Phase_data.csv` › *Insert new sheet(s)*. Rename that tab to **Sites**.
2. In Drive, create a folder **Haritha RDF**. Open it and copy the ID from the URL (the part after `/folders/`).
3. In the sheet: **Extensions › Apps Script**. Replace `Code.gs` with `apps_script/rdf_planning/Code.gs`.
   Add an HTML file named **Pdf** and paste `Pdf.html`.
   Project Settings (gear) › tick *Show "appsscript.json"* › paste `appsscript.json` (sets the India time zone).
4. At the top of `Code.gs` set:
   - `TOKEN:` a long random string — `python -c "import secrets; print(secrets.token_urlsafe(32))"`
   - `ROOT_FOLDER_ID:` the ID from step 2
5. Select **makePins** › **Run** › approve permissions. Open **Execution log**, copy the
   `const AGENCY_PINS = {…}` block and paste it over the empty one in `Code.gs`. Change any PIN you like.
   Only agencies in this block appear in the login list.
6. Select **setup** › **Run**. The `RDF_plan` and `RDF_dispatch` tabs appear with headers.
7. **Deploy › New deployment › Web app** — Execute as **Me**, Who has access **Anyone** › Deploy.
   Copy the `/exec` URL.

## Step 2 — Deploy haritha_lite

In `app.yaml` fill:
```yaml
  RDF_SCRIPT_URL: "https://script.google.com/macros/s/…/exec"
  RDF_SCRIPT_TOKEN: "<the TOKEN from step 1.4>"
```
```bash
gcloud app deploy app.yaml --quiet
```

## Step 3 — Verify (2 min)

```bash
BASE=https://advitiaum.com
curl -s -o /dev/null -w "%{http_code}\n" $BASE/rdf_planning/     # 200
curl -s $BASE/rdf_planning/api/agencies                          # {"agencies":[...],"ok":true}
```
On a phone: open `$BASE/rdf_planning/`, log in, submit a test entry, download the PDF and CSV,
and check the rows in the sheet and the files in Drive. Delete the test rows afterwards.

- 503 "backend is not configured" → `RDF_SCRIPT_URL` is empty in `app.yaml`.
- 502 mentioning "Anyone" → redeploy the Apps Script with **Who has access: Anyone**.
- "Unauthorised." → `TOKEN` in Code.gs and `RDF_SCRIPT_TOKEN` differ, or TOKEN still starts with `CHANGE-ME`.

## Step 4 — Roll out

Send every agency the same link, and each agency its own PIN separately. On the phone:
Chrome › ⋮ › **Add to Home screen**.

## Updating later

- Form / proxy: edit the repo, `gcloud app deploy`.
- Apps Script (including PIN changes): edit, then **Deploy › Manage deployments › ✎ › Version: New version › Deploy**. The URL stays the same.

## Behaviour notes

- **Several sites at once.** On the Review screen, *+ Add another site* keeps the finished site and starts the next one (name and phone carried over). *Submit N sites* sends them one after another; each gets its own Record ID, PDF and folders. If one fails, the ones already sent stay sent and the rest wait on screen to retry.
- **Tabs create themselves.** `RDF_plan`, `RDF_dispatch` and `All_RDF_data` are created with headers on first use if missing; running `setup()` is optional.
- **Certificate pending is automatic.** "No" certificate, or a certificate quantity lower than
  RDF disposed, puts the difference in *Certificate pending*. Agencies never pick that status.
- **Late certificates.** When an agency opens the same site again, entries still waiting for a
  certificate appear at the top of the RDF step with *Add certificate*.
- **Site / Phase / Destination** are text fields with a suggestion list: your `Sites` tab, plus
  anything that agency (sites/phases) or anyone (destinations) submitted before, plus names typed
  on that phone. A site/phase not in the list asks for cluster and awarded quantity, and is remembered.
- **PIN or password.** Each agency's entry in `AGENCY_PINS` can be a 4-digit PIN or a password (4–32 characters, no spaces, in quotes).
- **All agencies.** Every submission and late certificate rebuilds the `All_RDF_data` tab and `RDF Planning Records/All_agencies_RDF_data.csv` (same 20 columns as the agency CSV). After editing RDF_plan / RDF_dispatch by hand, run `rebuildAllData` in the Apps Script editor.
- **PIN lockout.** 5 wrong PINs lock that agency's login for 15 minutes (`CONFIG` in Code.gs).
- **Drafts.** An unfinished entry is kept on the phone and restored on the next visit;
  attached files are not, so certificates have to be attached again.
- **Photos** are shrunk on the phone to 1600 px JPEG before upload. Other files: 10 MB max each,
  about 30 MB per submission in total.
- Sessions last 8 hours (the app's `permanent_session_lifetime`).
