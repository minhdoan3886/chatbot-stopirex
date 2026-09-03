# Bảng cấu trúc dự án phục vụ review

## 1. Tổng quan

| Hạng mục            | Hiện trạng                                                                   |
| ------------------- | ---------------------------------------------------------------------------- |
| Loại dự án          | Backend chatbot B2C đa tenant                                                |
| Ngôn ngữ / runtime  | TypeScript strict, ESM, Node.js 20+                                          |
| Kiến trúc chính     | Domain-centric, API và worker chạy độc lập                                   |
| Dữ liệu             | PostgreSQL 16, Redis 7                                                       |
| Kênh tích hợp chính | Meta Messenger; có contract cho Pancake, Sapo và OmiCall                     |
| LLM                 | OpenAI Responses API và Codex CLI, hỗ trợ hybrid/failover                    |
| Kiểm thử            | 21 file test, gồm unit, acceptance, integration và smoke test                |
| Triển khai          | Docker multi-stage, Docker Compose local/staging, GitHub Actions CI/security |

## 2. Cấu trúc thư mục

| Khu vực                     | Vai trò                                        | Thành phần tiêu biểu                                               | Phụ thuộc chính                    | Mức ưu tiên review      | Nhận xét                                                                                |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `apps/api/`                 | Entrypoint API theo layout ứng dụng            | `index.ts`                                                         | `src/http/server.ts`               | Trung bình              | Hiện chỉ import entrypoint trong `src/`; chưa phải ứng dụng độc lập.                    |
| `apps/worker/`              | Entrypoint worker theo layout ứng dụng         | `index.ts`                                                         | `src/worker.ts`                    | Trung bình              | Tương tự `apps/api/`; Docker hiện chạy trực tiếp từ `dist/src`.                         |
| `packages/config/`          | Public export cho cấu hình dùng chung          | `index.ts`                                                         | `src/config/env.ts`                | Thấp                    | Là lớp re-export, chưa có package manifest riêng.                                       |
| `packages/domain/`          | Public export cho domain dùng chung            | `index.ts`                                                         | Một phần `src/domain/`             | Trung bình              | Chỉ export một số module; cần xác nhận đây là API công khai có chủ đích.                |
| `src/config/`               | Đọc và kiểm tra cấu hình runtime, dữ liệu demo | `env.ts`, `demoCommerce.ts`                                        | Biến môi trường                    | Cao                     | Cần review fail-fast, secret, giá trị mặc định production và cấu hình tenant.           |
| `src/domain/`               | Luật nghiệp vụ thuần và state machine          | consultation, pipeline, orders, claims, follow-up, quality, safety | Ít hoặc không phụ thuộc hạ tầng    | Rất cao                 | Là lõi nghiệp vụ; nên review invariant, trạng thái, claim và guardrail trước.           |
| `src/services/`             | Điều phối use case và tích hợp nghiệp vụ       | `demoChat.ts`, `codexLlm.ts`, Meta processor, repositories         | Domain, infrastructure, adapters   | Rất cao                 | `demoChat.ts` (~3.399 dòng) và `codexLlm.ts` (~1.504 dòng) là điểm nóng về độ phức tạp. |
| `src/adapters/`             | Chuyển đổi giao thức Meta                      | event parser, webhook guard, Messenger client                      | Meta Graph API, domain/services    | Cao                     | Review chữ ký webhook, retry, timeout, idempotency và mapping dữ liệu ngoài vào domain. |
| `src/infrastructure/`       | Kết nối tài nguyên kỹ thuật                    | PostgreSQL store, Redis runtime                                    | `pg`, `redis`                      | Rất cao                 | Review transaction, RLS/tenant scope, lease, queue, retry và đóng kết nối.              |
| `src/integrations/`         | Hợp đồng với hệ thống ngoài                    | `contracts.ts`                                                     | Kiểu domain                        | Cao                     | Cần đối chiếu contract thật khi có sandbox/credential của nhà cung cấp.                 |
| `src/http/`                 | HTTP server, route và trang vận hành/demo      | `server.ts`, Meta gateway, operations/product page                 | Services, adapters, infrastructure | Rất cao                 | `server.ts` (~716 dòng) đang gộp routing, composition root và luồng demo chat.          |
| `src/worker.ts`             | Consumer Redis và xử lý tin Meta bất đồng bộ   | queue group, batching, lease, retry, heartbeat                     | Redis, PostgreSQL, Meta services   | Rất cao                 | Review xử lý pending message, poison message, retry trùng lặp và shutdown.              |
| `migrations/`               | Schema và dữ liệu khởi tạo PostgreSQL          | 5 migration, 1 seed sandbox                                        | PostgreSQL                         | Rất cao                 | Review thứ tự migration, RLS, constraint, index, outbox, rollback và dữ liệu nhạy cảm.  |
| `scripts/`                  | Tác vụ vận hành thủ công                       | migrate, seed, Meta setup, load smoke                              | DB, Meta API, runtime config       | Cao                     | Review tính idempotent và chặn chạy nhầm môi trường production.                         |
| `test/`                     | Kiểm thử hành vi và hạ tầng                    | 21 file `*.test.ts`                                                | Node test runner, source modules   | Rất cao                 | Phủ nhiều luồng; cần đối chiếu thêm coverage thực tế và test failure path.              |
| `docs/`                     | Tài liệu nghiệp vụ và vận hành                 | customer journey, Meta setup, observability, runbook               | Quy trình đội ngũ                  | Cao                     | Nên kiểm tra độ đồng bộ với code và biến môi trường hiện tại.                           |
| `.github/workflows/`        | CI và kiểm tra bảo mật                         | CI, gitleaks, Trivy, npm audit                                     | GitHub Actions                     | Cao                     | Đã có quality/security gate; chưa thấy bước build/publish image hoặc deploy.            |
| `Dockerfile`                | Build và chạy API production                   | multi-stage Node image                                             | npm, TypeScript build              | Cao                     | Chạy non-root; cần review healthcheck/image pinning và quy trình cập nhật dependency.   |
| `docker-compose*.yml`       | Môi trường local và staging                    | API, worker, PostgreSQL, Redis                                     | Docker Compose                     | Cao                     | Staging dùng `.env`; cần bảo đảm secret không nằm trong file hoặc image.                |
| `dist/`                     | Kết quả biên dịch                              | JavaScript, declaration, source map                                | TypeScript build                   | Không review trực tiếp  | Generated artifact, đã được ignore; review từ source.                                   |
| `outputs/`, `tmp/`, `work/` | Kết quả phân tích và file tạm                  | audit/review artifacts                                             | Công cụ nội bộ                     | Không review như source | `outputs/` và `tmp/` đã ignore; `work/` chưa thấy trong `.gitignore`.                   |

## 3. Luồng phụ thuộc chính

| Luồng                 | Đường đi                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Chat demo HTTP        | `src/http/server.ts` → `DemoChatService` → domain rules → response governor/quality                         |
| Chat có LLM           | HTTP/Meta service → `CodexLlmBridge` → OpenAI hoặc Codex CLI → guardrail → phản hồi                         |
| Meta inbound          | Meta webhook → adapter/parser → Redis stream → `src/worker.ts` → `MetaInboundProcessor` → Messenger adapter |
| Lưu trạng thái        | Services/worker → `PostgresStore` → schema trong `migrations/`                                              |
| Điều phối bất đồng bộ | HTTP gateway/worker → `RedisRuntime` → stream, consumer group, lease và heartbeat                           |
| Vận hành              | `/health`, `/ready`, `/operations` → dependency checks và telemetry PostgreSQL/Redis/LLM                    |

## 4. Thứ tự review đề xuất

| Thứ tự | Phạm vi                                                | Mục tiêu review                                                                             |
| -----: | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
|      1 | `src/domain/`, `docs/CUSTOMER_JOURNEY.md`              | Xác nhận rule nghiệp vụ, state transition, claim và điều kiện chuyển người thật.            |
|      2 | `src/services/demoChat.ts`, `src/services/codexLlm.ts` | Kiểm tra ranh giới giữa LLM và rule xác định; tìm logic trùng lặp và nhánh khó kiểm thử.    |
|      3 | `src/http/server.ts`, `src/worker.ts`                  | Kiểm tra validation, lỗi, timeout, concurrency, retry, shutdown và observability.           |
|      4 | `src/infrastructure/`, `migrations/`                   | Kiểm tra tenant isolation, transaction, RLS, idempotency, index và tính toàn vẹn dữ liệu.   |
|      5 | `src/adapters/`, `src/integrations/`                   | Kiểm tra độ tin cậy và an toàn của biên hệ thống ngoài.                                     |
|      6 | `test/`                                                | Lập ma trận requirement → test; bổ sung failure, race, security và recovery case còn thiếu. |
|      7 | Docker, Compose, CI, scripts, docs                     | Kiểm tra khả năng phát hành, rollback, vận hành và khôi phục sự cố.                         |

## 5. Điểm cần quyết định sau review

| Vấn đề                                                   | Tác động                                                                      | Khuyến nghị                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/` và `packages/` chưa là workspace độc lập         | Cấu trúc dễ tạo cảm giác monorepo nhưng build/deploy vẫn dùng `src/`          | Chọn một trong hai: đơn giản hóa về một app, hoặc khai báo npm workspaces và chuyển ownership code rõ ràng. |
| Các file điều phối lõi quá lớn                           | Tăng chi phí review, dễ tạo coupling và regression                            | Tách theo use case/feature, giữ composition root mỏng, đặt interface ở ranh giới module.                    |
| HTTP server tự routing bằng điều kiện                    | Khó mở rộng middleware, schema validation và error handling thống nhất        | Nếu số route tiếp tục tăng, cân nhắc router/framework nhẹ hoặc tách route handler theo module.              |
| `work/` chưa được ignore                                 | Có nguy cơ commit nhầm artifact nội bộ                                        | Xác định đây là source hay file tạm; nếu là file tạm thì thêm vào `.gitignore`.                             |
| Chưa thấy pipeline deploy                                | Chất lượng được kiểm tra nhưng release còn thủ công/không thể hiện trong repo | Bổ sung build image, SBOM/signing nếu cần, deploy staging và smoke/rollback gate.                           |
| Tích hợp ngoài còn phụ thuộc credential/tài liệu sandbox | Không thể xác nhận end-to-end production chỉ bằng source                      | Dùng sandbox contract test và checklist phê duyệt trước khi bật live send/order.                            |

## 6. Phạm vi không tính là source khi review

- `node_modules/`, `dist/`, `coverage/`: dependency hoặc kết quả build/test.
- `outputs/`, `tmp/`: artifact tạm đã được ignore.
- `.env`: secret cục bộ, không đưa vào review hoặc commit; chỉ review `.env.example`.
