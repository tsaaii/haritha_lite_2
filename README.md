# haritha_lite

Flask + Jinja rebuild of the Swachh Andhra Pradesh dashboard.

## Top 4 cards

| # | Title | Layout | Source |
|---|---|---|---|
| 1 | Project Overview | stacked | remediated / target (computed) |
| 2 | RDF Disposal Status | stacked | `project.rdf_disposed_mt` / `project.rdf_expected_mt` (overrides) |
| 3 | Required Performance | stacked | today / required-today (computed) |
| 4 | Site Reclamation Status | grid_2x2 | per-site %: 100% / 75–99% / 50–75% / <50% (computed) |

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export USE_LOCAL_CSV=1
export RECORDS_API_BASE=https://your-fastapi-host.example.com

python main.py
# -> http://localhost:8080
```

## Deploy to App Engine

```bash
gcloud app deploy app.yaml
```

## Manually refresh cache

```
GET /admin/refresh-cache
```

## Knobs

| File | What |
| --- | --- |
| `config.py` `AGENCY_DISPLAY_NAMES` | Friendly agency labels |
| `data/aggregate.py` `overview_cards()` | The 4 top cards |
| `data/aggregate.py` `main_cards()` | The 8 agency cards |
| `static/css/dashboard.css` `:root` | Theme colours / spacing tokens |
| `overrides.csv` | Hard-override any metric value |
