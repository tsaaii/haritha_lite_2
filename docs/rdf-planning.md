# RDF_planning (v2) — agency form

`https://advitiaum.com/rdf_planning/` (also `/RDF_planning`). Mobile-first form each agency
opens from a link, logs into with its **agency name + 4-digit PIN**, and uses to report, per
site and phase: work period, ULB quantities, and the disposal of **RDF, Soil, Inert and C&D**
(cumulative, balance at site, timeline, issues), plus the factories RDF went to.

| Piece | File |
| --- | --- |
| Flask proxy + session login | `views/rdf.py` (registered in `main.py`) |
| Page / styles / logic | `templates/rdf/index.html`, `static/rdf/rdf.css`, `static/rdf/rdf.js` |
| Apps Script backend | `apps_script/rdf_planning/Code.gs`, `appsscript.json` |

Phones only talk to advitiaum.com; Flask forwards to Apps Script with a shared token.
The PIN is checked once at login; after that the agency is held in the signed Flask
session, so an agency can only see and edit its own entries.

## What gets written

- **Tab `RDF_plan_v2`** in the "Haritha RDF Planning" sheet — one row per site + phase entry,
  32 columns (the last two: *Site 100% reclaimed, no disposals pending* and *Fresh waste dumped on
  reclaimed site*, Yes/No). A tab made by the earlier 30-column build gets the two headers added
  automatically; its old rows show them blank. Created automatically on the first submit. **Editing** an entry from "My sites"
  rewrites that same row (Submitted at is updated).
- **Drive** (under the "Haritha RDF" folder), rewritten on every submit:
  ```
  RDF Planning/<Agency>/<Agency>_RDF_plan.csv   ← "Download all my data (CSV)"
  RDF Planning/All_agencies_RDF_plan.csv
  ```
- The v1 tabs (`RDF_plan`, `RDF_dispatch`, `All_RDF_data`) and v1 Drive folders are left as they
  were — v2 never reads or writes them.

## Setup / update (≈5 min)

1. In the sheet: **Extensions › Apps Script**. In `Code.gs` select all, delete, paste
   `apps_script/rdf_planning/Code.gs`. Delete `Pdf.html` (not used any more).
2. At the top of `Code.gs` set `TOKEN` (same as `RDF_SCRIPT_TOKEN` in `app.yaml`),
   `ROOT_FOLDER_ID`, and the `AGENCY_PINS` block (keep the quotes).
3. Optional: run **setup** once — it checks the folder and creates `RDF_plan_v2`.
4. **Deploy › Manage deployments › ✎ › Version: New version › Deploy.** The `/exec` URL stays the same.
5. Open the `/exec` URL in a browser: it must show `"build":"2026-09-28-v2b"`.
   If the website says *"The RDF server (Apps Script) is an older version than this form"*, the
   new Code.gs was pasted but not deployed as a **New version** (or not pasted at all).
6. Deploy the website: `git pull origin main` then `gcloud app deploy app.yaml --quiet`.

## Behaviour notes

- **Login:** agency name is typed; capital letters and extra spaces don't matter. Unknown
  names and wrong PINs get the same message. 5 wrong tries lock that name for 15 minutes.
- **Validation** (same rules in the form and in Code.gs): every number and date is required
  (enter 0 if none); end date not before start; last RDF date not in the future and not before
  start; if cumulative RDF > 0 at least one factory; factory total can't exceed cumulative RDF;
  no factory twice. **Warnings** (don't block): processed > awarded, a timeline after the 100%
  remediation date, RDF balance that can't be cleared by the timeline at the daily rate,
  factory total below cumulative RDF.
- **Site status:** *Site is 100% reclaimed, with no disposals pending* (tick box) — when ticked, every
  balance at site must be 0 and a future 100% date gets a warning. *Is fresh waste being dumped on the
  site you reclaimed?* — Yes/No, required.
- **Drafts:** an unfinished new entry is kept on the phone; "My sites" offers *Continue it* / *Discard*.
- **Suggestions:** site and phase names from the agency's own entries; factory names from all
  agencies' entries.
- **PDF:** "Download PDF" opens the phone's print dialog with a summary — choose *Save as PDF*.
- Sessions last 8 hours (the app's `permanent_session_lifetime`).
