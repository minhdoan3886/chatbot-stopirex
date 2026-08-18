# Runbook vận hành Stopirex Chatbot

## Dừng bot và rollback dưới 5 phút

1. Chuyển traffic/Page sang `human_status=human` hoặc tắt webhook routing của tenant.
2. Hủy follow-up còn `scheduled/claimed` với reason `rollback`.
3. Giữ webhook nhận event để không mất dữ liệu, nhưng không phát outbound.
4. Nếu lỗi content, rollback `knowledge_versions` về version trước trong một transaction.
5. Xác nhận không còn outbound trong log/outbox; bàn giao hội thoại mở cho CSKH.

## Sự cố theo dependency

- Meta/token: ngắt sender, giữ inbound/outbox; kiểm tra signature và rotation token.
- AI timeout/low confidence: chuyển human queue, không tự bịa câu trả lời.
- PostgreSQL: `/ready` trả 503; không acknowledge side effect chưa persist.
- Redis: dừng worker/follow-up, API vẫn nhận webhook vào DB nếu DB còn tốt.
- Pancake/Sapo partial failure: retry bằng cùng idempotency key; không tạo đơn mới.
- OmiCall lỗi: giữ call request open và báo operator xử lý thủ công.
- Giá/claim mâu thuẫn: fail closed, không gửi giá/claim; báo approver.

## Daily pilot review

- p95 latency, lỗi provider, queue lag và dead-letter.
- Tỷ lệ reply/useful reply/price/order/handoff/opt-out.
- Claim bị chặn, giá không xác định, cross-tenant guard.
- Follow-up 3–6–9h gửi trùng hoặc gửi sau reply.
- Đơn partial failure, hủy/hoàn và đánh giá tiêu cực.

## Go-live gate

- Không còn P0 chưa xử lý hoặc blocker chưa được owner chấp nhận.
- Credential đã lưu trong secret manager, rotation đã thử.
- 36 replay, integration DB/Redis, security và load test đạt.
- Có owner trực, SLA, rollback drill và human takeover.
