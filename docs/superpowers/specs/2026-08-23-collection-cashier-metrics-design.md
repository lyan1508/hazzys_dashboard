# Thay ATV/UPT bằng chỉ số cấp dòng ở Collection Performance và Cashier Productivity

Ngày: 2026-08-23

## Vấn đề

Hai bảng `Collection Performance` và `Cashier Productivity` cùng dùng một công
thức hỏng: **tử số là một phần của hóa đơn, mẫu số là cả hóa đơn**.

`ATV = doanh thu của nhóm ÷ số hóa đơn có chứa nhóm đó`. Doanh thu cộng ở cấp
dòng hàng, nhưng số hóa đơn đếm nguyên chiếc. Một bill mua 1 áo SS25 + 1 quần
FW24 được đếm đủ 1 bill cho cả hai dòng, trong khi mỗi dòng chỉ nhận nửa tiền.

Đo trên `Data/DATA.xlsx` (4.380 dòng hàng, 2.046 hóa đơn):

| | Tỉ lệ hóa đơn bị chia | Doanh thu trên các hóa đơn đó |
|---|---|---|
| Nhiều collection trong 1 bill | 30,5% | 54,1% |
| Nhiều thu ngân trên 1 bill | 28,3% | 51,8% |

Cộng cột "số bill" của 7 collection ra 137,7% tổng số bill. Hệ quả: ATV từng
dòng luôn bị kéo xuống, mức kéo xuống lại khác nhau tùy nhóm đó hay được mua
kèm — nên **không so sánh được giữa các dòng** và không cộng lại thành ATV tổng.
UPT hỏng y hệt vì dùng chung mẫu số.

## Quyết định

Bỏ hẳn ATV và UPT khỏi cả hai bảng. Thay bằng chỉ số mà **cả tử lẫn mẫu đều ở
cấp dòng hàng**, không cần phân bổ hóa đơn.

### 1. Collection Performance

`Collection | Revenue | Share | Qty | AUP | Disc%`

- `AUP = amount ÷ qty` — Average Unit Price, giá trung bình một món. Đây là
  thuật ngữ retail chuẩn cho chỉ số này.
- `Disc% = (1 − amount ÷ listValue) × 100`, với `listValue` đã có sẵn ở mỗi
  dòng (`PRICE × QUANTITY`, dùng số lượng có dấu).
- Dòng có `qty ≤ 0` hoặc `listValue ≤ 0` hiện `—`, không hiện `0`.
- Footer TOTAL tính lại từ tổng amount/qty/listValue, không cộng cột.

Số thật cho thấy hai cột mới kể được câu chuyện mà bảng cũ giấu: hàng 2023 đang
xả 19–22%, hàng 2026 gần nguyên giá 5,2%; FW25 có AUP cao nhất (6,28 tr) vì là
đồ khoác, FW24 thấp nhất (3,59 tr).

### 2. Cashier Productivity

`Cashier | Revenue | Share | Qty | Disc% | Acc%`

- `Share` = phần trăm doanh thu trong tổng của các thu ngân có tên.
- `Disc%` — công thức như trên, tính trên các dòng mang tên người đó.
- `Acc%` = số món phụ kiện ÷ tổng số món, dùng `isAccessory(row)` có sẵn
  (ưu tiên cột `DIVISION`, đường lui là bảng `ACC_CATEGORIES`).
- Footer là tổng cột thẳng: mỗi dòng hàng chỉ ghi một tên nên cộng không trùng.
  Toàn bộ cơ chế đếm bill loại trùng trong `cashierTotals` không còn cần.

Các chỉ số đã đo và **loại bỏ** vì không phân hóa giữa 6 thu ngân:

| Chỉ số | Khoảng | Tỉ lệ |
|---|---|---|
| Top category | cả 6 người đều T-Shirt 42–46% | — |
| Tỉ lệ bán chung | 43–51% | 1,19x |
| AUP | 4,76–5,09 tr | 1,07x |
| Khách quen% | 62,1–72,5% | 1,17x |
| Mix nam/nữ | 48,5–59,4% | 1,22x |

AUP phân hóa tốt giữa các collection nhưng gần như phẳng giữa các thu ngân — họ
bán chung một kệ hàng. Hai cột giữ lại là hai cột tách được người: `Disc%` chênh
3x (DINH 3,6% vs TRANG 10,6%), `Acc%` chênh 1,4x (Ý 22,9% vs DINH 16,3%).

### 3. Dọn kèm

`cashierStats` được tính và export nhưng không nơi nào tiêu thụ — nó là bản sao
của `cashierMatrix` bỏ đi atv/upt. Xóa.

## Cảnh báo về cột Disc%

Cột `PRICE` là giá **hiện hành**, cập nhật hồi tố. Món nào từng đổi giá sẽ sinh
chênh lệch ảo giữa giá hôm nay và tiền đã thu năm trước. Con số 19–22% ở
SS23/FW23 nhiều khả năng là xả hàng thật, nhưng không tách sạch được phần ảo.
Ghi chú này đặt vào tooltip đầu cột, giống cách card Promotion đang làm với dòng
NO PROMOTION.

## Phạm vi không đụng tới

- Card `Revenue by Season (SS / FW)` và `seasonMonthly` giữ nguyên.
- Card `Personal Sales` và `staffMatrix` giữ nguyên.
- Hàm `newBillAcc` / `addBill` / `billTotal` vẫn dùng cho KPI tổng, DOW và
  Promotion — không xóa.
