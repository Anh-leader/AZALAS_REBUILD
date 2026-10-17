# SUPABASE CLONE SCHEMA AUDIT

Ngày audit: 2026-10-16
Trạng thái: **READ-ONLY** (không thực hiện write operation nào lên database).

| Mục | Giá trị |
|---|---|
| Supabase OLD | `ztpysvksgaaskjoevlnb` |
| Supabase NEW (đã clone) | `xnowjjewhjzekvqskjjq` |
| Host đã kết nối | `db.xnowjjewhjzekvqskjjq.supabase.co` |
| Alembic head hiện tại | `20261015_0022` (22 revisions) |
| Có bảng `alembic_version` trong clone | **KHÔNG** |

---

## TÓM TẮT (TL;DR)

Clone Supabase OLD → NEW **không phải** là schema của ứng dụng hiện tại. Clone chứa
**schema LEGACY** (các bảng `az_*` + các bảng tiếng Anh cũ của hệ Google Apps Script),
gồm **53 bảng** và **6 enum type** legacy. Trong khi `alembic upgrade head` tạo ra
**72 bảng** của ứng dụng FastAPI hiện tại và **không dùng enum type** nào.

Kết luận quan trọng nhất:

> **KHÔNG tồn tại revision Alembic nào khớp với schema đã clone.** Không thể
> `alembic stamp <revision>` một cách an toàn, và cũng **KHÔNG nên** chạy
> `alembic upgrade head` trên clone này.

---

## 1. DATABASE SCHEMA (schema thực tế trong Supabase NEW)

- **53 bảng** public, **6 enum type**, **0 bảng `alembic_version`**.
- Tất cả đều là schema **legacy** của hệ cũ (Google Apps Script → SQL cũ).

### 1.1 Các enum type trong DB (6)

`az_invoice_status`, `az_order_status`, `az_order_type`, `az_return_status`,
`az_role`, `order_status`

### 1.2 Toàn bộ 53 bảng trong clone

**Bảng legacy nhóm `az_*` (26):**

`az_customer_opening_debts`, `az_customers`, `az_cutter_settlement_lines`,
`az_cutter_settlements`, `az_cutter_transactions`, `az_debt_slip_items`,
`az_debt_slips`, `az_house_payment_allocations`, `az_house_settlement_lines`,
`az_house_settlements`, `az_house_transactions`, `az_invoice_return_lines`,
`az_product_variants`, `az_profiles`, `az_return_receipt_counters`, `az_staff`,
`az_staff_advances`, `az_staff_attendance`, `az_staff_rate_history`,
`az_stock_balances`, `az_stock_movements`, `az_warehouses`

**Bảng legacy tên cũ (21):**

`cutters`, `daily_counters`, `hr_audit_log`, `hr_monthly_attendance`,
`hr_rate_history`, `invoice_lines`, `invoice_order_links`, `invoice_payments`,
`order_images`, `order_units`, `pattern_catalog`, `pattern_entry_slips`,
`pattern_events`, `pattern_fabrics`, `pattern_job_images`, `pattern_job_size_plans`,
`pattern_jobs`, `pattern_receipts`, `return_slips`, `sewing_houses`, `sewing_rates`,
`supply_entries`, `supply_partners`, `supply_payments`, `supply_price_history`

**6 bảng trùng TÊN với ứng dụng nhưng cấu trúc khác hẳn (xem §3.4):**

`invoices`, `order_groups`, `order_items`, `order_status_events`, `pattern_notes`,
`return_items`

---

## 2. CODE TARGET SCHEMA (schema mà `alembic upgrade head` tạo ra)

- **72 bảng**, **0 enum type** (ứng dụng dùng `String` + check constraint / logic Python,
  không dùng native PostgreSQL enum).
- Head = `20261015_0022`.

### 2.1 Chuỗi migration đầy đủ

| Revision | Mô tả |
|---|---|
| `20261009_0001` | MVP baseline — `Base.metadata.create_all()` (toàn bộ model hiện tại) |
| `20261009_0002` | inventory & atomic picking |
| `20261009_0003` | sales lifecycle: shipping, invoice, payment, **debt**, returns |
| `20261009_0004` | production batches, workshops, cutting |
| `20261009_0005` | partners, material purchasing, settlements |
| `20261009_0006` | employees, attendance, salary advances, payroll |
| `20261009_0007` | RBAC + revocable refresh sessions |
| `20261010_0008` | invoice capture image + soft-delete pending invoice orders |
| `20261010_0009` | attendance bonus + employee rate history |
| `20261011_0010` | production batch media |
| `20261011_0011` | size plan variant (hiệu) |
| `20261012_0012` | receipt negative adjustment |
| `20261012_0013` | batch imported-to-stock quantity |
| `20261012_0014` | zipper price history |
| `20261012_0015` | zipper month transactions |
| `20261012_0016` | embroidery month transactions |
| `20261012_0017` | nhat-in month transactions + settlement media |
| `20261012_0018` | multiple Japanese printing settlements/month |
| `20261012_0019` | printing partner transactions |
| `20261012_0020` | fabric intake receipts |
| `20261013_0021` | **media/R2**: `media_objects.storage_provider` + `checksum` |
| `20261015_0022` | **invoice drafts**: tạo bảng `invoice_drafts` |

### 2.2 Các lĩnh vực người dùng yêu cầu kiểm tra đặc biệt

| Lĩnh vực | Migration | Kết quả |
|---|---|---|
| **media / R2** | `20261013_0021` | `media_objects.storage_provider`, `media_objects.checksum` |
| **invoice drafts** | `20261015_0022` | bảng `invoice_drafts` + 4 FK + 1 index |
| **debt** | `20261009_0003` | `debt_ledger_entries`, `party_debt_balances`, `payments`, `payment_allocations` + trigger bất biến |
| **release claim** | *(không có migration riêng)* | `orders.claimed_by` / `orders.claimed_at` nằm trong baseline `0001`; chỉ là logic service (`services/orders.py`, `services/order_metrics.py`) |
| **order metrics** | *(không có migration riêng)* | thuần tính toán từ `services/order_metrics.py`; không thay đổi schema |
| **Các thay đổi sau khi OLD được tạo** | toàn bộ `0001` → `0022` | clone hiện tại KHÔNG chứa bất kỳ bảng nào của ứng dụng |

---

## 3. SCHEMA DIFFERENCES

### 3.1 Bảng giống nhau (tên trùng khớp)

**6 bảng** có tên trùng với model hiện tại: `invoices`, `order_groups`, `order_items`,
`order_status_events`, `pattern_notes`, `return_items`.

> ⚠️ Trùng **tên** nhưng **cấu trúc khác hẳn** (xem §3.4). Đây là các bảng legacy trùng
> tên tình cờ, KHÔNG phải bảng của ứng dụng.

### 3.2 Bảng chỉ có trong DB (47 — bảng legacy, KHÔNG có trong code)

Toàn bộ 47 bảng `az_*` + legacy cũ liệt kê ở §1.2 (26 `az_*` + 21 tên cũ).

### 3.3 Bảng chỉ có trong code (66 — bảng ứng dụng THIẾU trong clone)

`attendance_records`, `audit_logs`, `batch_material_deliveries`,
`batch_material_delivery_lines`, `colors`, `customers`, `cutting_reports`,
`cutting_teams`, `debt_ledger_entries`, `embroidery_month_transactions`,
`employee_rate_history`, `employees`, `fabric_receipt_lines`, `fabric_receipts`,
`fabric_types`, `inventory_balances`, `inventory_reservation_lines`,
`inventory_reservations`, `inventory_transactions`, `invoice_captures`,
`invoice_drafts`, `invoice_orders`, `material_price_history`,
`material_receipt_lines`, `material_receipts`, `material_variants`, `materials`,
`media_objects`, `nhat_in_month_transactions`, `order_item_revisions`,
`order_media`, `orders`, `partner_files`, `partner_settlement_lines`,
`partner_settlements`, `partner_transactions`, `partners`, `party_debt_balances`,
`pattern_prices`, `payment_allocations`, `payments`, `payroll_lines`,
`payroll_runs`, `permissions`, `product_variants`, `production_batch_media`,
`production_batch_size_plans`, `production_batches`, `production_receipt_lines`,
`production_receipts`, `products`, `refresh_tokens`, `returns`,
`role_permissions`, `roles`, `salary_advances`, `supplemental_workshop_deliveries`,
`user_roles`, `users`, `warehouse_locations`, `warehouses`,
`workshop_pattern_prices`, `workshop_settlement_lines`, `workshop_settlements`,
`workshops`, `zipper_month_transactions`

### 3.4 Cột thiếu / thừa trên 6 bảng trùng tên

| Bảng | Cột thiếu trong DB (code có, DB không) | Cột thừa trong DB (DB có, code không) |
|---|---|---|
| `invoices` | `invoice_no`, `issued_at`, `subtotal_amount`, `surcharge_amount`, `return_credit_amount`, `paid_amount`, `balance_amount`, `debt_before_amount`, `debt_after_amount`, `template_version`, `snapshot`, `captured_invoice_media_id`, `captured_at`, `version`, `idempotency_key`, `void_idempotency_key`, `updated_at` | `invoice_code`, `invoice_image_path`, `subtotal`, `customer_name`, `old_debt_snapshot`, `old_debt_override`, `old_debt_applied_delta`, `old_debt_before_override`, `old_debt_reversed_at`, `finalized_at`, `finalized_by`, `draft_updated_at`, `deleted_at`, `deleted_by` |
| `order_groups` | `group_no` | `root_code`, `customer_name`, `customer_phone`, `customer_address`, `delivery_date`, `transport_station`, `transport_phone`, `order_type`, `creator_note`, `is_urgent`, `created_by` |
| `order_items` | `order_id`, `product_variant_id`, `product_name_snapshot`, `sales_code_snapshot`, `internal_code_snapshot`, `color_snapshot`, `size_snapshot`, `warehouse_id`, `unit_price_amount`, `line_total_amount`, `sale_type`, `product_image_url_snapshot`, `notes`, `revision_no`, `active`, `created_at`, `updated_at` | `unit_id`, `variant_id`, `product_name`, `color`, `size`, `unit_price`, `line_total` |
| `order_status_events` | `order_id`, `actor_user_id`, `reason`, `occurred_at` | `unit_id`, `actor_id`, `actor_name`, `action`, `created_at` |
| `pattern_notes` | `note_no`, `title`, `content`, `client_token`, `folder_legacy_id`, `media_ids`, `updated_at` | `pattern_id`, `note`, `image_path` |
| `return_items` | `return_id`, `product_variant_id`, `description_snapshot`, `unit_credit_amount`, `line_credit_amount`, `condition`, `restock` | `slip_id`, `line_no`, `product_name`, `item_condition`, `unit_price`, `line_total` |

### 3.5 Type / nullable khác

- **14 `AlterColumnOp`** trên các bảng trùng tên (type/nullable/server-default khác nhau),
  chủ yếu do legacy dùng `BIGINT`/`TEXT`/`VARCHAR` khác với model hiện tại.
- Các bảng legacy dùng `BIGINT` identity làm PK; ứng dụng dùng `UUID` (`sa.Uuid`) làm PK.
- Timestamp: legacy dùng `TIMESTAMP WITHOUT TIME ZONE`/`TEXT`; ứng dụng dùng
  `TIMESTAMP WITH TIME ZONE`.

### 3.6 Indexes khác

- **42 index** legacy sẽ bị drop (chỉ thuộc các bảng legacy).
- **117 index** cần tạo (thuộc 66 bảng ứng dụng thiếu + 6 bảng trùng tên).

### 3.7 FK khác

- **12 `CreateForeignKeyOp`** cần tạo (trên 6 bảng trùng tên).
- **17 constraint** legacy cần drop.
- Toàn bộ FK của 66 bảng ứng dụng thiếu (nằm trong `create_table`) đều chưa tồn tại.

### 3.8 Enum khác

| | Enum |
|---|---|
| Trong DB (legacy) | `az_invoice_status`, `az_order_status`, `az_order_type`, `az_return_status`, `az_role`, `order_status` (6) |
| Trong code | **0** (ứng dụng không dùng native enum) |

---

## 4. SAFE BASELINE REVISION

> **NONE — không tồn tại.**

Schema đã clone là schema **legacy** (hệ cũ), không phải snapshot của bất kỳ revision
Alembic nào của ứng dụng. Không thể chọn một revision nào để `alembic stamp` một cách
trung thực.

- Revision `0001` (baseline) dùng `Base.metadata.create_all(checkfirst=True)` — tức
  target của nó đã là **72 bảng** hiện tại, khác hoàn toàn 53 bảng legacy trong clone.
- Không có revision nào "tương đương gần nhất" vì toàn bộ chuỗi `0001 → 0022` đều mô tả
  schema ứng dụng mới.

---

## 5. PENDING MIGRATIONS

Không áp dụng được khái niệm "migration còn thiếu" vì **không thể stamp baseline**.

- Nếu cưỡng ép chạy `alembic upgrade head` từ trạng thái hiện tại (không có
  `alembic_version`), Alembic sẽ chạy **cả 22 migration** từ `0001`:
  - `0001` sẽ `create_all` **66 bảng ứng dụng còn thiếu** (checkfirst bỏ qua 6 bảng
    trùng tên legacy) nhưng **KHÔNG xóa 47 bảng legacy**.
  - Các migration sau sẽ `ADD COLUMN`/`CREATE FK` lên **6 bảng trùng tên có cấu trúc
    legacy sai** → gần như chắc chắn **fail** (ví dụ thêm FK tới `users.id` khi `users`
    vừa được tạo nhưng cột tham chiếu legacy không đúng kiểu UUID).
  - Kết quả cuối cùng: schema lai tạp (66 bảng mới + 47 bảng legacy rác + 6 bảng sai
    cấu trúc), không dùng được cho ứng dụng.

---

## 6. SAFE ALEMBIC PLAN

**KHÔNG chạy** `alembic upgrade head` và **KHÔNG chạy** `alembic stamp` trên clone này.

Có 2 hướng an toàn (chọn theo đúng nguồn dữ liệu mong muốn):

### Hướng A — Clone lại từ ĐÚNG nguồn ứng dụng (khuyến nghị nếu mục tiêu là giữ DB ứng dụng)

1. Xác định lại nguồn: Supabase OLD `ztpysvksgaaskjoevlnb` đang chứa **schema legacy**,
   không phải DB ứng dụng. Cần tìm đúng project chứa DB ứng dụng (có bảng
   `customers`, `orders`, `users`, ... **và có bảng `alembic_version`**).
2. Clone đúng project đó → NEW.
3. Xác minh: `SELECT version_num FROM alembic_version;` phải trả về `20261015_0022`
   (hoặc revision thực tế), và `information_schema` phải có các bảng ứng dụng.
4. Nếu revision thực tế < head, chạy đúng số migration còn thiếu.

### Hướng B — Build schema ứng dụng FRESH, rồi migrate dữ liệu legacy

1. Tạo DB mới sạch (hoặc chấp nhận reset public schema của NEW — lưu ý: người dùng đã
   cấm reset trong task này).
2. Từ `apps/api`:
   ```powershell
   Set-Location 'D:\Vibecode_app\AZALAS_REBUILD\apps\api'
   .\.venv\Scripts\python.exe -m alembic upgrade head
   .\.venv\Scripts\python.exe -m app.seed
   ```
   → tạo đúng **72 bảng** + `alembic_version = 20261015_0022`.
3. Migrate **dữ liệu** legacy → schema ứng dụng bằng các script có sẵn:
   - `scripts.migration.phase1` (Google Sheets → app schema)
   - `scripts.migration.merge` (Supabase OLD app-schema ↔ Sheets)
4. Nếu vẫn muốn giữ dữ liệu legacy trong cùng DB, đổi tên schema legacy thành schema
   riêng (ví dụ `legacy`) rồi build app schema ở `public`; tránh để 2 bộ schema lẫn nhau.

> Lưu ý: hướng B chỉ chạy `alembic upgrade head` trên **DB trống** (hoặc sau khi đã
> di dời schema legacy ra khỏi `public`). Không chạy lên clone hiện tại.

---

## 7. RISKS

1. **`alembic stamp <revision>` là hành động sai** — nó sẽ ghi `alembic_version` vào một
   DB không tương ứng, khiến Alembic nghĩ schema đã đúng trong khi thực tế sai hoàn toàn.
2. **`alembic upgrade head` trên clone sẽ fail hoặc tạo schema lai tạp** (xem §5), để lại
   47 bảng legacy + 6 bảng sai cấu trúc.
3. **Mất dữ liệu tiềm ẩn** nếu ai đó chạy `0001.downgrade()` (`Base.metadata.drop_all`)
   hoặc script `supabase_clone_backup/reset_new_public.py` (`DROP SCHEMA public CASCADE`).
4. **Sai nguồn clone**: nếu ý định là clone DB ứng dụng, thì đã clone nhầm project legacy.
   Toàn bộ dữ liệu nghiệp vụ mới (customers/orders/debt/media của ứng dụng) KHÔNG có mặt
   trong clone này.
5. **Enum legacy** (`az_*`, `order_status`) còn tồn tại trong `public`; nếu sau này build
   app schema chung `public`, các type này sẽ xung đột tên với ý nghĩa ứng dụng.

---

## 8. CAN CONNECT APP NOW: **NO**

Ứng dụng (FastAPI, `apps/api`) sẽ fail vì các bảng cốt lõi của nó — `users`, `customers`,
`orders`, `products`, `inventory_*`, `media_objects`, ... — **không tồn tại** trong
Supabase NEW. Clone hiện tại chỉ chứa schema legacy của hệ cũ.

---

## Phụ lục — phương pháp audit

- Đọc URL từ `.env.production` (`SUPABASE_DATABASE_URL` → `db.xnowjjewhjzekvqskjjq.supabase.co`).
- Diff bằng `alembic.autogenerate.produce_migrations(MigrationContext, Base.metadata)`
  (chính là engine mà `alembic revision --autogenerate` dùng) — so sánh **live schema**
  với **target metadata** (`apps/api/app/models.py`).
- Enum types đọc từ `pg_type` (schema `public`, `typtype='e'`).
- Không có bất kỳ write operation nào lên database.
