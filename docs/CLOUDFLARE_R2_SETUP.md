# Thiết lập Cloudflare R2 cho AZALAS

Tài liệu này cấu hình R2 làm nơi lưu ảnh và PDF trên production. Môi trường dev vẫn dùng thư mục local khi `STORAGE_DRIVER=local`. Media cũ được giữ nguyên; migration chỉ bổ sung metadata, không xóa file hay reset database.

## 1. Tạo bucket R2

1. Đăng nhập Cloudflare Dashboard và chọn **R2 Object Storage**.
2. Tạo bucket riêng cho AZALAS, ví dụ `azalas-media-prod`.
3. Để bucket ở chế độ **private**. Không bật public development URL nếu file có thể chứa dữ liệu khách hàng.
4. Không tạo cấu hình lifecycle tự xóa object đang dùng. Nếu bật xóa theo tuổi, thời hạn phải lớn hơn chính sách lưu hồ sơ của doanh nghiệp.

## 2. Tạo API token và access key

1. Trong R2, mở **Manage R2 API Tokens** (hoặc trang API Tokens của Cloudflare).
2. Tạo token có quyền **Object Read & Write**, giới hạn vào bucket AZALAS vừa tạo nếu Dashboard cho phép.
3. Lưu lại `Access Key ID` và `Secret Access Key` ngay khi hiển thị. Secret không thể xem lại; không gửi hai giá trị này qua chat, email công khai hoặc commit Git.
4. Lấy **Account ID** từ Cloudflare Dashboard. Endpoint chuẩn là:

   ```text
   https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

R2 dùng endpoint S3-compatible và region `auto`; backend tự cấu hình region này khi tạo boto3 client.

## 3. Cấu hình `.env.production`

Tạo file `.env.production` trong môi trường production (hoặc khai báo các biến tương đương trong secret manager của nhà cung cấp). API hiện tự đọc `.env` và `../../.env`, không tự động đọc tên `.env.production`; nếu dùng file này, cấu hình process manager/container nạp file vào environment khi khởi động. Không commit file chứa secrets.

```dotenv
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=azalas-media-prod
R2_ENDPOINT_URL=https://your-cloudflare-account-id.r2.cloudflarestorage.com

# Để trống khi dùng bucket private; khi đó API cấp signed URL ngắn hạn.
R2_PUBLIC_BASE_URL=
R2_SIGNED_URL_EXPIRE_SECONDS=300

MAX_UPLOAD_MB=10
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/webp
```

Đồng thời đặt `DATABASE_URL` trỏ đến PostgreSQL production, `JWT_SECRET` ngẫu nhiên riêng tối thiểu 32 byte và cấu hình domain HTTPS của ứng dụng. Không dùng mật khẩu demo hay `JWT_SECRET` trong `.env.example`.

`R2_PUBLIC_BASE_URL` chỉ dùng nếu doanh nghiệp chủ động đưa object ra public qua custom domain/CDN. Khi đặt biến này, nội dung có thể được đọc trực tiếp ngoài ứng dụng sau khi biết URL; không dùng cho tài liệu cần phân quyền. Với bucket private, để trống.

### CORS cho bucket private

Trình duyệt tải ảnh qua API đã đăng nhập; API chuyển hướng đến URL ký của R2. Cấu hình CORS của bucket cho phép origin chính xác của ứng dụng, chỉ các method cần thiết:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

Thay `https://app.example.com` bằng domain production thực. Không dùng wildcard origin cho ứng dụng nội bộ.

## 4. Nâng cấp và test upload

Deploy code rồi chạy migration **trên database hiện có**, không tạo database mới và không reset dữ liệu:

```powershell
Set-Location apps/api
python -m alembic upgrade head
```

Migration mới bổ sung `storage_provider` và `checksum`, đồng thời backfill từ thông tin hiện có. Media local cũ tiếp tục được đọc từ `UPLOAD_DIR`; media upload mới dùng R2 khi `STORAGE_DRIVER=r2`.

1. Đăng nhập ứng dụng bằng tài khoản production có quyền phù hợp.
2. Tạo thử một đơn có ảnh, paste một ảnh từ clipboard, chụp ảnh hóa đơn và thử mở ảnh trong Kho ảnh.
3. Thử tải một PDF đối chiếu Nhật-In hoặc Tùng-In nếu module này được sử dụng.
4. Kiểm tra danh sách object trong bucket có key dạng `private-media/<module>/<năm>/<tháng>/<media-id>.<ext>`.
5. Mở ảnh/PDF từ giao diện và xác nhận nội dung hiển thị; URL ký không được ghi vào database hoặc log ứng dụng.
6. Kiểm tra `/health/ready` để xác nhận API còn kết nối được PostgreSQL.

Không upload secrets hoặc file khách hàng thật trong bước test; dùng dữ liệu thử được phê duyệt.

## 5. Sao lưu và vận hành

- Sao lưu PostgreSQL thường xuyên và kiểm tra định kỳ khả năng restore.
- Database chỉ lưu metadata và object key; backup database **không** chứa file R2. Cần có kế hoạch backup/copy bucket độc lập sang bucket hoặc tài khoản khác, và kiểm thử phục hồi cả database lẫn object.
- Các bản ghi cũ có `storage=S3` được giữ ở provider `s3` và chỉ đọc bằng cấu hình AWS SDK hiện có (`S3_REGION` cùng credentials qua environment/IAM); upload mới vẫn chỉ dùng local hoặc R2. Có thể chuyển các object cũ sang R2 theo kế hoạch riêng sau khi xác minh backup.
- Bật versioning/retention nếu phù hợp với chính sách dữ liệu; thiết lập lifecycle cẩn thận để tránh xóa object còn được database tham chiếu.
- Giới hạn API token theo bucket và quyền tối thiểu; xoay vòng credentials định kỳ, lưu trong secret manager, thu hồi ngay khi nghi ngờ bị lộ.
- Không mở quyền ghi công khai cho bucket. Endpoint xem media yêu cầu đăng nhập và quyền module tương ứng; URL ký private chỉ tồn tại trong thời gian cấu hình.
- Production phải dùng HTTPS. Không expose filesystem path, thư mục uploads hoặc cổng PostgreSQL ra Internet.
