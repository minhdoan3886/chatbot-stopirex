# Kiểm kê hồi quy phiên bản Stopirex

Ngày kiểm kê: 2026-09-05

## Kết luận

Nguyên nhân chính không phải RAG. Merge `785aadc` ngày 2026-08-28 có hai parent
`8e3a3a6` và `e57f712`, nhưng tree của merge (`2f7a9c8825852bdc488e726a9c73acbda4716a23`)
giống tuyệt đối tree của parent thứ nhất. Toàn bộ phần triển khai chỉ tồn tại ở parent
thứ hai đã bị loại khỏi bản hợp nhất dù lịch sử commit vẫn còn.

Điều này tạo ra trạng thái nguy hiểm: Git hiển thị các commit tính năng là ancestor của
production, nhưng mã chạy thực tế không có tính năng đó. Cherry-pick lại commit cũng có
thể báo "đã có" hoặc gây xung đột trong khi file vẫn thiếu.

## Dòng phiên bản và chức năng

| Giai đoạn        | Commit tiêu biểu     | Giá trị đã có                              | Trạng thái trước đợt phục hồi |
| ---------------- | -------------------- | ------------------------------------------ | ----------------------------- |
| Nền tảng         | `d1c175f`            | Chat, state, knowledge, webhook cơ bản     | Còn                           |
| Đơn hàng         | `196d0bc`, `54b4cc9` | Hứng đơn, vận đơn, gửi Messenger           | Còn và đã được nâng cấp       |
| Comment          | `5246d28`, `6f80c04` | Private reply, nhận feed comment, workflow | Bị mất bởi merge              |
| Moderation       | `5876d98`, `3175a6d` | Không ẩn khiếu nại, tự ẩn PII              | Bị mất bởi merge              |
| Page management  | `3666b99`, `cd4f91c` | Token từng Page, OAuth, bật/tắt bot        | Bị mất bởi merge              |
| Độ bền comment   | `c8589e4`, `e8e9d2a` | Fallback Send API, comment mơ hồ           | Bị mất bởi merge              |
| Hội thoại mới    | `a44dc51`, `67b2f15` | Hợp đồng hội thoại, guard, state machine   | Còn                           |
| Memory/giọng văn | `2692476`, `68c43a4` | Fact ledger, response style policy         | Còn                           |
| Chống memory cũ  | `6ec370e`            | Mở episode mới sau TTL                     | Còn                           |

## Phục hồi trên kiến trúc hiện tại

Không checkout hoặc thay toàn bộ bằng `e57f712`, vì cách đó sẽ làm mất các cải tiến
state, fact ledger, response boundary, order consistency và natural style mới hơn.

Các nhóm được port có chọn lọc:

- Parse webhook `feed` và cô lập từng comment khỏi debounce Messenger.
- Public reply trước, đúng một private reply sau; outbox lưu cursor ngay sau từng lần gửi.
- Fallback từ `/{comment-id}/private_replies` sang Send API khi Meta trả 400/404.
- Workflow/audit comment trong PostgreSQL và màn hình `/comments`.
- Tự ẩn comment có SĐT/email; spam chỉ gợi ý kiểm tra; khiếu nại thật không tự ẩn.
- Facebook OAuth, mã hóa Page Token, danh sách `/pages`, bật/tắt bot từng Page.
- Worker và follow-up chọn đúng token theo Page.
- Webhook subscription gồm `feed` và healthcheck bắt buộc kiểm tra field này.
- Trang `/app-review` mô tả đúng đường test cho reviewer.

## Hàng rào chống tái diễn

- Test parser phải có feed comment và bỏ qua comment do Page tự tạo.
- Test dispatch phải chứng minh thứ tự public → private và retry không gửi trùng.
- Test moderation phải phân biệt PII với khiếu nại.
- Test OAuth phải kiểm tra state ký, redirect và danh sách quyền.
- Release chỉ hợp lệ sau `lint`, `typecheck`, toàn bộ unit/integration test và build.
- Khi merge hai nhánh chức năng, phải kiểm tra `git diff <parent2> <merge>`; không được
  chỉ dựa vào việc commit có xuất hiện trong `git log`.

## Giới hạn kiểm chứng production

Unit test không gọi OpenAI và không tiêu quota. Kiểm thử live Meta chỉ thực hiện sau khi
migration, deploy và Page subscription `feed` hoàn tất. Việc Meta App Review vẫn cần một
video mới thể hiện trọn vẹn Facebook Login, cấp quyền, chọn Page, nhận comment, public
reply, private reply và thao tác quản trị tương ứng với từng permission xin xét duyệt.
