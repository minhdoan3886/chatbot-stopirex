# Conversation Fact Ledger

## Mục tiêu

Fact Ledger giữ dữ kiện tư vấn theo đúng **chủ thể, sản phẩm, thời điểm và nguồn**.
Nó giải quyết các lỗi mà RAG không thể tự xử lý, chẳng hạn gán review của người
khác thành phản ứng hiện tại của khách, hoặc dùng lịch gym cũ sau khi khách đã
sửa lại.

RAG tiếp tục chịu trách nhiệm cung cấp kiến thức sản phẩm đã duyệt. Fact Ledger
chỉ giữ sự thật phát sinh trong cuộc hội thoại; Response Planner kết hợp hai lớp
này nhưng không được phép thay đổi đơn hàng.

## Mô hình dữ kiện

Mỗi fact có:

- `subjectId`: `self`, người thân, bạn hoặc người viết review;
- `predicate`: loại da, vấn đề mồ hôi/mùi, lịch vận động, thời điểm cạo/wax hoặc
  phản ứng sản phẩm;
- `product`: Stopirex, sản phẩm lăn khác hoặc chưa xác định;
- `temporal` và `scenario`: hiện tại, quá khứ, thói quen hoặc giả định;
- `source`: khách tự kể, kể về người khác, review được copy hoặc giả định;
- `evidence`, `confidence`, `sourceTurn` và trạng thái `current/superseded`.

Fact đơn trị dùng quy tắc `last-evidence-wins`: dữ kiện mới hợp lệ thay thế bản
cũ nhưng bản cũ vẫn còn trong lịch sử với liên kết `supersededBy`.

## Bất biến an toàn

1. Review, giả định và lời kể về người khác không được ghi thành phản ứng của
   `self`.
2. Phản ứng với sản phẩm khác không được mở ca CSKH Stopirex.
3. Chỉ sự cố hiện tại của chính khách sau khi dùng Stopirex mới được mở flow
   kích ứng.
4. Fact Planner không được chiếm quyền của recap/correction đơn hàng hoặc câu
   hỏi chính sách hoàn tiền.
5. LLM có thể đề xuất `record_fact`, nhưng evidence phải xuất hiện nguyên văn
   trong tin hiện tại và confidence phải đạt ngưỡng; reducer mới là nơi commit.
6. Khi Fact Ledger đã tạo câu trả lời kiểm chứng chủ thể, lớp compose không được
   viết lại thành một chủ thể/sản phẩm khác.

## Internal truth và lời khách nhìn thấy

Fact Ledger giữ đầy đủ `current`, `superseded`, subject, source và evidence để
kiểm toán. Response Style Policy chỉ nhận sự thật hiện hành cần cho lượt trả lời;
không được mô tả cách hệ thống ghi nhớ hoặc thay thế fact.

Ví dụ, internal truth có thể giữ cả lịch gym cũ và mới. Khách chỉ thấy:
“Oke, giờ mình gym sáng 3, 5, 7 nha.” Các cụm như “lịch cũ không còn hiệu lực”,
“em cập nhật state”, “tách hai trường hợp” hoặc “điều này không xóa thông tin”
không được phép xuất hiện trong câu Fact Ledger.

Lượt thông thường ưu tiên 1–3 câu ngắn, không dùng dấu chấm phẩy và không recap
toàn bộ case. Chỉ câu hỏi recap/tổng kết/so sánh rõ ràng mới được lấy nhiều vùng
dữ kiện cùng lúc. Prompt LLM và deterministic response cùng dùng một policy;
runtime guard chặn câu làm lộ thao tác memory.

## Kiểm thử

```bash
npm run check
npm run test:product-memory -- --scenario=5
npm run test:product-memory -- --scenario=6
```

Scenario 5 kiểm tra tiếng miền Nam, viết tắt, correction lịch gym và tách phản
ứng của bạn. Scenario 6 kiểm tra tiếng vùng miền, sản phẩm khác, review copy và
sửa thời điểm cạo/wax. Smoke test chỉ chạy hội thoại trong process; nó không gửi
tin ra Meta.

Hai suite được tách riêng:

- `contextMemoryRegression.test.ts`: kiểm correctness của state, subject,
  correction và care routing.
- `contextNaturalness.test.ts`: kiểm không lộ meta-memory, không recap thừa,
  không dùng dấu chấm phẩy, độ dài lượt thường và phản ứng hội thoại tự nhiên.
