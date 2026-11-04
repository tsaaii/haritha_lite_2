# TTD dashboard (`advitiaum.com/TTD`)

For Tirumala Tirupati Devasthanams officials. One sign-in, three tabs:

| Tab | Shows |
|---|---|
| **Overview** | Awarded legacy quantity (51,290 MT) with processed, balance and % complete; trips today; cumulative inward processed; cumulative Soil, Inert, C&D, RDF and Scrap disposed. Refreshes every minute. |
| **Reports** | Day-wise or month-wise table for any date range: trips and net MT per material, disposed total, grand total. **Download PDF** gives the same report with both logos. |
| **Live cameras** | The weighbridge cameras on demand, with the live weight. Each camera starts only when you click Watch and stops after 5 minutes. |

Definitions (complete trips only, net weight):
- **Inward processed** = all-time net weight of trips with material **MSW** (the legacy waste brought in).
- **Disposed** = all-time net weight of trips with material Soil / Inert / CnD / RDF / Scrap.
- **Trips today** = trips started today (India time), including vehicles still waiting for their empty weight.

## Climate impact tiles (Overview)

Four **estimated** tiles under "Climate impact". Hover (or tap on a phone) shows the method, formula and live numbers.
All are computed in `views/ttd.py` (`impact()`) from weighbridge tonnage; none is a verified or issued credit.

| Tile | Method | Formula (defaults) |
|---|---|---|
| **Methane avoided** (t CH₄, and t CO₂e) | IPCC 2006 Guidelines, Vol. 5 Ch. 3 (mass balance of remaining degradable carbon) | MSW processed × MCF 0.8 × DOC 0.06 × DOCf 0.5 × F 0.5 × 16/12 × (1 − OX 0) = 0.016 t CH₄ per t; CO₂e at GWP 28 (IPCC AR5) |
| **Trees equivalent** | US EPA Greenhouse Gas Equivalencies: one urban tree seedling grown 10 years = 0.060 t CO₂ | CO₂e ÷ 0.060 |
| **Carbon credits** (potential; 1 credit = 1 t CO₂e) | UN CDM AMS-III.AF (excavating and composting partially decayed MSW) | CO₂e × φ 0.85 (model-uncertainty deduction); before project emissions |
| **EPR credits** (potential; t plastic) | India Plastic Waste Management Rules, EPR end-of-life (co-processing in cement kilns) | RDF dispatched × plastic share 0.5 (assumption) |

Deliberately conservative: RDF replacing coal is **not** counted (burning RDF also emits fossil CO₂ from its plastic,
and claiming it needs a separate methodology with the cement plant). Credits exist only after registration,
validation, verification and issuance (Verra / Gold Standard / Article 6 for carbon; the CPCB portal, via a
registered processor, for EPR). The EU ETS does not accept such credits, and the EU has no tradable EPR credit.

**Replace the assumptions with site data** (in `app.yaml`, then redeploy):

| Setting | Default | Replace with |
|---|---|---|
| `TTD_CH4_DOC` | 0.06 | Lab DOC of the excavated legacy waste (biggest effect on every tile) |
| `TTD_RDF_PLASTIC_SHARE` | 0.5 | Plastic share of RDF from a composition test |
| `TTD_CH4_MCF` | 0.8 | 0.4 if the dump was shallow (< 5 m), per IPCC |
| `TTD_CH4_DOCF`, `TTD_CH4_F`, `TTD_CH4_OX` | 0.5, 0.5, 0 | Keep IPCC defaults unless measured |
| `TTD_GWP_CH4` | 28 | 28 = IPCC AR5 (EU/UNFCCC reporting) |
| `TTD_CREDIT_PHI` | 0.85 | Value required by the chosen registry methodology |
| `TTD_TREE_TCO2` | 0.060 | Keep (US EPA) |

## Sign-in

- Two accounts, both opening the same dashboard (passwords are stored only as scrypt hashes in `views/ttd.py`):
  - `admin-ttd`, password `ttd@tirumala`
  - `ycdemo` (demo account; its password is not written in this public repo)
- A maths question (captcha) must be answered first, and each question works once.
- Five wrong passwords from one network lock sign-in for 15 minutes.
- This login is separate from `/login`; signing in to one does not open the other.

To change a password without touching code, set `TTD_PASSWORD_HASH` (admin-ttd) or
`TTD_YCDEMO_PASSWORD_HASH` (ycdemo) to the output of
`python -c "from werkzeug.security import generate_password_hash as g; print(g('NEW PASSWORD'))"`.

## Where the data comes from

```
TTD weighbridge PC (Adex Lite)  --sync every 2 min-->  Adex cloud API (Cloud Run + Firestore)
                                                          ^
advitiaum.com/TTD (this app, App Engine) -- server side --+   (read key never reaches the browser)
```

Every `/TTD/api/*` call needs the signed-in TTD session; this server then calls the Adex cloud
API with the site's **read key** (it can read, never write).

## Setup (once)

1. Deploy the Adex cloud API (`adex-lite3/cloud/deploy.sh`) and create the site:
   `python -m cloud.admin create-site ttd "TTD legacy site"`. Keep the **sync key** for the
   weighbridge PC (Settings → 77 Cloud sync) and the **read key** for step 2.
2. Put the read key in Secret Manager in the App Engine project and let App Engine read it:
   ```bash
   printf "%s" "READ_KEY_HERE" | gcloud secrets create ttd-read-key --data-file=-
   gcloud secrets add-iam-policy-binding ttd-read-key \
     --member="serviceAccount:$(gcloud config get-value project)@appspot.gserviceaccount.com" \
     --role=roles/secretmanager.secretAccessor
   ```
3. In `app.yaml` set `ADEX_API_URL` to the Cloud Run URL and
   `TTD_READ_KEY_SECRET` to `projects/<project>/secrets/ttd-read-key/versions/latest`, then
   `gcloud app deploy app.yaml`.

## Using the API directly

The figures behind the dashboard come from the Adex cloud API. Anyone with the **read key** can
call it (Excel/Power BI, another website, scripts). Send the key in the `X-Api-Key` header.

```bash
API=https://adex-api-xxxxx.asia-south1.run.app
KEY=your-read-key

# all-time totals per material (cumulative inward / disposed)
curl -H "X-Api-Key: $KEY" "$API/v1/sites/ttd/totals"

# per-day totals for a range (up to 5 years); sum by month for month-wise
curl -H "X-Api-Key: $KEY" "$API/v1/sites/ttd/summary?from=2026-10-01&to=2026-10-31"

# every trip on one day
curl -H "X-Api-Key: $KEY" "$API/v1/sites/ttd/tickets?date=2026-11-02"

# vehicles waiting for their empty weight
curl -H "X-Api-Key: $KEY" "$API/v1/sites/ttd/pending"

# live: Server-Sent Events, one message each time the weighbridge syncs
curl -N "$API/v1/sites/ttd/live?key=$KEY"

# cameras: station online / live weight, then the newest picture (asking = watching for 12 s)
curl -H "X-Api-Key: $KEY" "$API/v1/sites/ttd/live/state"
curl -H "X-Api-Key: $KEY" -o front.jpg "$API/v1/sites/ttd/live/front.jpg"
```

Example `totals` answer:

```json
{"site": "ttd", "trips": 3321, "net_kg": 23247790, "pending": 2,
 "materials": {"MSW": {"trips": 1990, "net_kg": 14263730}, "Soil": {"trips": 598, "net_kg": 4083300}}}
```

From a browser on another website, the API must allow that site: deploy it with
`--set-env-vars CORS_ORIGINS=https://your-site.example`.
