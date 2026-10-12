# AZALAS SPORT — MVP rebuild

MVP thay thế runtime Google Apps Script/Sheets bằng React + FastAPI + PostgreSQL. Sales lifecycle chạy end-to-end; QL Rập, mua phụ liệu, nhân sự/lương, báo cáo/audit và RBAC cũng đã được nối vào cùng stock/debt/payment ledger.

## Yêu cầu Windows

- Node.js 20+ (đã kiểm tra với Node 24)
- Python 3.12+
- Docker Desktop đang chạy (PostgreSQL 16)

## Chạy local

Mở ba PowerShell tại thư mục gốc dự án:

```powershell
Copy-Item .env.example .env
docker compose up -d db
Set-Location apps/api
python -m pip install -r requirements.txt
python -m alembic upgrade head
python -m app.seed --mode demo
python -m uvicorn app.main:app --reload --port 8000
```

```powershell
Set-Location apps/web
npm ci
npm run dev
```

Mở http://127.0.0.1:5173. API docs ở http://127.0.0.1:8000/docs; kiểm tra readiness ở http://127.0.0.1:8000/health/ready.

## Tài khoản demo

| Vai trò | Tên đăng nhập | Mật khẩu |
| --- | --- | --- |
| Owner | `owner` | `owner123` |
| Kho | `thupham` | `demo123` |
| Kho | `thunho` | `demo123` |
| Kho | `hoang` | `demo123` |

Chỉ dùng các mật khẩu này cho dữ liệu demo local. Hãy đặt `JWT_SECRET` riêng (ít nhất 32 byte) trước mọi môi trường không phải development.

## Import khách hàng production

Export file Google Sheets `02_DATA_SALES_CRM` thành `.xlsx`, sau đó chạy thử trước:

```powershell
Set-Location apps/api
python -m app.import_customers --mode production --file "C:\duong-dan\02_DATA_SALES_CRM.xlsx" --dry-run
python -m app.import_customers --mode production --file "C:\duong-dan\02_DATA_SALES_CRM.xlsx"
```

Importer chỉ đọc tab `tbl_KhachHang`, dùng `MaKH` làm khóa và bỏ qua toàn bộ khách đã tồn tại. `phone` chỉ nhận giá trị từ ô `SDT` không rỗng; chương trình không tự sinh số và không cập nhật khách cũ. Chế độ production của seed (`python -m app.seed --mode production`) không ghi bất kỳ dữ liệu demo nào.

## Import danh mục và tồn kho production

Export `03_DATA_KHO_THANH_PHAM` thành `.xlsx`. Importer yêu cầu đủ bốn tab `tbl_Kho_HangHoa`, `tbl_MauSac`, `tbl_Kho_BienThe`, `tbl_Kho_Ton`. Luôn chạy dry-run trước:

```powershell
Set-Location apps/api
python -m app.import_inventory --mode production --file "C:\duong-dan\03_DATA_KHO_THANH_PHAM.xlsx" --dry-run
python -m app.import_inventory --mode production --file "C:\duong-dan\03_DATA_KHO_THANH_PHAM.xlsx"
```

Importer chỉ thêm dữ liệu chưa tồn tại, không tự sinh mã, không sửa ngầm bản ghi cũ và không suy đoán kho. Nếu có bất kỳ dòng lỗi nào, toàn bộ lần import được rollback.

## Kiểm thử

```powershell
Set-Location apps/api; python -m pytest -q -p no:cacheprovider
Set-Location ../web; npm run build; npm test
```

## Luồng demo sales lifecycle

1. Đăng nhập `owner / owner123`, vào **Tạo đơn**, chọn khách và kho rồi lưu.
2. Vào **Chi tiết đơn → Đơn mới**, mở khách, bấm **Nhận đơn & soạn**.
3. Chọn sản phẩm/biến thể, nhập số lượng và giá, sau đó lưu. Bước này chỉ tăng `reserved`, chưa giảm `on_hand`.
4. Vào **Vận chuyển → Chờ**, bấm **Bắt đầu giao**. Có thể chuyển tiếp sang **Hoàn tất** hoặc **Trả hàng**.
5. Vào **Hóa đơn**, chọn khách và tick một hoặc nhiều đơn cùng khách; nhập **Cộng thêm** nếu có rồi bấm **Xem trước hóa đơn**.
6. Thêm một hoặc nhiều dòng thanh toán, chọn phiếu hàng trả khả dụng nếu có, rồi bấm **Chốt & gửi đơn**. Chỉ bước này mới giảm đồng thời `on_hand` và `reserved` và ghi immutable stock ledger.
7. Kiểm tra bản in ở danh sách hóa đơn, tồn kho qua API `/api/v1/inventory/balances`, và công nợ tại **Khách hàng / công nợ**.
8. Vào **Hàng trả → Thêm Hàng Trả**, tạo phiếu; tại **Chưa Duyệt** bấm duyệt để nhập lại tồn và/hoặc ghi credit công nợ. Duyệt lại cùng request không post lần hai.

Hủy hóa đơn/phiếu đã post tạo các dòng reversal; hệ thống không xóa stock ledger hoặc debt ledger. `order.status` và `billing_status` luôn được cập nhật độc lập.

## Luồng demo QL Rập → nhà may

1. Đăng nhập Owner, vào **QL Rập → Tạo mâm**. Chọn nhà may, thợ cắt, kho và nhập biểu thức như `20x5=100`; mâm khách đặt sẽ tạo một sales order `source_channel=RAP` liên kết bằng UUID.
2. Mở **Tiến độ / nhập hàng**, chọn mâm rồi **Giao phụ liệu**. Tick/chỉnh dòng không đóng form; modal chỉ đóng sau khi server lưu thành công.
3. Chọn **Nhập thành phẩm**. Nếu kế hoạch size có SKU, bật nhập tồn để ghi receipt và inventory ledger dương.
4. Vào **Nhà may**, tick các mâm hợp lệ rồi **Chốt bảng kê**. Tổng tiền được tính lại phía server.
5. Trong danh sách mâm đã chốt, bấm đúng nút **Thêm dòng** để nhập hàng vét. Bảng kê gốc không bị sửa; hàng vét chờ một bảng kê bổ sung riêng.
6. Vào **Thợ cắt** để ghi báo cáo công cắt. Thanh toán nhà may/thợ cắt dùng chung payment allocation và debt ledger.

## Luồng demo mua hàng, nhân sự và quyền

1. **Phụ liệu / mua hàng** có các màn Dây kéo, Thêu, Nhật In, Tùng In và Vải nhưng dùng chung `partners/materials`. Tạo đối tác, nhập vật tư hoặc ghi chi phí, chốt kỳ, thanh toán/ứng trước và kiểm sổ nợ bên phải.
2. File PDF/ảnh của đối tác được upload private rồi liên kết bằng `media_id`; database không lưu signed URL.
3. **Nhân sự**: tạo nhân viên → chấm công → ứng lương → tính bảng lương. Owner duyệt sẽ khóa snapshot và không cho sửa nguồn của tháng đó.
4. **Báo cáo / Audit** hiển thị doanh thu, dòng tiền, khách hàng, cảnh báo đối soát và audit log theo quyền.
5. **Tài khoản / phân quyền** cho phép Owner tạo user, gán role và chỉnh ma trận permission. API vẫn kiểm quyền server-side; ẩn menu không phải lớp bảo vệ duy nhất.
6. Mỗi người dùng có thể bấm **Đổi MK** ở cuối sidebar. Login trả access + refresh token; refresh được xoay vòng và logout/đổi mật khẩu sẽ thu hồi phiên.

## Lưu file

Mặc định local lưu ảnh ở `apps/api/uploads`. Để dùng S3 private, đặt `S3_BUCKET` (và tùy chọn `S3_REGION`) trong `.env`; database chỉ ghi `bucket`, `object_key`, `version_id` và metadata. API phát sinh presigned URL 5 phút khi đọc, không lưu URL ký trong database.

## Database hiện có

Không reset database khi nâng cấp. Từ thư mục `apps/api`, chỉ chạy:

```powershell
python -m alembic current
python -m alembic upgrade head
```

Các revision `0004`–`0007` lần lượt bổ sung QL Rập, mua hàng, HR/payroll và RBAC/refresh session.
