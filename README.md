# Stopirex Chatbot

Backend B2C đa tenant triển khai theo tasklist MVP → production. Phần đã có trong repo:

- Meta webhook verification và signature guard.
- Worker Meta đọc Redis thật, gom tin liên tiếp, giữ state PostgreSQL và gửi trả Messenger.
- Domain guard cho claim, giá theo kênh/version và Pipeline.
- Hành trình chung Sale + CSKH: lưu Pipeline trước sự cố, bước hiện tại và điểm gãy cần xử lý.
- State-machine tư vấn theo bối cảnh công việc, vấn đề, sản phẩm từng dùng và an toàn.
- CSKH theo nhánh kích ứng, không hiệu quả, hàng hỏng/thiếu, giao hàng, nghi hàng giả và đánh giá tiêu cực.
- Follow-up 3–6–9 giờ có idempotency/cancel.
- Xác nhận đơn bắt buộc trước khi tạo Pancake/Sapo.
- Gán variant ổn định cho 5 kịch bản mở đầu.
- PostgreSQL schema multi-tenant có RLS, audit và outbox.
- API/worker tách lớp, Redis lease/queue và follow-up persistent.
- Import XLSX đa-sheet có checksum, conflict gate và version publish/rollback.
- Meta text/image/typing adapter, retry/circuit breaker và outbound policy.
- Pancake/Sapo/OmiCall contracts, order saga và CSKH pause/resume.
- RBAC, PII/secret redaction, retention planner, CI/security scan và runbook.
- 36 replay nghiệm thu, integration PostgreSQL/Redis và load smoke.

## Chạy local

```bash
npm install
cp .env.example .env
npm run check
npm run dev
```

Kiểm tra:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

Mở `http://127.0.0.1:8080/` để chat thử. Giao diện có Pipeline, trạng thái tư vấn
và thu thập đơn sandbox. Codex CLI là bộ não chính: đọc ngữ cảnh, bóc tách ý định,
lấy kiến thức được duyệt và tạo bản nháp; state machine chỉ giữ trạng thái và áp
dụng guardrail bắt buộc.

Chi tiết logic Pipeline và các nhánh xử lý: [docs/CUSTOMER_JOURNEY.md](docs/CUSTOMER_JOURNEY.md).

Thiết lập Facebook Messenger từng bước: [docs/META_MESSENGER_SETUP.md](docs/META_MESSENGER_SETUP.md).

Cách dùng cùng một commit cho môi trường test và product, tách toàn bộ secret qua
runtime env: [docs/DEPLOYMENT_CONFIG.md](docs/DEPLOYMENT_CONFIG.md).

LLM mặc định chạy ở chế độ `hybrid`: ưu tiên OpenAI Responses API trực tiếp;
nếu API hết credit, rate-limit, timeout hoặc lỗi nhà cung cấp thì tự chuyển sang
Codex CLI local. Sau lỗi quota/xác thực, circuit breaker tạm bỏ qua OpenAI trong
5 phút để khách không phải chờ lỗi API lặp lại ở mỗi tin.

```bash
LLM_PROVIDER=hybrid
LLM_ENABLED=true
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-5.4-nano
OPENAI_TIMEOUT_MS=30000
OPENAI_MAX_OUTPUT_TOKENS=1200
LLM_USD_TO_VND_RATE=26000
LLM_HYBRID_PROVIDER_TIMEOUT_MS=30000
LLM_HYBRID_COOLDOWN_MS=300000
```

Đặt các biến trên trong `.env`, không đưa API key vào source, `.env.example` hoặc
Git. OpenAI API dùng `store: false`, timeout 30 giây và giới hạn tối đa 1.200
output token mỗi lượt. Khi LLM lỗi hoặc timeout, rule xác định vẫn là phương án
dự phòng; dashboard hiển thị riêng lỗi xác thực, timeout và rate limit.

Trang `http://127.0.0.1:8080/operations` thống kê số lượt gọi, input token,
cached input, output/reasoning token, độ trễ và chi phí ước tính theo 24 giờ,
7 ngày hoặc 30 ngày. Dữ liệu từng lượt được lưu trong PostgreSQL để có thể đối
soát theo provider/model. Chi phí OpenAI được chốt theo đơn giá lưu cùng sự kiện;
quy đổi VND dùng `LLM_USD_TO_VND_RATE`. Đây là ước tính từ usage ứng dụng nhận
được, không thay thế hóa đơn của nhà cung cấp; lượt CLI hoặc lượt lỗi không trả
usage vẫn được đếm nhưng không được cộng chi phí.

Để ép dùng một provider khi chẩn đoán, đặt `LLM_PROVIDER=openai` hoặc
`LLM_PROVIDER=codex`; đặt `hybrid` để bật failover. Codex CLI cần các biến `CODEX_CLI_PATH`,
`CODEX_LLM_MODEL` và `CODEX_LLM_TIMEOUT_MS` như trong `.env.example`.

LLM được đọc các lượt Sale và CSKH để hiểu ngữ cảnh. SĐT/địa chỉ không được gửi
sang LLM; giá, chính sách, an toàn và thao tác đơn vẫn phải qua guardrail và flow
xác định trước.

PostgreSQL và Redis local:

```bash
docker compose up -d
DATABASE_URL=postgresql://stopirex:stopirex@localhost:15432/stopirex npm run migrate
DATABASE_URL=postgresql://stopirex:stopirex@localhost:15432/stopirex npm run seed
```

Integration và load smoke:

```bash
INTEGRATION=1 DATABASE_URL=postgresql://stopirex:stopirex@localhost:15432/stopirex REDIS_URL=redis://localhost:6379 npm test
LOAD_URL=http://127.0.0.1:8080/ready npm run load:smoke
```

## Nguyên tắc an toàn

- Không hardcode giá production, thời gian dùng hoặc thông tin đăng nhập trong prompt/source.
- Giá hardcode trong local demo phải luôn có nhãn `SANDBOX` và không được dùng để tạo đơn thật.
- Không dùng các claim tuyệt đối như “khô thoáng tuyệt đối”, “dứt điểm”, “an toàn 100%”.
- Một lọ và combo khác nhau về thời gian sử dụng/giá trị kinh tế, không phải mức độ hiệu quả.
- Dữ liệu chưa được duyệt phải fail closed hoặc chuyển người thật.
- Mọi key/cache/query/tool phải mang tenant và Page scope.

## Blocker bên ngoài

Meta, Pancake, Sapo và OmiCall adapters cần credential sandbox, tài liệu API và chính sách được phê duyệt. Các interface/domain guard được triển khai trước; không ghi credential vào repository.

Giá trong seed luôn để `draft`; chỉ chuyển `active` sau khi GOV-006 được duyệt. Không đưa password OmiCall hoặc token nhà cung cấp vào source, Excel hay prompt.
