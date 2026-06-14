# Auto-sync DATA.xlsx to dashboard Google Sheet

This Apps Script converts the synced Excel file on Google Drive into a temporary Google Sheet, copies its data into the stable dashboard Google Sheet, then deletes the temporary conversion.

## Files

- Source Excel: `DATA.xlsx`
  - The script finds this by file name inside the source folder, so the Excel file ID may change safely.
- Source folder ID:
  - `1-FXpj7gFp1YFzPmiS-KVOTh7_YuzsPPW`
- Stable dashboard sheet: `HAZZYS_DASHBOARD_DATA`
  - ID: `1l53PyTaGzb92aagtMTJwBoc8E_0p-EaSvLAv4dVehC8`

## Setup

1. Open [HAZZYS_DASHBOARD_DATA](https://docs.google.com/spreadsheets/d/1l53PyTaGzb92aagtMTJwBoc8E_0p-EaSvLAv4dVehC8/edit).
2. Go to `Extensions` -> `Apps Script`.
3. Paste the content of `sync-excel-to-dashboard.gs`.
4. In Apps Script, enable Advanced Google services:
   - Open `Services` / `+`
   - Add `Drive API`
5. Run `syncDashboardData` once and approve permissions.
6. Add a trigger:
   - Function: `syncDashboardData`
   - Event source: `Time-driven`
   - Suggested interval: every 15 minutes or every hour

## Important

Keep the dashboard sheet tabs named exactly:

- `sale data`
- `target`
- `inventory`

The dashboard reads these tab names, so changing sheet `gid` values will not break it.
