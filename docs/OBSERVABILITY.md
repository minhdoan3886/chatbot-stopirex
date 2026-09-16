# Observability & alerts

Mọi log JSON mang `traceId`, `tenantId`, `pageId`, `conversationId` khi có; PII và secret bị redaction.

## Response rebuild trace

Một lượt Messenger dùng cùng `traceId` từ raw inbound đến outbox. Các event chính:

- `llm_interpretation`: provider/model thực tế, latency, intent, action/proposition count, Knowledge ID đã cite và số lần retrieval lại.
- `canonical_knowledge_resolved`: fact/source ID, conflict và fact chưa giải quyết. Metadata `status`, `scope`, version/effective time phải được giữ từ record gốc.
- `turn_context_snapshot`: `turnId`, inbound/state revision, active subject, memory fact được chọn, fact bị loại kèm lý do, KB version, receipt ID và thông tin còn thiếu.
- `workflow_response_contract`: fact bắt buộc, CTA được phép/cấm và slot nghiệp vụ còn thiếu.
- `llm_composition`, `llm_composition_repaired`, `question_coverage_soft_warning`: nguồn draft/final, lý do fallback và repair. Toàn lượt chỉ có một content-repair budget.
- `final_response_validation_failed`: danh sách `{category, code, evidenceRefs, repairable, requiredContextChange}`; không log chain-of-thought.
- `conversation_turn_audit`: state/order revision trước-sau, action/mutation receipt, response source, số logical model call, repair count và hash tham chiếu workflow/draft/final.
- Runtime state giữ `responseDecision`, `responseAttention` và `responseTrace`. Dashboard đọc trực tiếp `needs_attention`, hiển thị mã lỗi cùng cặp draft → final hash để nhân viên tìm đúng turn mà không lộ nội dung/PII.
- Outbox và message audit giữ `traceId`, `turnContextVersion`, `inboundRevision`, `responseRef` và `deliveryStatus`. Event `meta_outbound_part_sent` nối final hash với provider message ID. Trạng thái gửi phải phân biệt `queued`, `sent`, `failed`, `unknown`; `unknown` không được blind retry.

Không ghi raw SĐT, địa chỉ, access token, prompt hệ thống hoặc toàn bộ memory/Knowledge vào audit. Evidence dùng reference/hash; usage không có từ provider phải là `null`/`unknown`, không ghi `0` giả.

## Metrics

- HTTP/webhook latency p50/p95/p99, signature reject, unknown Page.
- AI latency/error/low confidence, token và cost theo tenant.
- Redis queue lag, due follow-up, retry/dead-letter.
- Meta/Pancake/Sapo/OmiCall success, 429/5xx và circuit open.
- Price lookup conflict, blocked claim, handoff, opt-out.
- Order created/partial failure/cancelled/returned.

## Alerts

- `/ready` 503 liên tục 5 phút.
- Webhook error >2%, queue lag >2 phút, follow-up overdue >10 phút.
- Dead-letter >0 hoặc key DLQ sai kiểu dữ liệu: cảnh báo critical; không replay tự động.
- Price conflict hoặc prohibited claim >0 trong outbound gate.
- Provider 5xx >5%/5 phút; order partial failure >0.
- Cross-tenant test/security scan thất bại: chặn deploy ngay.
