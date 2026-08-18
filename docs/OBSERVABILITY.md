# Observability & alerts

Mọi log JSON mang `traceId`, `tenantId`, `pageId`, `conversationId` khi có; PII và secret bị redaction.

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
- Price conflict hoặc prohibited claim >0 trong outbound gate.
- Provider 5xx >5%/5 phút; order partial failure >0.
- Cross-tenant test/security scan thất bại: chặn deploy ngay.
