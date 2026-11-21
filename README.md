# Cue

Cue answers a support line, asks the three questions that real data showed matter, and ranks every caller in a callback queue by how likely they are to need real help. The ranking comes from a model trained on 60,000 CFPB complaint outcomes, not from an AI guess.

Built for Acalanes Data Fest 2026.

## What's here

| Path | What |
|---|---|
| `server.py` | FastAPI back end: scoring, ranked queue, callbacks, callers, settings, assistant, and the Vapi phone tools at `/vapi/tools` |
| `voicemate_scoring.json` | The learned model: weights, score percentiles, CFPB categories |
| `web/` | The React dashboard (Vite). `npm run build` writes the single `index.html` the server serves |
| `index.html` | The built dashboard |
| `vapi/` | Script that connects a Vapi assistant and phone number to the server |
| `prep.py`, `model.py`, `brief_check.py` | The reproducible analysis |
| `FINDINGS.md`, `charts/`, `*.json`, `*.csv` | Results: AUC, ranking vs first-come, fairness, brief accuracy |
| `brand/` | Cue logo files and palette |

The raw CFPB downloads (`data/`) are not in the repo; `prep.py` shows how they were built.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install fastapi uvicorn adaption
export ADAPTION_API_KEY=...        # never commit keys
.venv/bin/uvicorn server:app --port 8000 --reload
```

Open http://localhost:8000 in Chrome.

To rebuild the dashboard: `cd web && npm install && npm run build`.

For real phone calls through Vapi, see `vapi/INSTRUCTIONS.md` (copy `vapi/.env.example` to `.env` in the project root).

## Honest limits

- "Company gave relief" stands in for urgency; it is not urgency itself.
- Inside a single company the model's edge is smaller (median AUC 0.60), which is why Cue is built to learn from each business's own callbacks.
- Callers in the demo are synthetic, and callers are recognized by phone number, never verified.
