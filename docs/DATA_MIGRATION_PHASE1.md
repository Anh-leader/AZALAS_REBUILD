# DATA MIGRATION PHASE 1 — Google Sheets WebApp → Supabase PostgreSQL

Trạng thái: **BUILD-ONLY** (chưa chạy apply). Schema production đã migrate lên Supabase.
Phase này chỉ migrate **dữ liệu quan hệ**, CHƯA migrate file ảnh (Cloudflare R2 ở phase sau).

## 1. Phạm vi Phase 1

| # | Nghiệp vụ | Sheet nguồn | Target table |
|---|---|---|---|
| 1 | Khách hàng | `tbl_KhachHang` | `customers` |
| 2 | Đơn hàng | `tbl_DonHang` | `orders` |
| 3 | Chi tiết đơn | `tbl_ChiTietDonHang` | `order_items` |
| 4 | Lịch sử trạng thái | `tbl_LichSuTrangThaiDon` | `order_status_events` |
| 5 | Công nợ (lịch sử) | `tbl_NhatKyNo` | `debt_ledger_entries` |
| 6 | Thanh toán khách | `tbl_ThanhToanKhach` | `payments` |
| 7 | Tồn kho hiện tại | `tbl_Kho_BienThe`, `tbl_Kho_Ton` | `product_variants`, `inventory_balances` |
| 8 | Metadata ảnh đơn | `tbl_DonHang_AnhZalo` | `media_objects` + `order_media` |

Chưa migrate (phase sau / ngoài scope):
- `tbl_HangTra`, `tbl_ChiTietHangTra` → `returns` / `return_items` (chưa trong phase 1).
- `tbl_Kho_TheKho` → không giả lập lịch sử nhập/xuất; chỉ import snapshot tồn (`inventory_balances`).
- File ảnh thật → R2 (phase 2).

## 2. Legacy identifiers (bảo toàn tuyệt đối)

| Legacy | Target column | Key |
|---|---|---|
| `MaKhachHang` | `customers.customer_code` | UNIQUE |
| `MaHoaDon` | `orders.order_no` | UNIQUE |
| `MaAnh` | `media_objects.object_key` (`legacy:<MaAnh>`) | dedupe |

Không đổi sang UUID làm mất mã cũ: mã legacy luôn nằm trong target dưới dạng natural key.

## 3. Mapping tập trung

Xem `scripts/migration/phase1/mappings.py` (đúng source-of-truth). Tóm tắt:

### Warehouse (`KhoXuat` → `warehouses.code`)
`TAN_XUAN`, `CA_KOI` (fallback `TAN_XUAN` khi không nhận dạng được, kèm báo cáo `unmapped_warehouse`).

### Order status (`TrangThai` → `orders.status`)
`NEW`, `PICKING`, `PICKED`, `SHIPPING`, `COMPLETED`, `DEBT_ORDER`, `CANCELLED`, `DELETED`, `RETURNED`.
Không map được → `UNMAPPED_STATUS` trong báo cáo (không đoán; fallback `NEW`).

### Billing status (`TrangThaiHoaDon` → `orders.billing_status`)
`DRAFT`, `READY`, `SENT`, `PAID`, `PARTIALLY_PAID`.

### Order type (`KieuDon`/`LoaiDon` → `orders.order_type`)
`NORMAL` | `CUSTOMER_ORDER`.

### Debt entry type (`tbl_NhatKyNo.loai` → `debt_ledger_entries.entry_type`)
`INVOICE`, `ADJUSTMENT`, `PAYMENT`, `RETURN_CREDIT`, `SURCHARGE`.

### Cột nguồn → cột đích (chi tiết)

| Sheet | Cột nguồn | Cột đích | Transform |
|---|---|---|---|
| tbl_KhachHang | MaKhachHang | customer_code | giữ nguyên |
| tbl_KhachHang | TenKhachHang | name | giữ nguyên |
| tbl_KhachHang | SDT | phone | giữ nguyên |
| tbl_KhachHang | DiaChi | address | giữ nguyên |
| tbl_KhachHang | NhomKhach | customer_group | default `Khách lẻ` |
| tbl_KhachHang | TrangThai | status | map ACTIVE/INACTIVE + deleted_at |
| tbl_KhachHang | ChanhXe / SDTChanhXe | carrier_name / carrier_phone | giữ nguyên |
| tbl_DonHang | MaHoaDon | order_no | giữ nguyên |
| tbl_DonHang | MaKH | customer_id | resolve UUID theo customer_code |
| tbl_DonHang | NguoiSoan | claimed_by | (chưa map user; để trống + báo cáo) |
| tbl_DonHang | TrangThai / TrangThaiHoaDon | status / billing_status | map |
| tbl_DonHang | LoaiDon / KieuDon | order_type | map NORMAL/CUSTOMER_ORDER |
| tbl_DonHang | NgayTao / NgayGiao | created_date / delivery_date | parse ISO date |
| tbl_DonHang | TongTien / DaThanhToan / NoTrongHoaDon | total/paid/invoice_balance | VND int |
| tbl_DonHang | GhiChuKhach / GhiChuNV | customer_note / staff_note | giữ nguyên |
| tbl_DonHang | KenhBan | source_channel | map ZALO/… |
| tbl_ChiTietDonHang | TenSP / SoLuong / DonGia / ThanhTien | product_name_snapshot / quantity / unit_price / line_total | validate SL×Giá vs Thành tiền |
| tbl_ChiTietDonHang | MaBanHang / MaHangNoiBo / MauChuan / Size / KieuBan / GhiChu | sales_code / internal_code / color / size / sale_type / notes | snapshot |
| tbl_LichSuTrangThaiDon | … | order_status_events | map from/to status |
| tbl_NhatKyNo | … | debt_ledger_entries | map entry_type + dấu delta |
| tbl_ThanhToanKhach | … | payments | RECEIPT, method map |
| tbl_CongNo_TongHop | SoNo | (đối soát) | so với SUM(amount_delta) |
| tbl_Kho_BienThe | … | product_variants | resolve/insert variant |
| tbl_Kho_Ton | … | inventory_balances | snapshot mở |

## 4. Idempotency & safety

- Customer dedupe theo `customer_code`; không tự merge trùng tên khác mã (chỉ báo cáo).
- Order dedupe theo `order_no`; order_item chỉ import cho đơn mới.
- Debt/Payment dedupe theo `idempotency_key` từ legacy id.
- Inventory dedupe theo `(variant_id, warehouse_id, location_id)`.
- Media dedupe theo `object_key = legacy:<MaAnh>`.
- `--dry-run` là mặc định; `--apply` phải chỉ định rõ và chạy trong transaction.

## 5. Chạy

```powershell
# 1) Chỉ đọc nguồn + target, KHÔNG write (bắt buộc chạy trước):
Set-Location 'D:\Vibecode_app\AZALAS_REBUILD\apps\api'
$env:DATABASE_URL='<SUPABASE_DATABASE_URL>'   # chỉ khi chạy lên Supabase
.\.venv\Scripts\python.exe -m scripts.migration.phase1 --dry-run --source-dir '<thư mục chứa file export>'

# 2) Apply (chỉ sau khi dry-run + reconciliation đạt difference = 0):
.\.venv\Scripts\python.exe -m scripts.migration.phase1 --apply --source-dir '<dir>'
```

## 6. Reconciliation (công nợ)

`tbl_CongNo_TongHop` là nguồn đối soát; target = `SUM(debt_ledger_entries.amount_delta)`.
Báo cáo ra `debt_reconciliation.csv` với `customer_code / source_debt / target_calculated_debt / difference / proposed_adjustment`.
**Điều kiện cutover: toàn bộ `difference = 0`.** Nếu lệch, apply sẽ tạo opening `ADJUSTMENT` entry (chưa implement auto-apply; cần operator xác nhận).

## 7. Output

- `migration_reports/<timestamp>/report.json` — toàn bộ thống kê + bất thường.
- `migration_reports/<timestamp>/debt_reconciliation.csv` — đối soát công nợ.
- `migration_reports/<timestamp>/media_mapping.csv` — mapping `MaAnh → media_id → order_no → drive_link` cho phase R2.

## 8. Risks / chưa map

- `NguoiSoan` → `orders.claimed_by`: chưa map sang user UUID (thiếu mapping tên↔user); cần bảng tham chiếu riêng.
- Media `uploader`/`note` không có cột target → giữ trong `media_mapping.csv` (sidecar) cho phase R2.
- Product/Color master (`tbl_Kho_HangHoa`, `tbl_MauSac`) nằm ngoài phase 1; nếu chưa có trong DB thì variant/inventory row sẽ báo `unmapped_variant`.
