# LEGACY → CURRENT MIGRATION PLAN (Cutover Safety)

Ngày: 2026-10-16
Trạng thái: **PLAN / DRY-RUN ONLY** — chưa chạy `--apply`, chưa ghi NEW.

Dry-run hiện tại đạt: PAYMENTS.unmapped_method=0, ORDERS.unmapped_status=0,
ORPHANS=0, DEBT.difference_count=0, DEBT.old_total==projected_new_total,
INVOICE_LINE invalid_total=0.

---

## A. USER MIGRATION PLAN

### A.1 Nguồn dữ liệu (11 users)

| login_name | display_name | role (legacy) | role (NEW) | status |
|---|---|---|---|---|
| admin | Admin | OWNER | OWNER | ACTIVE |
| trangha | Trang Hà | OWNER | OWNER | ACTIVE |
| hale | Hạ Lê | ADMIN | ADMIN | ACTIVE |
| thupham | Thư Phạm | MEMBER | MEMBER | ACTIVE |
| thuy | Thúy | MEMBER | MEMBER | ACTIVE |
| hoang | Hoàng | MEMBER | MEMBER | ACTIVE |
| ly | Lý | MEMBER | MEMBER | ACTIVE |
| phuc | Phúc | MEMBER | MEMBER | ACTIVE |
| minhthu | Thư Nhỏ | MEMBER | MEMBER | ACTIVE |
| ty | Ty | MEMBER | MEMBER | ACTIVE |
| tri | Trí | MEMBER | MEMBER | ACTIVE |

### A.2 Quy tắc mapping user

- `az_profiles.id` (uuid) giữ nguyên làm `users.id`.
- `login_name` → `users.username` (unique).
- `display_name` → `users.display_name`.
- `role` → `users.role` (az_role enum == NEW role code, 1:1).
- `is_active` → `users.status` (true=ACTIVE, false=INACTIVE).
- `phone` → `users.phone`.
- `password_hash`: **KHÔNG copy plaintext, KHÔNG hash giả.** Xem A.3.

### A.3 Password strategy (bắt buộc)

Legacy `az_profiles` KHÔNG có mật khẩu tương thích (Supabase Auth dùng schema `auth.users`).
NEW `users.password_hash` NOT NULL, xác thực bằng `bcrypt` (`hash_password` trong
`app/core/security.py`).

**Chiến lược chọn: (a) temporary password + (b) force reset.** Cụ thể:

1. **Temporary password được hash bằng `hash_password()` của chính auth service** —
   KHÔNG tự viết bcrypt riêng, tránh lệch định dạng hash.
2. **KHÔNG hard-code password trong source.** Chỉ nhận qua env một lần:
   - `MIGRATION_TEMP_PASSWORD` (bắt buộc khi `--apply`)
   - `MIGRATION_TEMP_PASSWORD_OWNER` (tùy chọn, riêng cho OWNER/ADMIN)
   Nếu thiếu env → `--apply` **abort** trước khi ghi.
3. **KHÔNG log password.** Không in ra console/report. Chỉ ghi vào một file `.env`
   đã git-ignore (được tạo thủ công bởi operator).
4. Mọi user được gán `must_change_password = true` ngầm qua một chiến lược
   "force reset": NEW hiện chưa có cột `must_change_password`, nên lựa chọn an toàn
   tối thiểu là **bắt buộc đổi mật khẩu qua endpoint `/auth/change-password`** ngay
   sau lần đăng nhập đầu (operator thực hiện). Nếu cần hard-enforce, thêm cột
   `users.must_change_password boolean default false` ở một migration riêng (ngoài
   scope dry-run này).

### A.4 OWNER LOGIN PLAN

Đảm bảo ít nhất 1 OWNER đăng nhập được ngay sau apply:

1. Trước `--apply`, operator đặt `MIGRATION_TEMP_PASSWORD_OWNER` (env).
2. Apply gán `password_hash = hash_password(MIGRATION_TEMP_PASSWORD_OWNER)` cho
   `admin` và `trangha` (2 OWNER).
3. Sau apply, operator đăng nhập `/api/v1/auth/login` bằng `admin`/temp-password.
4. Gọi `/api/v1/auth/change-password` để đặt mật khẩu thật.
5. Các user MEMBER/ADMIN còn lại dùng `MIGRATION_TEMP_PASSWORD` chung, operator
   chủ động reset sau.

> Trong dry-run, chỉ báo cáo "sẽ cần temporary password"; KHÔNG sinh/ghi hash.

---

## B. INVOICE LINE SOURCE

### B.1 Kết luận reconstruction (đã audit thực tế)

- Legacy có bảng **`invoice_lines`** (60 rows) với `source_item_id` → `order_items.id`,
  và **`source_item_id` KHÔNG null với 100% rows**.
- `invoice_order_links(invoice_id, unit_id)` → mỗi hóa đơn có N đơn.
- Mỗi order item của đơn liên kết có **đúng 1** `invoice_lines` row (1:1).
- **`SUM(invoice_lines.line_total) == invoices.subtotal` cho TOÀN BỘ 37 hóa đơn**
  (difference = 0.00 ở mọi dòng).

### B.2 Vì sao KHÔNG dùng `order_items` hiện tại để reconstruct

`order_items.line_total` hiện tại đã **drift** sau khi chốt hóa đơn (user sửa đơn
sau invoice). Ví dụ: invoice `121020260001` (id=2): order_item hiện = 3000, nhưng
invoice_line (frozen) = 2160. NEW `preview_invoice` tính lại từ `_active_items`
sẽ ra SAI subtotal.

**Quy tắc đúng:** `invoice_lines` là **snapshot đông lạnh** tại thời điểm chốt hóa
đơn. NEW phải import giá trị từ `invoice_lines`, không phải từ `order_items` hiện tại.

### B.3 Ánh xạ sang NEW

| Legacy | NEW |
|---|---|
| `invoices.subtotal` | `Invoice.subtotal_amount` = `SUM(invoice_lines.line_total)` |
| `invoice_lines` row | item trong `Invoice.snapshot["orders"][].items[]` |
| `invoice_order_links` | `InvoiceOrder(invoice_id, order_id, amount)` |
| `invoice_lines.source_item_id` | `legacy_id_mapping` → `order_items` uuid (để trace) |

Mỗi snapshot item giữ nguyên: `product_name`, `color`, `size`, `quantity`,
`unit_price`, `line_total` (frozen).

### B.4 INVOICE LINE RECONCILIATION (kết quả dry-run)

- 37 hóa đơn, 106 dòng (60 invoice_lines + 46 links).
- `SUM(generated_line_total) == source_subtotal` cho **37/37** hóa đơn.
- **INVALID_INVOICE_LINE = 0.**

### B.5 INVALID INVOICE LINES

Không có trường hợp invalid. Nếu phát sinh (difference != 0), rule xử lý:
**KHÔNG apply hóa đơn đó âm thầm** — đưa vào `invalid_invoice_lines` và chặn apply
cho riêng invoice đó (skip + báo cáo, không block toàn bộ).

---

## C. MEDIA PHASE PLAN

### C.1 Phân loại hiện tại (dry-run)

| metric | count |
|---|---|
| media_existing | 207 |
| media_downloadable | 207 |
| media_missing | 0 |
| media_uploaded | 0 (chưa chạy) |
| media_failed | 0 |

207 media = `order_images` (207) + `pattern_job_images` (0) — tất cả đều có
`storage_path` hợp lệ dạng `{user_id}/{group_id}/{uuid}.png` (Supabase Storage).

### C.2 PHASE 1 — metadata + relation (có thể chạy trong apply)

1. Tạo `media_objects` row với:
   - `object_key` = legacy `storage_path` (giữ nguyên để truy ngược).
   - `storage_provider` = `"legacy"` (KHÔNG phải `r2`/`local` — chưa upload).
   - `storage` = `"LEGACY_DRIVE"` (đánh dấu nguồn cũ).
   - `status` = `"PENDING_UPLOAD"` (chưa có file thật trong R2).
   - `content_type` = `image/png` (từ đuôi .png).
   - `checksum`/`sha256` = `""` (sẽ điền ở phase 2).
2. Relation: `order_images.group_id` → order group → các `order_units` trong group →
   `order_media(order_id, media_id)`.
3. NEW app vẫn đọc được: endpoint `/media/{id}/view` fallback trả legacy URL/storage
   path (hoặc chặn `PENDING_UPLOAD` với message rõ ràng).

### C.3 PHASE 2 — upload R2 (KHÔNG chạy trong task này)

1. Với mỗi `media_objects` có `status=PENDING_UPLOAD`:
   - Download legacy file (từ OLD Supabase Storage hoặc nguồn đã đồng bộ).
   - Tính `sha256` checksum.
   - Upload lên R2 (`storage_service.put`) → nhận `version_id`.
   - Cập nhật: `storage_provider='r2'`, `bucket=azalas-prod-media`,
     `object_key` (chuẩn R2), `checksum=sha256`, `status='READY'`.
2. **Không duplicate:** dedupe theo `sha256` (nếu đã có object cùng checksum thì
   reuse, không upload lại).
3. Report kết thúc: `media_uploaded`, `media_failed` (download fail / checksum fail /
   upload fail), `media_existing`, `media_missing`.

---

## D. FINAL CUTOVER CHECKLIST

1. **Freeze writes** trên OLD (tắt WebApp/API ghi, chỉ READ).
2. **Rerun dry-run** (với OLD đã freeze).
3. **Verify gates:**
   - `unmapped_status = 0`
   - `orphans = 0`
   - `debt_difference = 0`
   - `invoice_line_difference = 0`
4. **Apply** (`--apply`) trong transaction.
5. **Verify target counts** (customers/orders/items/invoices/payments/media).
6. **Verify total debt** (old_total == projected_new_total).
7. **Verify invoice totals** (subtotal khớp).
8. **Verify login OWNER** (admin đăng nhập bằng temp password).
9. **Switch app `DATABASE_URL` → NEW.**
10. **Smoke test** (đăng nhập, xem order, xem invoice, xem media).
11. **Unfreeze chỉ NEW** (OLD giữ read-only/vô hiệu).

### D.1 Nếu OLD thay đổi sau dry-run

- Hỗ trợ **rerun idempotent/incremental**: dựa vào `legacy_id_mapping` + business key
  (`customer_code`/`order_no`/`invoice_no`) để skip record đã migrate; upsert record
  có `updated_at` mới hơn. Apply layer phải:
  - Customer: dedupe `customer_code`.
  - Order: dedupe `order_no`.
  - Invoice: dedupe `invoice_no`.
  - Debt: dedupe `idempotency_key`.
  - Media: dedupe `object_key`/`checksum`.

---

## E. APPLY SAFETY

Trước `--apply`:

1. **NEW phải không có business data** (chỉ schema + system seed: `roles`,
   `permissions`). Hiện tại đã xác minh `customers/orders/invoices/users/...` = 0 rows.
2. **Transaction-safe:** toàn bộ apply chạy trong 1 transaction; nếu lỗi → rollback.
3. **Idempotent:** rerun không duplicate (dùng `legacy_id_mapping` + natural key).
4. **Resumable:** checkpoint theo từng section (customers → orders → ... → media),
   ghi `legacy_id_mapping` sau mỗi batch.
5. **`legacy_id_mapping` persistent:** bảng `legacy_id_mapping(legacy_table,
   legacy_id, new_table, new_uuid, business_key, created_at)` — PK
   `(legacy_table, legacy_id)` chặn trùng.
6. **Không tự chạy `--apply`** (task này).

---

## F. OUTPUT SUMMARY

| Mục | Trạng thái |
|---|---|
| USER MIGRATION PLAN | Xong (A) — temporary password + force reset |
| OWNER LOGIN PLAN | Xong (A.4) — `admin`/`trangha` qua `MIGRATION_TEMP_PASSWORD_OWNER` |
| INVOICE LINE SOURCE | `invoice_lines` (frozen snapshot, source_item_id→order_items) |
| INVOICE LINE RECONCILIATION | 37/37 khớp, difference=0 |
| INVALID INVOICE LINES | 0 |
| MEDIA PHASE PLAN | Phase 1 metadata (207), Phase 2 R2 (chưa chạy) |
| FINAL CUTOVER CHECKLIST | Xong (D) |
| APPLY SAFETY CHECK | Xong (E) |

**READY FOR FINAL DRY RUN: YES**
**READY FOR APPLY: YES** (về dữ liệu + safety), với điều kiện operator thực hiện
đúng checklist A.3/A.4 (password) và D (freeze → verify → apply → verify).
