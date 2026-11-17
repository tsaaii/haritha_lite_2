# /sac — Swachha Andhra dashboard and portal

| URL | What |
| --- | --- |
| `/sac` | Public display. Rotates every 6 s: all phases, then Phase 3, 2, 1, 1 excess, Earlier work. Clicking a phase pill holds it; hovering pauses. "Log in" opens the PIN popup. |
| `/sac?login=1&next=/path` | Opens with the popup showing; after sign-in goes to `/path` (same site only). `/login` and every login-gated page send you here. |
| `/sac/portal` | Signed in. Tiles: Agency data, Phase data, Site data, RDF data (opens `/rdf/`). Drill-downs with search, phase and agency filters. |
| `/sac-old` | The previous 12-card dashboard (`sites_master.csv`), unchanged. |

Code: `views/sac.py` (routes), `data/phase_data.py` (sheet), `pins.py` (PINs),
`templates/sac/`, `static/sac/`. Design source: the Claude Design export "SAC Dashboard Redesign"
(screens 2a, 3a and SAC Portal).

## The data: the phase sheet

One CSV row per site and phase. Needed columns: `location, phase, agency_name, target_mt, remediated_mt`;
also read: `site_name, cluster, inert_disposed_mt, rdf_disposed_mt, cnd_disposed_mt, soil_disposed_mt,
rdf_remaining_in_site, start_date, deadline_date, status, processing_power`. Phases recognised:
`Phase 3 - current`, `Phase 2`, `Phase 1`, `Phase 1 - 15% Excess`, `Old`.

- Weighed in = `remediated_mt`; percent done caps each row at its award (surplus shows as "+x extra").
- A site is a `location`. It has "no legacy intake left" when, across its rows, weighed in ≥ awarded.

**Updating it:** sign in with an admin PIN, press the gear icon in the portal, choose the CSV.
The screen lists rows that need a look (no phase, formula errors like `#VALUE!`, no agency or site name,
weighed in above awarded, materials more than 1.5× weighed in — `PHASE_MATERIAL_RATIO_FLAG`).
Switch "Skip this row" on any of them, then Publish. The new sheet replaces the old one for both the
display and the portal; the previous file is kept next to it as `phase_data.<timestamp>.bak.csv`.

Stored at `PHASE_DATA_CSV` (app.yaml: `gs://advitia-weighbridge-data/dashboard_config/phase_data.csv`).
Until something is published there, `data/phase_data_seed.csv` (the sheet the design was made from) is shown.

## Live weighbridge tickets

Every site page in the portal has "Live from the weighbridge". The site list comes from the records API
`/filters` (`sites`); the best-matching names (ignoring case, spaces, a "Tharuni" prefix and trailing
numbers) are offered first and the top one is picked. If the guess is wrong, pick another; the choice is
remembered in that browser. Tickets for the chosen dates (default today, at most 31 days) are listed
newest first; "Photos" opens the 2×2 camera sheet through `/record-images/` (same proxy as `/reports`).

## PINs

One PIN signs you in to `/sac`, `/reports` and `/rdf` together.

**For now** there is a single built-in admin PIN (its hash is `BUILTIN_PIN_HASH` in `pins.py`; the PIN is
not written in this public repo). `SAC_PIN_HASH` in app.yaml overrides it without a code change.

**Later, per-person PINs:** put a `pin.yaml` at `PIN_FILE`
(app.yaml: `gs://advitia-weighbridge-data/dashboard_config/pin.yaml`). Format in `pin.example.yaml`;
make each entry with `python pins.py add <name> <admin|viewer>`. Admin PINs see the gear (upload);
viewer PINs do not. As soon as a valid `pin.yaml` is there (re-read every 5 minutes) the built-in PIN stops
working. All PINs share one length (`pin_length`), which sets the number of boxes in the popup.

Five wrong tries from one IP lock it out for 15 minutes; the sum captcha is checked before the PIN.
