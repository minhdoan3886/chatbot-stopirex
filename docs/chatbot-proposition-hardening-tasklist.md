# Tasklist hoàn thiện workflow/state reducer/guardrail

Mục tiêu kiến trúc: mỗi ý trong một tin nhắn được hiểu, kiểm chứng và xử lý độc lập; chỉ state reducer được phép thay đổi đơn; câu trả lời chỉ được xác nhận dữ liệu đã có trong commit receipt.

## P0 — Tính đúng đắn của state và đơn hàng

### P0.1 — Semantic output theo proposition

- [x] Thêm `propositions[]` vào Structured Output của OpenAI.
- [x] Mỗi proposition có `id`, `speechAct`, `action`, `target`, `rawEvidence`, `confidence` và payload phù hợp.
- [x] `rawEvidence` phải là đoạn nguyên văn trong tin khách.
- [x] Một tin được phép có nhiều proposition độc lập: hỏi đáp, chọn số lượng, cung cấp dữ liệu, cập nhật ghi chú.
- [x] `primaryIntent` chỉ dùng cho analytics/routing; không được phủ quyết proposition có evidence hợp lệ.
- [x] Duy trì cầu nối sang `actions[]` cũ trong giai đoạn chuyển đổi.

Tiêu chí hoàn tất:

- Tin “chốt 1 lọ, ship Q1 SG không, free ship không?” tạo đủ ba proposition.
- Không mất FAQ khi cùng lượt có mutation đơn hàng.

### P0.2 — Normalization deterministic

- [x] Tách extraction (LLM xác định loại dữ liệu) khỏi normalization (code xác định giá trị).
- [x] Chuẩn hóa SĐT số/chữ/teencode tiếng Việt và validate đầu số di động Việt Nam.
- [x] Không commit SĐT nếu kết quả không đủ 10 số hoặc confidence thấp.
- [x] Chuẩn hóa alias địa chỉ: `q1`, `sg`, `f/p dakao` và các dạng không dấu.
- [x] Lưu đồng thời raw value, normalized value, confidence và evidence.
- [x] Chuẩn hóa ghi chú giao hàng như “giờ hành chính”, “T2–T6”, “không nhận T7”.

Tiêu chí hoàn tất:

- `ko 9 tam bay 6 nam 4 ba 2 mot` → `0987654321`.
- `q1 sg` chỉ là delivery context; chưa trở thành địa chỉ xác nhận đầy đủ.
- `12/4 nguyen thj minh khai, f dakao` merge với context thành địa chỉ đầy đủ.

### P0.3 — Mutation firewall và reducer độc lập

- [x] Chỉ proposition thuộc nhóm mutation mới được đi vào order reducer.
- [x] `answer_question` luôn zero-mutation.
- [x] Validate/normalize từng proposition trước reducer.
- [x] Correction mới có evidence được phép thay giá trị cũ; last-evidence wins trong cùng lượt.
- [x] Low-confidence extraction bị từ chối, không mutation mặc định.
- [x] FAQ có thể ngắt luồng thu đơn mà không làm mất draft.

### P0.4 — Commit receipt là nguồn sự thật

- [x] Reducer trả `accepted`, `rejected`, `unchanged`, `changedFields`, `missingFields`.
- [x] Mỗi mutation có `propositionId`, source, evidenceRef, from/to đã mask.
- [x] Audit được sinh trực tiếp từ receipt, không ghép từ semantic plan.
- [x] Invariant: có `changedFields` thì phải có accepted mutation tương ứng.

### P0.5 — Response chỉ nói sau commit

- [x] Composer nhận post-commit state và commit receipt.
- [x] Structured response khai báo `claimedSavedFields`.
- [x] Invariant: `claimedSavedFields ⊆ accepted/committed fields`.
- [x] Recap đơn chỉ được dựng từ post-commit state.
- [x] Nếu validator thất bại, yêu cầu LLM sửa flexible text; không thay bằng workflow cũ sai ngữ cảnh.

### P0.6 — Multi-action response contract

- [x] Tạo response requirements cho từng proposition.
- [x] Trả lời đủ các FAQ đã nhận diện trong cùng lượt.
- [x] CTA dựa trên missing fields sau commit, không dựa trên intent tổng.
- [x] Không hỏi lại phone/address/name đã commit.
- [x] Có thể lấy tên Facebook làm người nhận khi khách không cung cấp tên và policy cho phép.

### P0.7 — Regression invariants

- [x] `never claims a field was saved unless reducer committed it`.
- [x] `questions never mutate confirmed order fields`.
- [x] `one message may produce multiple independent actions`.
- [x] `low confidence extraction never mutates order state`.
- [x] `a new FAQ may interrupt order collection without losing draft`.
- [x] `raw and normalized entity values remain traceable`.
- [x] `response summary must be derivable entirely from committed state`.
- [x] Chạy lại hai kịch bản production dài: khách đổi ý và khách teencode.

Bằng chứng 2026-09-03: scenario 3 và scenario 4 đã chạy qua product path với OpenAI thật trên staging cô lập; các regression phát hiện trong scenario 4 đã được sửa và khóa bằng test.

## P1 — Chất lượng tư vấn và an toàn nội dung

### P1.1 — Claim guard theo closed-world

- [x] Chặn claim tuyệt đối không có canonical fact: `không gây`, `100%`, `chắc chắn`, `không bao giờ`, `cam kết sẽ`.
- [x] Phân biệt “có hỗ trợ giảm thâm?” với “có gây thâm không?”.
- [x] Product claim chỉ hợp lệ khi có fact ID, provenance, version và applicability phù hợp.
- [x] Claim sai được trả lại cho LLM sửa wording, không chèn văn mẫu cứng.

### P1.2 — Objection handling có state

- [x] Lưu objection type, đối thủ được nhắc, luận điểm đã dùng/bị bác và trạng thái open/resolved.
- [x] Giá cao + đối thủ → acknowledge → verified difference → value explanation → soft CTA.
- [x] Không công kích đối thủ, không bịa “êm dịu/không châm chích” nếu knowledge không chứng minh.

### P1.3 — CTA policy

- [x] Workflow cung cấp `preferred`, `allowed`, `forbidden`, `goal`, `requestedSlots`.
- [x] LLM chọn/diễn đạt một CTA hợp lệ; được chọn `none`.
- [x] Tối đa một conversational ask mỗi lượt.
- [x] Không hỏi “chọn mấy lọ” ngay sau câu hỏi báo giá nếu khách chưa có tín hiệu mua.

## P2 — Quan sát, độ bền và phát hành

### P2.1 — Audit và observability

- [x] Log proposition accepted/rejected với evidenceRef.
- [x] Log normalization raw/normalized/confidence nhưng mask PII.
- [x] Log commit receipt, response claimed fields và kết quả invariant.
- [x] Dashboard có thể phân biệt lỗi interpret, normalize, reducer, compose và guard.

Bằng chứng 2026-09-03: worker tổng hợp telemetry đã che PII vào Redis heartbeat và trang `/operations` hiển thị riêng năm chặng.

### P2.2 — Race/idempotency recovery

- [x] Khi optimistic concurrency conflict: reload state → reconcile lại đúng một lần.
- [x] Nếu vẫn conflict: trả queue, không gửi response từ state cũ.
- [x] Giữ unique inbound ID và outbox idempotency key hiện có.

### P2.3 — Kiểm thử và release gate

- [x] Unit test proposition parser/bridge.
- [x] Unit test phone/address/note normalization.
- [x] Unit test mutation firewall/receipt/invariants.
- [x] Integration test `MetaChatBrain + OpenAI` với transcript nguyên văn.
- [x] `lint`, `typecheck`, toàn bộ test và build đều pass.
- [x] Chỉ deploy production sau khi có báo cáo test và người dùng xác nhận phát hành.

Bằng chứng phát hành 2026-09-03: 570 test cục bộ không lỗi, 4/4 PostgreSQL/Redis/memory integration test đạt trên staging, GitHub CI và Security đạt trước rolling deploy Coolify.

## Definition of Done tổng

- Không có câu “đã ghi nhận” cho dữ liệu chưa được reducer commit.
- Không có mutation từ câu hỏi thuần túy.
- Một tin nhiều ý được trả lời và xử lý đủ từng ý.
- Knowledge/claim áp dụng đúng thời điểm, sản phẩm và đối tượng.
- Transcript product dài qua `MetaChatBrain + OpenAI` giữ đúng context, state và giá hiện hành.
