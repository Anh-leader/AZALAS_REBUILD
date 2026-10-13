# Triển khai production

Frontend production được build thành static assets bằng Vite trong Docker multi-stage build và phục vụ bởi Nginx. Nginx trả `index.html` cho SPA routes và proxy `/api/*` tới backend; không cần `server.cjs`, `npm run dev` hoặc `vite preview`.

## Yêu cầu

- Docker Engine và Docker Compose plugin.
- Backend FastAPI đã được deploy và có thể truy cập từ container frontend.
- Không dùng endpoint API nội bộ `127.0.0.1` trong `API_UPSTREAM`; đó sẽ là loopback của chính container Nginx.

## Chạy frontend production

Trong PowerShell, từ thư mục gốc repository, đặt API upstream bằng URL mà container frontend có thể truy cập. Ví dụ backend đã được deploy tại một API domain:

```powershell
$env:API_UPSTREAM = "https://api.example.com"
$env:FRONTEND_PORT = "8080"
docker compose -f docker-compose.production.yml up -d --build
```

Thay `https://api.example.com` bằng URL backend thật. Không thêm dấu `/api` ở cuối; Nginx giữ nguyên path `/api/...` khi proxy. Nếu dùng hostname nội bộ như `http://api:8000`, backend container phải nằm trên cùng Docker network với frontend.

Mở `http://localhost:8080` (hoặc domain đã được reverse proxy bên ngoài trỏ về port frontend). Có thể xác nhận container và log:

```powershell
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f frontend
```

Dừng frontend:

```powershell
docker compose -f docker-compose.production.yml down
```

## TLS / reverse proxy bên ngoài

Trong production, nên kết thúc TLS tại load balancer hoặc reverse proxy hiện có và chuyển tiếp traffic tới port frontend. Nếu đã có reverse proxy production, có thể phục vụ container Nginx này như upstream:

- `/api/*` được proxy từ Nginx frontend tới `API_UPSTREAM`.
- Các đường dẫn còn lại được phục vụ từ static assets; đường dẫn không khớp file trả `index.html` cho React.

Chỉ expose frontend qua Internet. Backend cần được giới hạn mạng/firewall phù hợp; không expose PostgreSQL công khai. Cấu hình `API_UPSTREAM` phải trỏ tới backend thật và được giữ ổn định khi build image (đây là cấu hình runtime, không nhúng vào bundle).

## Triển khai riêng bằng Docker

```powershell
docker build -t azalas-frontend:production .\apps\web
docker run -d --name azalas-frontend --restart unless-stopped `
  -p 8080:80 `
  -e API_UPSTREAM="https://api.example.com" `
  azalas-frontend:production
```

Thay domain API mẫu bằng địa chỉ backend thật. Khi dùng `docker run` và hostname backend là `api`, đảm bảo container frontend tham gia cùng network với backend.
