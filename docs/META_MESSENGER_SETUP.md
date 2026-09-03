# Kết nối Facebook Messenger với Stopirex Chatbot

## Trạng thái an toàn hiện tại

- Page Stopirex `108631178590851` đã được đăng ký trong PostgreSQL local.
- Callback GET, chữ ký POST, chống sự kiện trùng, phân loại echo bot/nhân viên, Redis consumer,
  lưu lịch sử/state và gửi Messenger đã có trong code.
- `META_LIVE_SEND_ENABLED=false`: hệ thống nhận và lưu sự kiện nhưng chưa tự gửi
  tin lên Page. Đây là công tắc chống gửi nhầm trong lúc cấu hình.
- Khi khách gửi ảnh, bot không đoán nội dung. Hệ thống xác nhận đã nhận ảnh, chuyển
  hội thoại sang người thật và tạm dừng bot.

## 1. Điền credential local

Mở file `.env` tại thư mục dự án và chỉ điền hai giá trị còn trống:

```dotenv
META_APP_ID="..."
META_APP_SECRET="..."
META_PAGE_ACCESS_TOKEN="..."
```

- `META_APP_ID`: ID ứng dụng Meta của chính chatbot, dùng để phân biệt tin bot
  với tin nhân viên gửi từ Pancake hoặc Page Inbox.
- `META_APP_SECRET`: Meta App Dashboard → **Cài đặt ứng dụng → Thông tin cơ bản**.
- `META_PAGE_ACCESS_TOKEN`: màn hình **Thiết lập API Messenger**, đúng dòng Page
  Stopirex → bấm **Tạo**. Token phải thuộc Page `108631178590851`.
- Không gửi hai giá trị này qua chat, không chụp ảnh có token và không commit `.env`.

## 2. Chạy backend và worker

Terminal 1:

```bash
docker compose up -d
npm run migrate
npm run seed
npm run meta:register-page
npm run dev
```

Terminal 2:

```bash
npm run worker
```

Terminal 3 (gateway hẹp, chỉ mở đúng webhook):

```bash
npm run meta:gateway
```

Kiểm tra:

```bash
curl http://127.0.0.1:8080/ready
npm run meta:preflight
```

`/ready` phải báo PostgreSQL và Redis đều `true`. Preflight phải đạt database,
Redis, Page mapping và callback local. Hai mục credential chỉ đạt sau khi điền
App Secret/Page Token.

## 3. Tạo URL HTTPS công khai

Đường dẫn Meta cần gọi là:

```text
https://TEN-MIEN-CONG-KHAI/webhooks/meta
```

Trong giai đoạn test có thể chạy:

```bash
cloudflared tunnel --url http://127.0.0.1:8081
```

Sao chép URL `https://....trycloudflare.com` mà lệnh trả về rồi nối thêm
`/webhooks/meta`. Cổng 8081 chỉ cho phép `GET/POST /webhooks/meta`; giao diện chat,
API demo và các endpoint nội bộ trên cổng 8080 không được đưa ra Internet. URL
Quick Tunnel thay đổi mỗi lần khởi động; production cần domain/tunnel cố định.

Product hiện dùng Tailscale Funnel cố định, không dùng Quick Tunnel:

```text
https://ubuntu-latitude-e5450.tail0d12f7.ts.net/webhooks/meta
```

## 4. Điền trên màn hình Meta trong ảnh

Tại **1. Đặt cấu hình webhook**:

- **URL gọi lại**: `https://TEN-MIEN-CONG-KHAI/webhooks/meta`
- **Xác minh mã**: sao chép giá trị `META_VERIFY_TOKEN` trong file `.env` local.
- Tạm thời không bật **Đính kèm chứng thực máy khách**.
- Bấm **Xác minh và lưu**.

Verify token trên chỉ dùng để bắt tay callback, không phải App Secret hay Page
Access Token.

## 5. Đăng ký sự kiện cho đúng Page

Sau khi callback được lưu, tại dòng Page Stopirex bấm **Thêm đăng ký** và chọn:

- `messages`
- `messaging_postbacks`
- `message_deliveries`
- `message_reads`
- `message_echoes`

Có thể thực hiện bằng lệnh sau sau khi đã điền Page Token:

```bash
npm run meta:subscribe-page
```

Lệnh sẽ kiểm tra token có thực sự thuộc Page Stopirex rồi mới đăng ký, vì vậy
không thể vô tình cắm token của Page khác.

## 6. Test nhận sự kiện nhưng chưa trả lời

Giữ nguyên:

```dotenv
META_LIVE_SEND_ENABLED=false
```

Khởi động lại API và worker sau mỗi lần đổi `.env`. Dùng tài khoản có vai trò
trong App/Page nhắn cho Page (App hiện ở chế độ Phát triển). Kiểm tra log:

- API: `meta_webhook_accepted`
- Worker: `meta_batch_processed` với trạng thái `ingested`
- Không có tin bot gửi lại vì công tắc gửi thật đang tắt.

Nếu Pancake cũng đang nhận Page, tạm tắt auto-reply của Pancake trong ca test để
không có hai hệ thống cùng trả lời một khách.

## 7. Bật trả lời Messenger có kiểm soát

Chỉ bật sau khi `npm run meta:preflight` đạt toàn bộ kiểm tra và đã xác nhận Page
Token đúng Page:

```dotenv
META_LIVE_SEND_ENABLED=true
```

Khởi động lại worker. Nhắn một câu mới, ví dụ `giá bao nhiêu`. Kỳ vọng:

1. Webhook xác minh chữ ký bằng App Secret.
2. Sự kiện được lưu idempotent và đẩy Redis.
3. Worker chỉ gọi LLM sau khi hội thoại yên lặng 4 giây. Nếu khách gửi thêm tin,
   đồng hồ chờ được đặt lại để gom cả chuỗi vào một lượt; thời gian gom có giới
   hạn để một hội thoại không làm nghẽn các hội thoại khác.
4. Codex/flow đọc lịch sử và tạo câu trả lời; guardrail giữ giá/chính sách/an toàn.
5. Tin được gửi qua Send API; echo của chính bot bị bỏ qua. Khi echo đến từ
   Pancake/Page Inbox hoặc một App khác, hệ thống chuyển `human_status=human`,
   hủy follow-up đang chờ và khóa mọi phản hồi bot tiếp theo trong phiên đó.
6. State, Pipeline, tin vào và tin ra được lưu PostgreSQL.

## 8. Lưu ý chế độ Phát triển của Meta

Khi App còn ở **Phát triển**, chỉ tài khoản có vai trò trong App và tài khoản test
được tương tác đầy đủ. Trước khi chuyển **Chính thức**, cần hoàn tất quyền/app
review cần thiết, URL chính sách quyền riêng tư, xóa dữ liệu và các yêu cầu hiện
hành của Meta.

Khi nhân viên gửi tin trực tiếp trong đúng hội thoại Pancake, bot sẽ nhường phiên
ngay. Muốn bật lại bot phải thực hiện thao tác trả quyền rõ ràng; không tự bật lại
chỉ vì khách nhắn thêm để tránh bot chen vào lúc nhân viên đang xử lý.
