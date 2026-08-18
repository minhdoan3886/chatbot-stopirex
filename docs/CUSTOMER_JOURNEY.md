# Hành trình khách hàng Stopirex — Sale + CSKH

## Nguyên tắc dữ liệu

- Mỗi khách chỉ có một `Pipeline` hiện tại.
- `Pipeline` trả lời khách đang ở giai đoạn nào; `Cản trở / sự cố` trả lời vì sao khách chưa đi tiếp.
- `Điểm gãy` ghi chi tiết thông tin còn thiếu hoặc bước đang chờ xử lý.
- Khi khách chuyển từ Sale sang CSKH, hệ thống lưu `Pipeline trước sự cố` và toàn bộ dữ liệu hội thoại đã có.
- Bot không hỏi lại dữ liệu khách vừa cung cấp hoặc dữ liệu đã có trong phiên.
- Mỗi lượt chỉ hỏi một câu ngắn. Câu Có/Không được ưu tiên khi phù hợp.

## Nhánh Sale

`0.Chưa tư vấn → 1.Phân loại → 2.Đang tư vấn → 3.Đã báo giá → 4.XL băn khoăn → 5.Chờ TT KH → 6.Đã tạo đơn`

Nhánh phụ:

- Khách im lặng sau giá: `3.Đã báo giá → 7.Chờ followup → N.Nuôi dưỡng`.
- Nhịp follow-up Sale: 3 giờ, 6 giờ, 9 giờ; khách phản hồi thì quay lại `4.XL băn khoăn` hoặc `5.Chờ TT KH`.
- Khách từ chối rõ: `R.Đã rớt`.
- Khách hỏi giá ngay: báo USP + giá + một câu hỏi kéo về khai thác; không bắt khách trả lời nhiều câu trước khi được xem giá.

## Nhánh CSKH

`C0.Tiếp nhận → C1.Xác minh → C2.Chờ ảnh (nếu cần) → C3.Chờ CSKH → C4.Theo dõi → C5.Đã xử lý`

### Kích ứng/ngứa/rát

1. Xin lỗi, trấn an và dừng luồng bán hàng.
2. Hỏi da hiện còn đỏ/rát không.
3. Nếu còn đỏ/rát: hướng dẫn tạm ngưng trên vùng da đó và chuyển CSKH khẩn; bot dừng.
4. Nếu đã hết: hỏi có vừa cạo/wax/triệt, dùng buổi tối khi da khô và số lần/tuần.
5. Nếu cách dùng chưa đúng: hướng dẫn lại các nguyên tắc đã được duyệt và tạo bước theo dõi.
6. Nếu đã dùng đúng mà vẫn kích ứng: chuyển người thật; bot không tự điều chỉnh tần suất.

### Không hiệu quả

1. Hỏi dùng buổi tối không.
2. Hỏi da đã khô hoàn toàn không.
3. Hỏi số lần dùng mỗi tuần.
4. Hỏi công việc ngoài trời/vận động hay văn phòng.
5. Nếu có bước dùng sai: hướng dẫn lại phần đã được duyệt rồi theo dõi kết quả.
6. Nếu dùng đúng vẫn không hiệu quả: chuyển CSKH kiểm tra; bot không tự tăng tần suất.

### Hàng hỏng/thiếu

1. Lấy mã đơn.
2. Phân loại: hỏng/đổ sản phẩm, thiếu hàng hay chỉ móp hộp.
3. Xin ảnh/video kiện hàng và sản phẩm thực nhận.
4. Hỏi kết quả khách mong muốn.
5. Chuyển CSKH đối chiếu chính sách trước khi xác nhận đổi/trả/hoàn.

### Giao hàng

1. Lấy mã đơn.
2. Phân loại: chưa nhận, giao chậm hay nhận sai.
3. Chuyển nhân viên tra soát; bot không hứa thời gian giao hoặc bồi hoàn.

### Nghi hàng giả

1. Hỏi kênh/gian hàng mua.
2. Lấy mã đơn.
3. Xin ảnh bao bì, tem và đáy lọ.
4. Chuyển CSKH xác minh; bot không kết luận thật/giả khi chưa đủ bằng chứng.

### Đánh giá tiêu cực

1. Tiếp nhận, không tranh cãi và nhắn riêng.
2. Hỏi vấn đề cụ thể, mã đơn và kết quả khách mong muốn.
3. Chuyển nhân viên gọi qua OmiCall và xử lý nguyên nhân.
4. Chỉ xin khách cân nhắc cập nhật đánh giá sau khi vấn đề đã được giải quyết.

## Các quyết định bắt buộc người thật/chính sách duyệt

- Tặng voucher.
- Đổi mới hoặc đổi miễn phí.
- Hoàn tiền hoặc hoàn tiền 100%.
- Thay đổi/tăng/giảm tần suất dùng ngoài hướng dẫn đã duyệt.
- Kết luận sản phẩm thật/giả.
- Cam kết thời gian giao hoặc bồi hoàn.

## Dữ liệu cần bổ sung trước production

- Chủ sở hữu case và SLA theo mức độ ưu tiên.
- Lịch sử chuyển Pipeline và thời gian nằm ở mỗi bước.
- File/ảnh bằng chứng gắn với mã đơn.
- Kết quả xử lý chuẩn hóa: hướng dẫn lại, đổi, trả, hoàn, không đủ điều kiện, khách không phản hồi.
- Lịch follow-up CSKH theo loại sự cố; không dùng chung nhịp 3/6/9 giờ của Sale.
- Cơ chế mở lại case nếu khách báo “chưa ổn”.
