# Response rebuild Stopirex — local implementation status

Ngày kiểm tra: 2026-09-16 (Asia/Ho_Chi_Minh)
Repository: `Ai chatbot stopirex`
Baseline trước thay đổi: `08617efb66cf9d9258b364a941cd39118d0169d7`

Phạm vi này chỉ được xác minh local. Unit/full-path dùng fake provider; integration dùng PostgreSQL và Redis local; bộ `product-memory` chạy với LLM bị ép tắt nên không tiêu quota. Chưa deploy, chưa gọi OpenAI thật, chưa gửi Meta thật và chưa migrate production.

## Kết quả R00–R14

| Mục                           | Trạng thái | Bằng chứng local                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R00 baseline/reproduction     | done       | Chốt baseline HEAD, kiểm tra callsite product, bổ sung regression cho governor, memory, price scope, parser, outbox unknown và full inbound→brain→outbox fake.                                                                                                               |
| R01 turn snapshot             | done       | `turnContext.ts`: schema/scope/revision/state version, memory/KB usage rights, typed money, receipts, freeze và scope validation; có unit test reject receipt khác scope.                                                                                                    |
| R02 memory write              | done       | Fact Ledger xác minh evidence phải hỗ trợ value, tách subject, giữ rejected reason/correction history; chặn hypothetical/copied bot/review thành self fact.                                                                                                                  |
| R03 memory lifecycle/time     | done       | Tách profile bền vững khỏi transient episode; episode mới xóa pending/asked cũ nhưng giữ care/order chưa xong; fact có `recordedAt`/`eventAt`; legacy relative time thiếu event time bị unknown.                                                                             |
| R04 memory projection         | done       | `memoryProjection.ts` chọn theo subject/current question/history intent; loại superseded/hypothetical/copied/legacy-relative; greeting không nhận history cũ; composer chỉ nhận projection đã giải quyết.                                                                    |
| R05 knowledge applicability   | done       | Adapter giữ status/scope/version/effective time; record thiếu approval không còn tự thành current; workflow prose không chứng minh product claim; resolver kiểm tra polarity và money role.                                                                                  |
| R06 must-say/CTA              | done       | Response contract lấy fact theo câu hỏi hiện tại; hỏi giá chung chỉ bắt buộc 1 lọ + phí chuẩn, không ép combo/quà/CTA; cho phép CTA `none`; question suppression dùng pre-turn state.                                                                                        |
| R07 final owner/composer      | done       | Fact-ledger và inspection được đưa qua shared composer/validator; care/boundary an toàn còn lock có chủ ý; interpret/adopt/repair/post-commit dùng chung snapshot/style policy; outbox chỉ nhận final response object.                                                       |
| R08 typed transaction render  | done local | `transactionRenderer.ts` kiểm tra currency/quantity/phép tính/source version, gắn role unit/subtotal/shipping/discount/total và bắt receipt khi override phí giao. Toàn bộ giá trong sales/order response path lấy từ catalog qua renderer; placeholder và role sai bị chặn. |
| R09 final validator           | done       | `finalResponseValidator.ts` trả issue có category/code/block/evidence/repairability/context-change; chặn memory meta, internal state, claim/price/money/receipt/coverage sai sau render.                                                                                     |
| R10 repair budget             | done local | Một content repair tối đa cho adopt/coverage/canonical/final validation; post-commit không tự retry. Verdict không allow được lưu thành `responseAttention`; dashboard hiển thị severity/mã lỗi để nhân viên xử lý.                                                          |
| R11 no semantic post-mutation | done       | Governor chỉ bỏ câu hỏi lặp trong block, không xóa answer/không đổi `?`; parser không cắt mù 650/1000; transport bubble >2000 báo lỗi; Meta processor không rewrite final content-free.                                                                                      |
| R12 revision/outbox           | done local | Inbound/state revision được kiểm tra trước commit và từng bubble; human ownership chặn dispatch; payload có trace/context/revision; timeout/network ambiguous thành `unknown`, không blind retry. JSONB thay đổi additive, không cần SQL destructive migration.              |
| R13 trace                     | done local | Một trace nối inbound, memory/KB/receipt, workflow/draft/final hash, verdict, logical call/repair count, outbox responseRef và provider message ID. Runtime/dashboard hiển thị draft → final ref; không lưu raw PII/chain-of-thought. Live usage vẫn chưa đo.                |
| R14 integration/handoff       | done local | Regression comments, Order Inbox, care, takeover, follow-up, security, proposition, Meta inbound và outbox fake đã chạy. Production release/rollback chỉ được chuẩn bị, chưa thực hiện.                                                                                      |

## Callsite product-local

```text
Meta inbound event
  -> MetaInboundProcessor (revision/lease/idempotency)
  -> MetaChatBrain (retrieve + interpret + TurnContextSnapshot)
  -> DemoChatService / reducers (state + fact/order/action receipts)
  -> shared composer
  -> response governor (presentation only)
  -> final response validator
  -> committed outbox plan
  -> Meta adapter dispatch with revision + ownership gates
```

Module mới không đứng rời: `MetaChatBrain.reply()` tạo và truyền `TurnContextSnapshot`, gọi `projectMemoryForTurn()` và `validateFinalResponse()`; `MetaInboundProcessor` gắn revision/context metadata và dispatch plan đã commit.

## Feature matrix giữ nguyên

- Messenger sales/consultation, teencode và multi-intent.
- Fact Ledger, correction khác chủ thể, beneficiary và episode memory.
- Bảng giá/catalog, Order Inbox, recap/chốt/sửa/hủy đơn.
- CSKH/safety, complaint, human takeover/resume.
- Facebook comment public/private/hide PII và comment episode riêng.
- Follow-up, idempotency, stale inbound gate, lease và outbox resume theo bubble.
- Prompt injection, system-prompt/data-leak boundary và third-party PII policy.

## Fixtures trước/sau

| Fixture                    | Lỗi baseline được mã hóa                               | Kết quả sau sửa                                                           |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| stale greeting/new episode | greeting có thể kéo pending/triệu chứng cũ             | profile được giữ, transient context bị xóa; Meta 24h test pass            |
| correction/khác subject    | fact cùng predicate có nguy cơ lẫn self/sibling        | projection scope theo subject; correction supersede đúng fact; tests pass |
| multi-intent               | answer hoặc mutation có thể mất khi action bị nén      | proposition/action độc lập và post-commit composer; tests pass            |
| money role swap            | số tiền đúng nhưng sai vai trò có thể lọt              | role-aware applicability/final validator chặn; test pass                  |
| governor block deletion    | câu hỏi lặp làm mất cả answer chung block              | chỉ bỏ sentence lặp; answer và negation được giữ; tests pass              |
| provider failure           | fallback có thể cạnh tranh với state/final             | accepted state/facts được giữ, fallback có nguồn; regression pass         |
| human takeover/stale send  | reply đã soạn có thể đi sau khi ownership đổi          | dispatch re-check state/human ownership; integration pass                 |
| ambiguous transport        | timeout có thể gửi lặp                                 | delivery `unknown`, retry không gửi lại mù; integration pass              |
| current question vs memory | triệu chứng cũ có thể lấn câu hỏi cách dùng/da/combo   | intent của lượt hiện tại thắng projection cũ; chuỗi regression pass       |
| phủ định mùi + recap đơn   | “không bị mùi nặng”/“tổng kết đơn” có thể đi sai route | lưu đúng mùi nhẹ; recap nhường cho order renderer hiện hành               |
| khách tạm cân nhắc         | bot có thể recap và ép chọn tiếp                       | trả ngắn, không ép số lượng/địa chỉ, không xóa dữ liệu đã có              |

## Ngân sách model logic

- Fast deterministic/LLM disabled: 0 logical model call.
- Success thường: 1 interpret call; `adoptInterpretedDraft` chỉ validate local.
- Knowledge context retry: tối đa thêm 1 interpret call.
- Mutation cần post-commit wording: thêm 1 compose call.
- Content repair: tối đa 1 call cho toàn turn.
- Worst-case theo flow hiện tại: 4 logical calls (2 interpret + 1 post-commit + 1 repair). Hybrid/hedged provider có thể tạo nhiều provider attempt bên trong một logical call; chưa đo token/chi phí live trong task này.

## Compatibility và rollback

- Không có migration phá dữ liệu. `recordedAt`, `eventAt`, `freeShippingApproval`, `responseAttention`, `responseTrace` và outbox metadata là field optional/additive trong JSON; reader cũ có thể bỏ qua. Legacy freeship boolean được nâng thành receipt tương thích khi restore.
- Legacy relative-time fact thiếu `eventAt` được giữ để audit nhưng không dùng khẳng định current.
- Rollback release: dùng lại image/commit trước thay đổi; JSON keys additive không cần rollback DB. Không trộn hai engine cùng gửi.
- Trước production release phải chạy gate hiện có, deploy cùng một image cho HTTP/worker, smoke Tailscale domain và giữ image trước đó để rollback.

## Guard/template cũ

- Đã vô hiệu trên product path: outer content-free rewrite, fact-ledger final lock, delivery-inspection final lock, internal post-commit retry, blind parser truncation và whole-block question deletion.
- Còn giữ có chủ ý: security/boundary, care acknowledgement, claim/commerce/action/state guards và deterministic provider-failure copy. Các nhánh này không được biến thành sales fallback.
- Legacy full-catalog assertion còn cho callsite không có response contract; Meta product path luôn truyền response contract nên không còn là content authority.

## Chính sách được giữ cho bản local này

1. Product Messenger tiếp tục nghiệp vụ hiện tại: đủ dữ liệu thì tiếp nhận vào Order Inbox; không thêm bước bắt khách gõ đúng một từ khóa. Ở flow cần xác nhận, các cách nói tự nhiên như “đúng rồi”, “ok vậy chốt” vẫn được chấp nhận.
2. Episode hội thoại hết hạn sau 24 giờ theo `CONVERSATION_CONTEXT_TTL_HOURS`; episode mới xóa pending/asked cũ nhưng giữ profile đã xác minh, đơn đang xử lý và care chưa giải quyết. Không thay đổi chính sách lưu trữ dài hạn 90 ngày hiện có trong đợt này.
3. Catalog cấu hình/version hiện tại tiếp tục là nguồn giá authoritative. Không giả lập ERP, tồn kho live hay policy vận chuyển chưa nối.
4. Ngân sách live eval trong đợt local là 0; canary, OpenAI thật, Meta thật và phát hành production là bước release riêng sau khi người dùng duyệt.

## Trạng thái xác minh

- `npm run check`: lint, typecheck, 662 tests (655 pass, 7 integration skip theo mặc định, 0 fail) và build đều đạt.
- Bật PostgreSQL/Redis local và các cờ opt-in: 7/7 integration pass, gồm migration/idempotency, lease/queue/recovery và hai memory E2E. Như vậy toàn bộ 662 test đã được thực thi đạt khi cộng hai gate đúng môi trường.
- Cụm renderer/guard/dashboard/Meta/brain/order kiểm tra riêng: 108/108 pass.
- `git diff --check` và `npm run format:check`: pass.
- PostgreSQL local đã áp dụng migrations `015_meta_comment_workflow.sql`, `016_meta_comment_moderation.sql` và `017_meta_page_management.sql`; production chưa migrate.
- Deterministic `product-memory`: 6 kịch bản/70 lượt, 0 exception, 0 reply rỗng, 0 `needs_attention`, 0 cụm từ lộ memory/state nội bộ. LLM/OpenAI bị ép tắt trong lần chạy này.
- Live OpenAI/Meta/Tailscale/product: **chưa xác minh trong task này**.
- Deploy GitHub → server: **chưa thực hiện**.
