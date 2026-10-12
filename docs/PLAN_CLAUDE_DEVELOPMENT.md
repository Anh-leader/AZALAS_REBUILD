# KẾ HOẠCH PHÁT TRIỂN VỚI CLAUDE — AZALAS REBUILD

> Tài liệu hướng dẫn dùng Claude (Claude Code / AI coding assistant) để tiếp tục phát triển dự án AZALAS.
> Ngày khảo sát: 10/10/2026. Phiên bản: 1.0.
> Người đọc: chủ sản phẩm / dev tự làm với Claude.

---

## 0. Hiện trạng (đã xác minh)

Dự án đã đi được một đoạn xa, **không phải bắt đầu từ zero**.

### Backend — FastAPI (gần đủ)
- 16 router: `auth, admin, dashboard, customers, orders, inventory, media, shipping, invoices, payments, debt, returns, production, materials, hr, reports`
- 9 service: `finance, hr, inventory, materials, orders, production, returns, shipping, storage`
- `models.py` ~851 dòng, 7 migration Alembic (`0001`–`0007`), 2 importer + seed, 9 file test
- Đã có RBAC, refresh token, idempotency, immutable ledger, upload local/S3 skeleton

### Frontend — React (MVP, còn thiếu nhiều màn)
- App một trang dùng `useState<Page>` (chưa dùng React Router), ~10 page component
- Đã có luồng chính: đăng nhập, dashboard, tạo đơn, chi tiết đơn/soạn, vận chuyển, hóa đơn, hàng trả, khách hàng, QL Rập, phụ liệu, nhân sự, báo cáo, admin, đổi MK
- **Thiếu**: cây `/inventory/*` (balances, variants, receipts, issues, transfers, counts, adjustments, ledger, reports), sub-screen `/production/*`, `/materials/*`, `/customers/:id`, `/images`, `/profile`, `/admin/overview`
- Chưa có: React Hook Form + Zod, generated OpenAPI client (spec mục 5.3/5.4 khuyến nghị)

### Tài liệu / nguồn tham chiếu
| Nguồn | Vị trí | Vai trò |
|---|---|---|
| Spec kỹ thuật (1368 dòng) | `docs/AZALAS_TECHNICAL_CONTEXT_SPECIFICATION.md` | Hợp đồng hành vi + kiến trúc |
| Legacy Apps Script | `legacy/Code.gs` (~21.5k dòng), `legacy/Index.html` (~57.6k dòng) | Nguồn chân lý cho hành vi UI |
| Ảnh chụp UI cũ | `reference-ui/*.png` (42 ảnh) | Visual baseline |

### Git — ⚠️ CHƯA CHUẨN
Repo hiện trỏ về gốc `D:/` (master, **0 commit**). Phải khởi tạo repo riêng cho project trước khi để Claude code, nếu không không thể diff/revert.

### 3 gap chính
1. Git chưa có commit baseline.
2. Frontend thiếu ~20 màn trong 34 màn của spec.
3. Hạ tầng production chưa dựng: Redis, Celery, S3 private, ETL/reconciliation.

---

## 1. Bước 1 — Thiết lập nền tảng (làm 1 lần)

### 1.1 Khởi tạo git đúng chỗ
```powershell
cd d:\Vibecode_app\AZALAS_REBUILD
git init
# thêm .gitignore đã có sẵn; kiểm tra loại .venv, node_modules, uploads, dist
git add -A
git commit -m "chore: baseline AZALAS rebuild (pre-AI continuation)"
```
> Lưu ý: `.gitignore` hiện có trong project; xác nhận nó loại `.venv/`, `node_modules/`, `apps/api/uploads*`, `apps/web/dist`, `*.db`.

### 1.2 Xác nhận "green baseline" (chạy được trước khi sửa)
```powershell
docker compose up -d db
Set-Location apps/api
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m app.seed --mode demo
python -m pytest -q -p no:cacheprovider

Set-Location ../web
npm ci
npm run build
npm test
```
Ghi lại kết quả test hiện tại làm baseline; sau mỗi task của Claude phải so với baseline này.

### 1.3 Tạo `CLAUDE.md` (quan trọng nhất)
Đặt file `CLAUDE.md` ở gốc `d:\Vibecode_app\AZALAS_REBUILD\`. Claude tự nạp file này mỗi lần chạy nên không cần nhắc lại context. Nội dung mẫu — xem **Mục 5** bên dưới (copy nguyên).

---

## 2. Bước 2 — Roadmap theo phase

### Phase 0 — Nền tảng (1 buổi)
- [ ] git init + commit baseline
- [ ] Tạo `CLAUDE.md`
- [ ] Chạy xanh backend + web test

### Phase 1 — Lấp gap frontend (ưu tiên cao nhất)
Mỗi màn = 1 task Claude nhỏ, kèm đối chiếu ảnh `reference-ui`. Thứ tự đề xuất:
1. `/inventory/balances` + `/inventory/variants` (tồn nhanh, quản lý biến thể)
2. `/inventory/receipts`, `/inventory/issues`, `/inventory/transfers` (nhập/xuất/chuyển kho)
3. `/inventory/counts`, `/inventory/adjustments`, `/inventory/ledger`, `/inventory/reports`
4. `/customers/:id` (chi tiết khách + công nợ)
5. `/images` (thư viện ảnh nhóm theo ngày)
6. `/production/*` sub-screen (workshops, settlements, cutting, pattern-notes, supplemental)
7. `/materials/*` sub-screen (zippers, embroidery, printing, fabric)
8. `/profile`, `/admin/overview`

### Phase 2 — Chuẩn hóa kiến trúc frontend (tùy chọn, nếu muốn đúng spec)
- Chuyển sang React Router (thay state-nav)
- React Hook Form + Zod cho form
- Generated OpenAPI client (thay `api()` thủ công trong `apps/web/src/api/client.ts`)

### Phase 3 — Hạ tầng production
- Redis (cache/khóa ngắn hạn)
- Celery worker + beat (không chạy việc nặng trong request)
- S3 private (đã có skeleton `services/storage.py`; hoàn thiện presigned URL)
- ETL/reconciliation từ Sheets (spec Phần 6.2, 6.4)

### Phase 4 — Test nâng cao
- Playwright E2E theo 12 scenario bắt buộc (spec mục 8.2)
- Visual regression 34 màn/modal trọng yếu

---

## 3. Cách làm việc với Claude (workflow lặp)

### 3.1 Nguyên tắc chia task
- **1 task = 1 màn hình / 1 vertical slice / 1 bug** — không ôm cả cục.
- Mỗi prompt luôn kèm: màn cần làm → đường dẫn spec mục tương ứng → đường dẫn legacy source + ảnh reference → tiêu chí nghiệm thu.

### 3.2 Prompt mẫu cho từng màn
```
Làm màn "/inventory/balances" theo spec mục 5.2 (route InventoryBalanceTable).
Hành vi phải giữ nguyên như legacy Index.html + ảnh reference-ui.
API tương ứng: GET /api/v1/inventory/balances (xem routers/inventory.py + services/inventory.py).
Đừng đổi nhãn tiếng Việt, đừng dùng tên khách làm key, tiền là VND nguyên.
Viết test và đảm bảo `npm run build` + `npm test` vẫn xanh.
```

### 3.3 Vòng lặp review
1. Claude đọc spec mục liên quan → legacy source → ảnh reference.
2. Claude implement + viết test.
3. Bạn chạy `npm run build` / `pytest` + mở browser đối chiếu ảnh reference.
4. Sai → bảo Claude sửa đúng chỗ (kèm ảnh/đoạn legacy).

---

## 4. Quy tắc cứng (nhét vào CLAUDE.md — từ spec 9.3)

- Không đổi nhãn, màu, vị trí nút, route/flow vì "best practice" khi chưa duyệt.
- Không gộp đơn giữa các kho; không dùng tên khách/nhà may/nhân viên làm key (luôn UUID/ID).
- Không trừ tồn khi chỉ **lưu soạn** (chỉ tăng `reserved`); chỉ trừ thật khi **chốt hóa đơn**.
- Không sửa bảng kê gốc khi thêm hàng vét (tạo bảng kê bổ sung riêng).
- Không cập nhật debt balance thiếu ledger entry; **không dùng float cho tiền** (VND `BIGINT`).
- Không parse ngày `dd/MM/yyyy` bằng `new Date(text)` heuristic; API truyền ISO-8601.
- Không lưu base64 ảnh trong PostgreSQL hay presigned URL (chỉ `bucket/object_key/version_id`).
- Không tin role/actor/tổng tiền client gửi lên; server luôn tính lại + enforce quyền.
- Không tạo một endpoint "action/type" khổng lồ thay REST domain APIs.
- Không xóa vật lý chứng từ đã phát sinh (dùng trạng thái hủy + bút toán đảo + audit log).
- Nghiệp vụ đổi tồn/công nợ/thanh toán/chốt phải nằm trong 1 transaction + idempotency key.

---

## 5. Nội dung `CLAUDE.md` (copy nguyên vào gốc project)

````markdown
# CLAUDE.md — AZALAS SPORT rebuild

## Dự án
Migrate Google Apps Script + Google Sheets → React + FastAPI + PostgreSQL + S3.
Giữ nguyên 100% giao diện/hành vi/luồng thao tác người dùng đang thấy.

## Stack
- Frontend: `apps/web` — React 18 + TypeScript + Vite + TanStack Query + bootstrap-icons.
- Backend: `apps/api` — FastAPI + SQLAlchemy 2 + Alembic + psycopg3 + bcrypt + pyjwt + boto3.
- DB: PostgreSQL 16 (Docker, port 5433). Tiền = VND nguyên (`BIGINT`), không float.
- Múi giờ nghiệp vụ: `Asia/Ho_Chi_Minh`. Ngày hiển thị `dd/MM/yyyy`.

## Tài liệu bắt buộc đọc khi làm việc
1. `docs/AZALAS_TECHNICAL_CONTEXT_SPECIFICATION.md` — hợp đồng hành vi + kiến trúc (đọc mục liên quan trước khi code).
2. `legacy/Code.gs`, `legacy/Index.html`, `legacy/*.gs` — nguồn chân lý cho hành vi UI cũ.
3. `reference-ui/*.png` — visual baseline; đối chiếu trước khi xong 1 màn.

## Cấu trúc backend
- `app/models.py` — toàn bộ SQLAlchemy models.
- `app/routers/*.py` — route thuần, KHÔNG chứa nghiệp vụ.
- `app/services/*.py` — điều phối transaction, nghiệp vụ.
- `app/core/` — config, db, deps, errors, rbac, security, text.
- `migrations/versions/` — Alembic (đã có `0001`–`0007`).

## Cấu trúc frontend
- `apps/web/src/App.tsx` — shell + state-nav (hiện chưa dùng React Router).
- `apps/web/src/components/*.tsx` — các page component.
- `apps/web/src/api/client.ts` — client gọi API + types.

## Quy tắc cứng (đừng vi phạm)
- Không đổi nhãn/màu/vị trí nút/flow khi chưa duyệt.
- Không gộp đơn giữa các kho; không dùng tên làm key (luôn UUID/ID).
- Không trừ tồn khi chỉ lưu soạn; chỉ trừ thật khi chốt hóa đơn.
- Không sửa bảng kê gốc khi thêm hàng vét.
- Không cập nhật debt balance thiếu ledger entry; tiền VND `BIGINT`.
- Không parse ngày VN bằng `new Date(text)` heuristic.
- Không lưu base64 ảnh/presigned URL vào DB.
- Không tin role/actor/tổng tiền client gửi lên.
- Không xóa vật lý chứng từ đã phát sinh.
- Nghiệp vụ tồn/công nợ/thanh toán/chốt: 1 transaction + idempotency key.

## Lệnh chạy
```powershell
docker compose up -d db
cd apps/api; python -m alembic upgrade head; python -m app.seed --mode demo; python -m uvicorn app.main:app --reload --port 8000
cd apps/web; npm run dev
# test: apps/api -> python -m pytest -q -p no:cacheprovider ; apps/web -> npm run build; npm test
```

## Trước khi kết thúc mỗi task
- Chạy test backend + `npm run build` + `npm test` web, so với baseline.
- Đối chiếu ảnh `reference-ui`.
- Không thêm dependency khi chưa cần.
````

---

## 6. 8 câu hỏi nghiệp vụ cần trả lời trước khi code module liên quan (spec 9.4)

1. Giá trong Sheets là VND hay "nghìn đồng" ở từng module?
2. Danh sách trạng thái vận chuyển đầy đủ và transition hợp lệ?
3. Chính sách sửa đơn/hóa đơn đã chốt (bao lâu, ai duyệt)?
4. RPO/RTO, thời gian lưu file/audit, yêu cầu hóa đơn pháp lý?
5. Khách trùng tên nhưng khác SĐT xử lý merge thế nào?
6. Công thức thợ cắt/nhà may khi số lớp sửa hoặc giao vượt kế hoạch?
7. Vật tư giao cho mâm có cần trừ tồn trong phase đầu hay chỉ theo dõi giao nhận?
8. Ma trận role chi tiết theo `view/create/update/delete/approve/close`?

---

## 7. Definition of Done (spec 8.3)

- UI đạt visual baseline (đối chiếu ảnh reference).
- OpenAPI + migration Alembic đã review.
- Unit/integration/E2E pass; coverage domain core ≥ 85%.
- Không có secret trong code/log.
- Audit + idempotency có test.
- Reconciliation về 0 hoặc có sign-off.
