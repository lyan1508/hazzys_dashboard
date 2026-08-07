# Hazzys Sales Intelligence Dashboard

Dashboard phân tích doanh thu — Hazzys Taka. Chạy hoàn toàn trên trình duyệt, không cần server.

**Live:** https://lyan1508.github.io/hazzys_dashboard/

## Cấu trúc file

```
hazzys_dashboard/
├── index.html      ← Cấu trúc HTML (~500 dòng)
├── styles.css      ← Toàn bộ CSS / theme tokens
├── app.js          ← Logic: ingest dữ liệu, tính toán, render charts
├── save.bat        ← 1-click: push thay đổi lên GitHub
├── start.bat       ← 1-click: pull bản mới nhất từ GitHub về
├── .gitignore      ← Loại các file Excel data
└── README.md
```

## Workflow đơn giản

### Lấy code về máy mới
1. Clone repo: `git clone https://github.com/lyan1508/hazzys_dashboard.git`
2. Mở `index.html` trong trình duyệt — dashboard tự sync data từ Google Sheets

### Đồng bộ giữa các máy
- **`start.bat`** — chạy mỗi khi mở máy lên: pull bản mới nhất về
- **`save.bat`** — chạy sau khi chỉnh sửa: tự động add + commit + push

## Sửa file nào cho việc gì

| Cần làm | Sửa file |
|---|---|
| Đổi màu / theme / layout | `styles.css` |
| Thêm KPI card, sửa cấu trúc trang | `index.html` |
| Thêm báo cáo mới, sửa công thức tính toán | `app.js` |
| Đổi link Google Sheet nguồn | `app.js` — biến `GSHEET_BASE` |

## Nguồn dữ liệu

- **Cloud Sync (mặc định):** Google Sheets — bấm nút "Cloud Sync"
- **File local:** Drag-drop file Excel `.xlsx`/`.csv` vào dashboard

File Excel local **không commit lên GitHub** (đã có `.gitignore` chặn) — repo public, dữ liệu chỉ load từ Google Sheets.

## Báo cáo hiện có

Toàn bộ thống kê nằm trên **một trang duy nhất**, chia 5 nhóm:

- **KPI cards** (Revenue, Target, Achievement, Bills, Units, Traffic, CVR, UPT, ATV) + thanh Revenue vs Target
- **Performance** — Revenue Performance (Monthly / Cumulative), Bills & Traffic
- **Patterns** — Promotion, DOW Heatmap (Rev / Bills / ATV)
- **Year over Year** — biểu đồ xu hướng + bảng tóm tắt theo năm
- **Product** — Top Products by Style, By Category, By Type, By Gender
- **Staff** — Revenue by Cashier, Cashier Productivity Matrix
