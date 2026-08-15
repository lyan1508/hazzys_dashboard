# Personal Sales — doanh thu và target theo từng nhân viên

Ngày: 2026-08-15

## Vấn đề

Dashboard chỉ có target ở cấp cửa hàng (một con số/tháng, sheet `Target`). Mục
`Staff` hiện có biểu đồ cột `Revenue by Cashier` và bảng `Cashier Productivity`,
cả hai đều chỉ nói doanh thu — không trả lời được câu hỏi "người này đang chạy
nhanh hay chậm so với chỉ tiêu của mình".

## Dữ liệu nền (đo trên `Data\DATA.xlsx`, 4.344 dòng, 2026-08-15)

- Cột `CASHIER` mỗi dòng chứa **đúng một tên**. Không có ô ghép kiểu "An + Tuấn".
  567/2031 hóa đơn trải trên nhiều tên là do các *dòng hàng* khác nhau trong cùng
  bill mang tên khác nhau. Vì vậy quy doanh thu về từng người ở mức dòng hàng là
  chính xác, không cần chia đều.
- 7 giá trị: Tuấn (968 dòng), Trang (903), An (875), Ngân (622), **trống (580)**,
  Ý (265), Dinh (131).
- Toàn bộ 09–12/2024 không có tên nhân viên. Từ 01/2025 mỗi tháng luôn đúng 4
  người, nhân sự đổi theo thời gian: Dinh (01–04/2025) → Trang (từ 05/2025) →
  Ngân nghỉ và Ý vào (từ 03/2026).
- Dữ liệu bán hàng đến 14/08/2026. Target 08/2026 = 1,0 tỷ.

## Quy tắc tính

**Doanh thu cá nhân** — cộng `amount` của từng dòng hàng theo tên ở cột `CASHIER`.
Dòng không có tên không thuộc về ai và được báo riêng, không âm thầm bỏ qua.

**Hệ số** — hằng số `STAFF_COEF = { 'AN': 0.85 }` trong `app.js`; ai không được
liệt kê tính hệ số 1. Đây là chỗ duy nhất cần sửa khi có người mới hoặc đổi hệ số.

**Chia target theo tháng** — với mỗi tháng trong kỳ đang lọc:

```
người có mặt = các tên xuất hiện trong dữ liệu của tháng đó
target_người = target_tháng × hệ_số_người / Σ hệ_số của người có mặt
```

Ví dụ 08/2026, bốn người An (0,85) + Trang + Ý + Tuấn (1,0) → Σ = 3,85.
An nhận 1,0 tỷ × 0,85/3,85 = 220,8tr; ba người còn lại 259,7tr mỗi người.

Tháng có target nhưng không ai đứng tên (09–12/2024) thì target đó **không chia
cho ai**; card để trống, không ghi chú gì.

**Target theo timeline** — chia đều theo ngày lịch:

```
target_timeline = target_người × số_ngày_đã_qua / số_ngày_trong_tháng
```

`số_ngày_đã_qua` lấy theo **ngày cuối cùng có dữ liệu bán hàng**, không lấy ngày
hôm nay, để nhân viên không bị phạt oan khi dữ liệu về trễ. Tháng đã kết thúc →
100%. Tháng chưa có dữ liệu → 0%. Ví dụ 08/2026: An = 220,8tr × 14/31 = 99,7tr.

**Kỳ lọc nhiều tháng** — cộng dồn kết quả từng tháng. Người vào hoặc nghỉ giữa
chừng chỉ nhận target của những tháng họ thực sự có mặt.

**Tương tác với bộ lọc khác** (gender, type, store) — danh sách người có mặt và
doanh thu đều lấy từ tập dòng đã lọc, còn target tháng lấy nguyên. Cách này giống
hệt thanh Revenue vs Target ở đầu trang, nên khi lọc theo giới tính thì % đạt sẽ
thấp một cách có chủ đích.

## Giao diện

Thay card `Revenue by Cashier` (biểu đồ cột) bằng card **Personal Sales**. Biểu
đồ cột cũ và hàm `renderCashierBar` bị gỡ; bảng `Cashier Productivity` giữ nguyên.

Mỗi nhân viên một dòng: tên · thanh ngang · % đạt tổng target.

- **Nền nhạt** của thanh = tổng target của người đó. Thanh của An ngắn hơn ba
  người kia đúng theo hệ số 0,85.
- **Phần đậm** = doanh thu thực, số tiền in bên trong (rớt ra ngoài nếu thanh quá
  ngắn để chứa chữ).
- **Vạch dọc** = target theo timeline.
- Màu: xanh nếu doanh thu ≥ vạch timeline, cam nếu dưới.
- Cả nhóm dùng chung một thang đo (max của mọi doanh thu và mọi target) nên độ dài
  giữa các dòng so sánh được với nhau.
- Sắp xếp giảm dần theo doanh thu, đồng bộ với phần còn lại của dashboard.

Chân card: tổng doanh thu có tên / tổng target đã chia. Có dữ liệu thì vẽ, không
có thì card để trống — không chữ, không ghi chú.

## Trường hợp biên

| Tình huống | Xử lý |
|---|---|
| Tháng chưa có target (09/2026 trở đi) | Không vẽ nền target, thanh co theo doanh thu lớn nhất, % hiện "—" |
| Tháng có target nhưng không ai đứng tên | Target không chia; card để trống |
| Doanh thu vượt tổng target | Thanh chạm 100% chiều dài nền, % vẫn hiện số thật (vd 118%) |
| Không có dòng nào có tên | Card để trống, chỉ còn tiêu đề |

## Phạm vi thay đổi

- `app.js` — hằng số `STAFF_COEF`, khối `staffMatrix` trong `aggregate()`, hàm
  `renderStaffTargets()` thay `renderCashierBar()`.
- `index.html` — thay `chart-card#cashierBarCard` bằng card danh sách.
- `styles.css` — nhóm class `.st-*` cho thanh ngang.
