# haritha_lite

Flask + Jinja rebuild of the Swachh Andhra Pradesh dashboard.

The dashboard is "exactly the same" as the prior Dash version: hero,
project overview strip, 1×4 header cards, rotating agency banner, 2×4
main cards. Stack is plain Flask + Jinja, so cold start and ops are
boring on purpose.

## Data sources

- **`sites_master.csv`** (GCS, 30-min cache) — the spine. One row per
  site: agency, cluster, target tonnage, deadline, status.
- **Records API** (configurable, 30-min cache) — actual remediated
  tonnage. One HTTP call per `api_site_names` entry per spine site.
- **`overrides.csv`** (GCS, optional) — single-column overrides keyed
  by metric name. Anything in here wins over the computed value.

## Project structure

```
haritha_lite/
├── main.py                      Flask routes + view-model assembly
├── config.py                    All knobs (env-driven)
├── data/
│   ├── _cache.py                Tiny TTL cache
│   ├── master.py                sites_master.csv loader
│   ├── overrides.py             overrides.csv loader
│   ├── records.py               Records-API client
│   └── aggregate.py             Pure functions → card numbers
├── templates/
│   ├── base.html
│   ├── overview.html
│   └── partials/
│       ├── hero.html
│       ├── header_card.html
│       ├── agency_header.html
│       └── main_card.html
├── static/
│   ├── css/dashboard.css        Consolidated, mobile-optimised
│   └── js/rotation.js           Agency rotation
├── sites_master.csv             Local dev fallback
├── overrides.csv                Local dev fallback (sample)
├── requirements.txt
├── app.yaml                     App Engine config
└── README.md
```

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Use the bundled sample CSVs and skip GCS:
export USE_LOCAL_CSV=1
export RECORDS_API_BASE=https://your-fastapi-host.example.com

python main.py
# -> http://localhost:8080
```

If `RECORDS_API_BASE` points to an unreachable host, the dashboard
still renders — every site will show 0 MT remediated. This is by
design: degrade visibly, don't 500.

## Deploy to App Engine

```bash
gcloud app deploy app.yaml
```

Edit env vars in `app.yaml` first. The service account needs read
access to `gs://$GCS_BUCKET/dashboard_config/*`.

## Manually refresh the cache

```
GET /admin/refresh-cache
```

Hit this after editing `sites_master.csv` in GCS. Returns immediately;
next page load picks up the new data.

## Knobs you'll probably want to touch

| File | What |
| --- | --- |
| `config.py` `AGENCY_DISPLAY_NAMES` | Friendly agency labels |
| `config.py` `RECORDS_API_*_FIELD` | If your API uses different field names |
| `data/aggregate.py` `main_cards()` | Edit which 8 cards show, in what order |
| `static/css/dashboard.css` `:root` | Theme colours / spacing tokens |

## Cards layout

```
┌───────── Hero ──────────────────────────────────────┐
├──── Project overview strip (sites/agencies/...)─────┤
├──┬──┬──┬──┐  ← 1×4 Header cards
│ 1│ 2│ 3│ 4│     Total Target / Remediated / % / Days
├──┴──┴──┴──┤
│ Agency banner (rotates) ────────────────────────────┤
├──┬──┬──┬──┐  ← 2×4 Main cards (per current agency)
│ 1│ 2│ 3│ 4│     Progress / Sites / Reclamation / Timeline
├──┼──┼──┼──┤
│ 5│ 6│ 7│ 8│     Daily Rate / Clusters / Top / Critical
└──┴──┴──┴──┘
```

Mobile (≤480px) collapses to a single column. ≤768px is 2 columns.
≤1024px is 3 columns for the main grid. ≥1024px is the full 4×4 grid.

## Accessibility / niceties

- `prefers-reduced-motion` honoured (transitions ~instant).
- Rotation pauses on hover, pauses when the tab is hidden.
- Keyboard support: ← / → on the page jumps slides.
- `print` styles flatten the rotation so all agencies print together.
