# Trạng thái ổn định đường phản hồi Stopirex — local

Ngày nghiệm thu gần nhất: 23/09/2026 (Asia/Ho_Chi_Minh)

## 1. Kết luận

**Đạt local kỹ thuật cho phạm vi I01–I11 và F01–F06 của handoff.** Vòng nghiệm thu ngày 23/09 có kiểm tra kết nối product chỉ đọc; không gọi provider thật, gửi Meta thật hoặc tạo đơn thật.

Chưa được gọi là production-ready. Giọng tự nhiên trên model thật, latency/token thật, quyền Meta và cấu hình runtime production vẫn **NOT VERIFIED**.

## 2. Baseline và phạm vi thay đổi

- Repo: `/Users/mikedoan/Công Việc/chatbot/Ai chatbot stopirex`.
- HEAD giữ nguyên: `3065309ee4de7b411a2b83fca737cb1a3932252a`.
- Baseline handoff: 25 tracked files đã dirty; tracked diff SHA-256 `78d195c8308110401c3423ae53623a845c5e8949e5c32146cabb158ded3cdc25`.
- Không reset, checkout hay ghi đè các thay đổi có sẵn.
- Trước khi thêm báo cáo này: 29 tracked files dirty, 2.952 insertions/272 deletions; tracked diff SHA-256 `206273c371edbb73504a90b35888cd2bf4b761d5238850f94033c01889e461f2`.
- Báo cáo này là file mới, chưa stage/commit.

Các khối code chính đã thay đổi:

- Evidence/memory/safety/money/finalization: `conversationFacts.ts`, `memoryProjection.ts`, `turnContext.ts`, `knowledgeResolver.ts`, `responseContract.ts`, `finalResponseValidator.ts`, `customerCare.ts`, `demoChat.ts`, `codexLlm.ts`, `metaChatBrain.ts`.
- Comment/proof/dispatch: `commentReplyPolicy.ts`, `responseGuard.ts`, `metaInboundProcessor.ts`, `postgres.ts`.
- Follow-up: `followupDispatcher.ts`, `followupRepository.ts`, `followupWorker.ts`.
- Regression/integration: các test memory, validator, knowledge, response contract, Meta inbound, follow-up, PostgreSQL/Redis và teencode product path.

## 3. I01–I11

Các cột “đỏ trước” dựa trên audit/repro được handoff cung cấp. Không reset working tree để tái chạy baseline cũ vì điều đó sẽ làm mất 25 file dirty của người dùng.

| ID  | Nguyên nhân                                                      | Thay đổi                                                                                                              | Đỏ trước                                                          | Xanh sau / mức xác minh                                                               |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| I01 | Validator suy luận phủ định/subject trên cả câu                  | So theo block, subject và fact projection; fact người khác không bắt self phải nhắc                                   | `mild_correct`, `two_people_correct`, polite conditional bị block | Audit helper + brain; `contextMemoryRegression`; hành trình V01 tới fake Meta         |
| I02 | Recap hardcode phản ứng/wax; personal claim được miễn bằng regex | Chỉ render fact có evidence; personal experience phải khớp subject/product/time trong memory                          | Recap tự thêm “chưa dị ứng”, “xót sau wax”; claim thiếu nguồn lọt | `M06`, wrong-product/personal tests, hai kịch bản context                             |
| I03 | Token overlap cho cả câu ghép                                    | Tách material proposition và kiểm từng dimension/polarity                                                             | Claim đúng che “chữa bệnh”/“uống trực tiếp”                       | Audit contract: cả ba payload compound đều reject/block                               |
| I04 | Parser tiền bỏ sót `k`, `đ`; không gắn role                      | Parser span chung, amount/currency/role/quantity; typed totals/discounts                                              | `1k`, `1đ`, khoản sai sau giá đúng lọt                            | P01–P04 + audit fault injection đều xanh                                              |
| I05 | Bỏ dấu làm `rất` thành `rát`; condition bị mất                   | Classifier safety có dấu dùng chung; obligation có `actual/conditional`; subject attribution được truyền vào contract | Cảm ơn bị safety; giả định/actual thiếu nghĩa vụ                  | Audit safety + C02/C03 + V01 xanh                                                     |
| I06 | Comment canned adaptation bị hold oan                            | Nghĩa vụ theo category; positive/thanks được reply; complaint giữ safety                                              | Complaint/cảm ơn 0 send                                           | C02/C03 processor → fake Meta: 2 part gửi đúng                                        |
| I07 | Proof comment được tạo lại sau khi source bị đổi                 | So source proof với exact `result.replies`; bind target/channel/recipient/source events/part map                      | Tamper comment vẫn gửi                                            | C04: paused, 0 public/private, 0 sendable outbox                                      |
| I08 | Receipt cũ/accepted được dùng cho mutation hiện tại              | Bind operation/resource/result version; current operation phải bằng turn hiện tại; history được phân biệt             | Receipt cũ xác minh “đã cập nhật”                                 | R01: current reject, historical allow                                                 |
| I09 | Human ownership chặn cả ACK ảnh                                  | Permission hẹp `handoff_ack`, bind event/recipient/version; sales vẫn `standard`                                      | ACK ảnh 0 send                                                    | D01–D02: ảnh đúng 1 ACK; sales dưới human 0 send                                      |
| I10 | Follow-up chỉ nhìn `messages`; CAS `claimed_at` mất microsecond  | Recheck raw durable `inbound_events`; CAS theo `attempt_count`; recheck sau compose/ngay trước send                   | Inbound mới trong compose vẫn gửi; job có thể treo claimed        | F01 PostgreSQL thật + fake Meta: 0 send, job cancelled; lease-loss không ghi đè claim |
| I11 | Fixture stale không nhất quán nên ném auth error                 | Tách auth-inconsistent, stale-consistent, valid; kiểm state/outbox                                                    | Test gọi stale nhưng revision tự mâu thuẫn                        | T01 PostgreSQL: đúng loại lỗi, 0 side effect ở hai nhánh lỗi, valid commit            |

## 4. Ma trận nghiệm thu §5

| Nhóm    | Test/path                                                                                                            | Kết quả và mức                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| M01–M04 | `test/finalResponseValidator.test.ts`: phủ định, polite conditional, sibling; `test/contextMemoryRegression.test.ts` | PASS helper + brain; subject đúng, đảo subject bị chặn              |
| M05–M06 | `contextMemoryRegression`; `M06 recap giữ đồng thời thói quen...`                                                    | PASS; fact không liên quan không làm đổi quyền nói; recap không bịa |
| M07     | `validator không đổi phản ứng của sản phẩm khác...`; audit `other_product_only`                                      | PASS; đúng evidence allow, sai/thiếu reject                         |
| M08     | `test/conversationFactLedger.test.ts`: retry cùng ngày/ngày khác/history                                             | PASS                                                                |
| K01–K02 | `closed-world guard...`; audit diabetes/cancer/oral route                                                            | PASS; từng proposition được kiểm                                    |
| K03–K04 | paraphrase buổi tối; record thiếu metadata/hết hạn/conflict                                                          | PASS                                                                |
| K05–K06 | audit safety; C02/C03; actual/conditional response contract                                                          | PASS; “rất tốt” không thành “rát”; condition được giữ               |
| P01–P02 | `P01...VND`; `P02-P04...`; audit `1k/1đ/1.000đ`                                                                      | PASS                                                                |
| P03     | `applicability guard gắn mỗi số tiền với đúng vai trò`; renderer quote tests                                         | PASS                                                                |
| P04     | phone/address/schedule/frequency parser test                                                                         | PASS, không nhận nhầm tiền                                          |
| P05     | `conversationBoundaryJourney`: split shipment hai nơi                                                                | PASS; tách quote, không gộp một shipment thiếu policy               |
| C01–C03 | Meta comment price, thanks/positive, complaint+safety, PII                                                           | PASS processor → stateful fake store → fake Meta                    |
| C04–C05 | C04 tamper; authorization binding tests/T01                                                                          | PASS, 0 send khi text/recipient/channel/scope/revision sai          |
| C06     | retry private, unknown send, outbox cursor/restart tests                                                             | PASS                                                                |
| R01–R02 | R01; queued receipt; exact field/value/version                                                                       | PASS helper                                                         |
| R03     | order inbox fail/retry, optimistic conflict/outbox tests                                                             | PASS fake adapter + PostgreSQL transaction                          |
| D01–D02 | `D01-D02 handoff ACK...`; normal takeover test                                                                       | PASS fake store mô phỏng SQL                                        |
| D03     | `D03 inbound durable mới giữa hai part...`                                                                           | PASS; part 1 gửi, part 2 bị chặn                                    |
| F01     | `test/integration.test.ts`: raw inbound durable trong compose                                                        | PASS PostgreSQL thật + fake Meta, 0 send                            |
| F02–F03 | `test/followupRuntime.test.ts`: cancel, lease loss, valid generated send                                             | PASS; CAS ownership được assert                                     |
| T01     | `test/integration.test.ts`: auth inconsistent/stale consistent/valid                                                 | PASS PostgreSQL thật                                                |
| T02     | `metaChatBrainArchitecture`, quota/timeout/disabled tests, finalizer fault injection                                 | PASS fake provider/disabled; cùng final gate                        |
| V01     | greeting/context tests và hành trình context 10 lượt tới fake Meta                                                   | PASS                                                                |
| V02     | order update/teencode proposition/product path                                                                       | PASS                                                                |
| V03     | style/recap/safety tests, no blind truncation                                                                        | PASS                                                                |
| V04     | prompt injection/API key/privacy/boundary tests                                                                      | PASS                                                                |

## 5. Lệnh nghiệm thu

### Full local

`npm run check`

- Lint: PASS.
- Typecheck: PASS.
- Test: 701 total, 693 pass, 0 fail, 8 opt-in skip.
- Build: PASS.

`npm run format:check`: PASS.

`git diff --check`: PASS.

### Opt-in bắt buộc

`RUN_LONG_MEMORY_AUDIT=1 npx tsx --test test/longConversationMemory.test.ts`

- 2 pass, 0 fail, 0 skip.

`INTEGRATION=1 DATABASE_URL=postgresql://...@127.0.0.1:25432/... REDIS_URL=redis://127.0.0.1:26379 npx tsx --test test/integration.test.ts test/redisRecovery.test.ts`

- 6 pass, 0 fail, 0 skip.
- PostgreSQL 16 và Redis 7 là container disposable riêng, loopback-only; không dùng container/volume có sẵn của người dùng.

### Audit gốc

- `AUDIT_RESPONSE_CONTRACT_2026-09-18.mjs`: payload chữa bệnh, uống trực tiếp, `1k`, `1đ`, giá đúng + khoản sai đều reject/block; safety actual/conditional allow với đủ obligation.
- `AUDIT_RESPONSE_RECHECK_2026-09-18.mjs`: memory controls allow, personal claim thiếu evidence reject, receipt cũ reject, comment tamper 0 send.
- Dòng `image_ack` trong audit script cũ vẫn cho 0 send vì fake store nằm ngoài repo chưa mô phỏng permission mới. Regression D01–D02 trong repo và `canDispatchConversationOutbound` PostgreSQL là bằng chứng hiện hành: ACK ảnh gửi đúng 1, sales/follow-up vẫn bị chặn.

## 6. Transcript synthetic tiêu biểu

| Ca                 | Input                                                    | Payload cuối / outcome                                                |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Hai người          | “Mình da bình thường, em gái mình da nhạy cảm”           | “Da mình bình thường. Da nhạy cảm là em của mình.” — allow            |
| Plain thanks       | “Cảm ơn shop”                                            | Public + private đều cảm ơn — 2 sends                                 |
| “rất tốt”          | “Mình dùng rất tốt, cảm ơn shop”                         | Positive reply — không safety trigger, 2 sends                        |
| Safety actual      | “Mình dùng bị rát”                                       | “Tạm ngưng sử dụng và không lăn lại khi da còn khó chịu...” — allow   |
| Safety conditional | “Nếu dùng bị ngứa thì sao?”                              | “Nếu... tạm ngưng sử dụng, không lăn lại...” — allow conditional      |
| Giá đúng + sai     | “285.000đ... phí 30.000đ. Riêng mình 1k”                 | block: `money_role_mismatch:unit_price:1000`; 0 send                  |
| Complaint safety   | “Dùng Stopirex bị ngứa rát...”                           | Public xin lỗi + private giữ “tạm ngưng” và “không lăn lại” — 2 sends |
| Ảnh                | image event                                              | 1 `handoff_ack`, state human; không tư vấn sales tiếp                 |
| Follow-up          | raw inbound “Thôi không mua nữa” xuất hiện trong compose | cancelled bằng CAS, 0 Meta send                                       |

## 7. Call budget và giới hạn

- Live OpenAI/Codex provider calls: **0**.
- Live Meta calls: **0**.
- Live Order Inbox/order creation: **0**.
- Các ca enabled dùng fake runner/adapter; disabled paths có `logicalModelCalls=0`. Recovery vẫn giữ ngân sách tối đa một repair như contract hiện hành.

**NOT VERIFIED:** chất lượng giọng trên model thật, latency/token/cost thật, Meta permissions/subscription thật, credential/secret production, dữ liệu production, rollout/rollback production.

## 8. Compatibility và bước tiếp theo

- Không migration phá dữ liệu; receipt/proof/type thay đổi theo hướng additive.
- Legacy outbox thiếu proof mới bị hold, không tự cấp quyền gửi.
- Rollback an toàn là revert riêng nhóm thay đổi này; không rollback bằng cách bỏ final gate hoặc gửi legacy payload chưa có proof.
- Chỉ sau khi người dùng phê duyệt mới nên chạy một batch live nhỏ, giới hạn rõ provider/Meta; không deploy trong lượt này.
