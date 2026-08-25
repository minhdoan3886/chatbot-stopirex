# Cấu hình test và product

Test và product dùng cùng source code, cùng migrations và cùng Docker image. Chỉ
thay các biến môi trường theo môi trường chạy; tuyệt đối không commit `.env` hoặc
token vào Git.

## Test

```bash
cp .env.test.example .env
# điền credential Page test và secret local vào .env
docker compose up -d
npm run migrate
npm run meta:register-page
npm run meta:preflight
```

Giữ `META_ACTIVE_PAGE=test`, `META_LIVE_SEND_ENABLED=false` trong bước nhận sự
kiện. Chỉ bật live send sau khi webhook, chữ ký và Page test đã được kiểm tra.

## Staging cô lập trên máy chủ

Dùng `docker-compose.stage.yml` cho một resource/stack mới, không thay file compose
hoặc resource đang chạy product. Stack này có tên `stopirex-chatbot-stage`, dùng
PostgreSQL và Redis nội bộ riêng, không publish cổng database/cache ra host và lưu
dữ liệu trong hai volume chỉ dành cho staging.

Các chốt an toàn được khóa ngay trong compose:

- `META_ACTIVE_PAGE=test`
- `META_LIVE_SEND_ENABLED=false`
- `MULTI_ACTION_ROLLOUT_MODE=shadow`
- `FOLLOWUP_MODE=shadow`
- không truyền `META_PAGE_ID` hoặc `META_PAGE_ACCESS_TOKEN` của Page primary

Trong Coolify, tạo **resource Docker Compose mới** từ một branch deploy riêng,
chọn file `/docker-compose.stage.yml`, gắn domain staging vào service `api` cổng
`8080` và nhập các biến `STAGE_*` theo `.env.stage.example`. Không copy toàn bộ
Environment Variables từ resource product. Nếu chưa xác minh resource nào đang
auto-deploy branch `staging`, dùng branch mới như `codex/stage-isolated` để lần
push đầu tiên không restart resource hiện hữu.

Stack chỉ publish API lên loopback của host tại
`127.0.0.1:${STAGE_HOST_PORT:-18080}`. Khi cổng 80/443 công khai không khả dụng,
có thể nối riêng staging qua một cổng Tailscale Funnel chưa dùng, ví dụ `10000`,
tới loopback này. Phải kiểm tra `tailscale funnel status` trước và không thay các
Funnel hoặc route đang phục vụ product.

Sau khi deploy, chạy trong container `api` của resource staging:

```bash
npm run meta:register-page:prod
npm run meta:preflight:prod
```

Callback của Meta App test phải là domain staging cộng `/webhooks/meta`. Không đổi
callback của Meta App đang phục vụ Page primary.

## Product

Trên máy product, tạo file env được bảo vệ quyền đọc (hoặc dùng secret manager)
từ mẫu:

```bash
cp .env.production.example .env
chmod 600 .env
```

Các giá trị bắt buộc phải dùng đúng bộ product gồm:

- `META_ACTIVE_PAGE=primary`
- `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`
- `META_PUBLIC_WEBHOOK_URL` dùng domain HTTPS cố định của product
- `DATABASE_URL`, `REDIS_URL`, `ADMIN_API_KEY`, `ENCRYPTION_KEY`

`META_APP_ID`, `META_APP_SECRET` và `META_VERIFY_TOKEN` có thể dùng chung nếu test
và product thuộc cùng Meta App; nếu dùng hai App riêng thì phải đổi theo App
product.

Chạy migration trên đúng database product trước khi khởi động worker:

```bash
docker compose -f docker-compose.staging.yml up -d --build
docker compose -f docker-compose.staging.yml exec api npm run meta:register-page:prod
docker compose -f docker-compose.staging.yml exec api npm run meta:preflight:prod
```

API tự chạy `dist/scripts/migrate.js` trước khi mở HTTP server ở mỗi lần container
khởi động. Migration có bảng `schema_migrations` nên những file đã áp dụng sẽ được
bỏ qua. Runtime image chứa bản JavaScript đã build và thư mục migrations, vì vậy
không cần service migration riêng hoặc dev dependency `tsx` trên máy product.

## Coolify

Khuyến nghị dùng resource kiểu Docker Compose với file
`docker-compose.staging.yml`, branch `staging`, và để Coolify dùng nguyên các
service `api`, `worker`, `followup-worker`, `postgres`, `redis`. Compose này tự
chứa, không dùng `extends` và không đọc `env_file: .env`; hãy nhập biến môi trường
trong phần Environment Variables của Coolify. Không thêm lại service migration
hoặc `service_completed_successfully`.

Nếu dùng resource kiểu Dockerfile đơn lẻ, cấu hình:

- Branch: `staging`
- Dockerfile: `/Dockerfile`
- Internal port: `8080` (không publish host port; để Traefik/Coolify proxy)
- Health path: `/ready`
- Start command: để trống để dùng `CMD` trong Dockerfile

Resource Dockerfile đơn chỉ chạy API. Muốn chạy xử lý Messenger đầy đủ, tạo thêm
resource worker với command `node dist/src/worker.js` và resource follow-up với
command `node dist/src/followupWorker.js`, dùng cùng image/commit và cùng env.

Triển khai lần đầu nên giữ `META_LIVE_SEND_ENABLED=false`,
`MULTI_ACTION_ROLLOUT_MODE=shadow` và `FOLLOWUP_MODE=shadow`. Sau khi kiểm tra
log/health và có phê duyệt mới bật từng tính năng, rồi restart API, worker và
follow-up worker.

## Nguyên tắc phát hành

1. Push một commit đã test; build image/artifact từ đúng commit đó.
2. Nạp secret ở máy đích, không truyền qua GitHub source.
3. Chạy migration một lần trên database đích; script có bảng
   `schema_migrations` để idempotent.
4. Kiểm tra `/health`, `/ready`, `/api/operations/overview` và `/api/orders`.
5. Nếu cần rollback, giữ nguyên database migration và quay lại image/commit trước;
   không sửa thủ công dữ liệu đơn để chữa lỗi triển khai.

Credential đã từng xuất hiện trong chat cần được rotate/revoke trước khi dùng cho
product.
