# Eye Movement R² Calculator (v2)

A pure browser app — **no install, no server, no Python**. All computation runs
client-side; uploaded files never leave the machine.

## What it computes
For each recording, `R² = (Pearson correlation of eye position vs. Time)²`,
using the correct channel per direction:

- **Horizontal** categories → **LH** (Left), **RH** (Right)
- **Vertical** categories → **LV** (Left), **RV** (Right)

Two tables (and two Excel sheets):

1. **Full recording** — Left / Right R² for every category.
2. **Upper vs lower half** — each recording is split at its **time midpoint**;
   "Upper" = first half, "Lower" = second half. Each patient gets 4 rows:
   Left-Upper, Left-Lower, Right-Upper, Right-Lower.

Values shown to 4 significant figures. **R-type** columns are red. Missing
categories are left blank. Patients are ordered by folder name (explorer order).

## How to use
- **Open `index.html`** (double-click), or host this folder on GitHub Pages.
- Drag in `.csv` files **or** a `.zip` of them → tables appear → **Download
  Excel spreadsheet**.
- Top-left button toggles English / Korean.

## Files
| File | Purpose |
|------|---------|
| `index.html` | The page. |
| `app.js` | All logic: CSV/zip parsing, R² math, tables, Excel export, i18n. |
| `styles.css` | Styling. |
| `vendor/jszip.min.js` | Reads `.zip` uploads (bundled for offline use). |
| `vendor/exceljs.min.js` | Writes styled `.xlsx` (bundled for offline use). |

## Note vs the old answer key
This version uses **LV/RV for vertical** categories. The original
`answer_key.xlsx` used LH/RH for everything, so vertical numbers here differ
from that sheet by design (this is the corrected channel logic).

After updating, bump the `?v=` on the `app.js` / `styles.css` links so browsers
fetch the new files instead of a cached copy.
