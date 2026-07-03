# Eye Tracking tools (Eye_v2)

A pure browser app — **no install, no server, no Python**. All computation runs
client-side; uploaded files never leave the machine. Two pages, linked by the
top-right button:

- **`index.html` — MG Screening** (two-flag detector). *Screening aid only — not a diagnosis.*
- **`offcenter.html` — Off-Center R²**: keeps only samples where the eye is
  **off-center** (position > +2 or < −2, ignoring the ±2 center) and computes
  **R² of eye vs. time** for each group. Output: 4 rows per patient
  (Left/Right × Above/Below) × categories, downloadable as Excel.

Both pages share the design, Korean/English toggle, upload, red R-type columns,
folder-name sorting, and offline vendored libraries.

---

## MG Screening (index.html)

## What it does
For each recording it measures how well the eye **follows the laser** (`Target`
columns), using the correct channel per direction (Horizontal → LH/RH vs
TargetH; Vertical → LV/RV vs TargetV), in 8 time-windows:

- `tracking_error` = RMS(eye − target) / RMS(target) — 0 = perfect, higher = worse
- `gain` = std(eye)/std(target) — undershoot < 1
- `corr²`, plus **fatigue** = 2nd-half − 1st-half change (error grows / gain shrinks)

Features are averaged per patient, then **two independent flags** are raised:

- **Flag 1 (transparent rule):** tracking deficit — `tracking_error > 0.86` OR `gain < 0.65`.
- **Flag 2 (machine learning):** logistic-regression risk > 0.5 (model trained on
  10 AChR+ vs 10 healthy; coefficients baked into `app.js`).

Verdict: **both → 🟥 Very likely · one → 🟧 Possible · none → 🟩 Low.**

Output: one row per patient (tracking error, gain, fatigue, ML risk, the two
flags, verdict), downloadable as Excel. Top-left button toggles English/Korean.

## Performance on the 20 labeled patients (see `analysis/`)
- Very likely (both flags): 8/10 AChR, 0/10 healthy.
- Either flag (screen): 8/10 AChR, 1/10 healthy.
- Two mild AChR track near-normally and are missed. Provisional — validate on new data.

## Files
| File | Purpose |
|------|---------|
| `index.html` | The page. |
| `app.js` | Features, both flags, ML model, table, Excel export, i18n. |
| `styles.css` | Styling. |
| `vendor/` | JSZip + ExcelJS (bundled for offline use). |

## Retraining / updating the model
The ML model lives in `../analysis/flag_pipeline.py`. Re-run it to get new
`bias / weights / mean / std`, then paste them into the `MODEL` object in
`app.js` and bump the `?v=` on the script/style links.

> ⚠️ This detects a **tracking-deficit / fatigue pattern**, not AChR antibodies
> specifically. Tuned on 20 patients — treat as a research screening signal.
