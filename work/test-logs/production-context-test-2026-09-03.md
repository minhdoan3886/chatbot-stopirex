# Log test context trên production — 2026-09-03

## Kết luận

**FAIL — có CRITICAL FAIL.** Bot hiểu được một phần tiếng vùng miền/viết tắt và trả lời đúng các hướng dẫn dùng đơn lẻ, nhưng không vượt qua bài kiểm tra memory correction và phân biệt chủ thể. Thông tin của bạn user/review bị coi là tình trạng hiện tại của chính user, làm workflow chăm sóc sau bán khóa các lượt còn lại.

- Lượt đạt rõ ràng: khoảng **4/20 (20%)**.
- Kịch bản 1: khoảng **1/10** lượt đạt rõ ràng.
- Kịch bản 2: khoảng **3/10** lượt đạt rõ ràng.
- Hai lượt kiểm tra memory cuối đều không được trả lời.
- CRITICAL FAIL xuất hiện ở cả hai kịch bản.

Đây là production dry-run: test harness chạy trực tiếp bên trong container production, dùng đúng image, biến môi trường và OpenAI production, nhưng dùng session bộ nhớ riêng trong process và **không gọi webhook/không gửi tin cho khách qua Meta**.

## Môi trường

- Domain kiểm tra sức khỏe: `https://ubuntu-latitude-e5450.tail0d12f7.ts.net`
- Thời gian: `2026-09-03 16:28:22` đến `16:31:09` (Asia/Ho_Chi_Minh)
- Production image: `2cenq94k4kvxfmlfgmkmjrbn:c05ee7a2deede5ab57bb618ca24e6efe77049a39`
- Commit: `c05ee7a2deede5ab57bb618ca24e6efe77049a39`
- LLM: OpenAI `gpt-5.4-mini`
- Health trước và sau test: `{"status":"ok"}`
- Ready sau test: Postgres `true`, Redis `true`, OpenAI enabled `true`
- Session kịch bản 1: `production-context-smoke-1-1788427702385`
- Session kịch bản 2: `production-context-smoke-2-1788427796227`

## Kịch bản 1 — Khách miền Nam + viết tắt + sửa context

Latency trung bình `9.384 ms`; thấp nhất `5.104 ms`; cao nhất/P95 `23.037 ms`.

### Lượt 1 — FAIL

**User:** “ê shop, tui bị mh nách nh dữ lắm á, mùi thì k bao nhiêu mà áo cứ ướt quài”

**Bot:** “Em chưa có đủ thông tin đã được xác nhận để trả lời trọn các phần mình vừa hỏi. Em chuyển bộ phận liên quan kiểm tra rồi phản hồi mình ạ.”

- Latency: `23.037 ms`
- Telemetry: interpretation `fallback`, reason `llm_error`; composition `fallback`, reason `draft_missing`.
- Không ghi nhận mồ hôi nhiều/ướt áo/mùi ít vào `consultationFacts`.

### Lượt 2 — FAIL

**User:** “da tui cũng hơi dễ xót, nhất là bữa nào mới wax xong”

**Bot:** “Da mình đang hơi nhạy rồi đó ạ, nhất là lúc mới wax xong thì em chưa nên tư vấn dùng ngay. Mình cho em hỏi da đang xót ngay lúc này hay chỉ xót sau khi wax thôi ạ?”

- Latency: `10.858 ms`
- Bot nâng “dễ xót sau wax” thành “da hơi nhạy”; chưa bảo toàn đúng mức độ fact.

### Lượt 3 — FAIL

**User:** “tui gym tối 2 4 6 nữa, vậy xài cái này lúc nào ổn”

**Bot:** “Dạ bên em đang hướng dẫn dùng Stopirex vào buổi tối trên da sạch, khô hoàn toàn và lăn một lớp mỏng; mình không nên tự chuyển sang dùng buổi sáng ạ. Việc làm cả ngày và ra nhiều mồ hôi có thể ảnh hưởng cảm nhận khô thoáng, nên em đã ghi nhận cả lo lắng về mùi của mình.”

- Latency: `8.265 ms`
- Trả đúng hướng dẫn dùng buổi tối nhưng không kết hợp lịch gym `2/4/6`; còn thêm “làm cả ngày” và “lo lắng về mùi” không đúng dữ kiện.
- Composition fallback: `repair_failed:SkillResponseError`.

### Lượt 4 — PARTIAL

**User:** “mà khoan, lịch đổi r nha, giờ tui gym sáng 3 5 7”

**Bot:** “Dạ vậy mình vẫn dùng Stopirex vào buổi tối trên da sạch, khô hoàn toàn và lăn một lớp mỏng ạ. Sáng hôm sau mình cứ vệ sinh vùng nách như bình thường rồi đi gym…”

- Latency: `5.606 ms`
- Hiểu gym chuyển sang buổi sáng, nhưng state không có trường lưu lịch `3/5/7`, nên không chứng minh được đã thay lịch cũ.

### Lượt 5 — FAIL (state sai)

**User:** “nhỏ e tui cũng tính xài, nó mới là da nhạy cảm nha, tui da bt thôi, chỉ wax xong mới hay xót”

**Bot:** “Dạ mình da bình thường thì ổn hơn ạ, còn chỗ mới wax xong đang xót thì em chưa khuyên dùng ngay trên vùng đó. Nếu mình tính cho em nhỏ dùng, mình cho em xin tuổi của em nhỏ nhé?”

- Latency: `6.570 ms`
- Câu trả lời bề mặt phân biệt đúng hai người, nhưng state sau lượt vẫn ghi `consultationFacts.sensitiveSkin=true` cho customer.
- Beneficiary “em nhỏ” được tạo, nhưng fact da nhạy cảm không được gắn rõ vào beneficiary đó.

### Lượt 6 — PASS

**User:** “giả sử tối wax xong tui quẹt luôn mà bị rát thì sao”

**Bot:** “Nếu tối wax xong mà quẹt luôn rồi bị rát thì mình ngưng dùng ngay, không lăn lại khi da còn khó chịu nhé. Đợi da ổn hẳn rồi hãy dùng tiếp, thường sau wax nên chờ ít nhất 24–48 giờ.”

- Latency: `6.587 ms`
- Trả lời ở dạng điều kiện; chưa khởi động care workflow tại chính lượt này.

### Lượt 7 — CRITICAL FAIL

**User:** “th bạn tui thì xài xong bị ngứa mấy ngày á, nghe cũng rén =))”

**Bot:** “Dạ em rất tiếc vì vùng da của mình đang bị khó chịu sau khi dùng sản phẩm. Mình tạm ngưng sử dụng trước giúp em; em kiểm tra nhanh nguyên nhân cùng mình nhé ạ. Vùng da của mình có đang trầy xước hoặc bị tổn thương không ạ?”

- Latency: `9.712 ms`
- Gán triệu chứng của **bạn user** thành triệu chứng hiện tại của **user**.
- Audit khởi động `start_customer_care`; route chuyển sang `safety-first`.

### Lượt 8 — FAIL

**User:** “vậy case tui với th bạn tui khác nhau chỗ nào”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `10.384 ms`
- Không tách hai người; route `active_care` đã khóa câu trả lời.

### Lượt 9 — FAIL

**User:** “à hqua tui wax mà k xót gì hết nha”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `5.104 ms`
- Không xác nhận lần wax hôm qua không xót, tiếp tục giả định user đang đỏ/rát.

### Lượt 10 — FAIL

**User:** “chốt lại coi: vấn đề chính tui là gì, da sao, lịch gym hiện tại khi nào, tui từng bị ngứa do stopirex chưa?”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ. Hiện da của mình còn đỏ hoặc rát không ạ?”

- Latency: `7.718 ms`
- Không trả lời bất kỳ mục recap nào; còn lặp câu hỏi hai lần.
- `consultationFacts` cuối phiên chỉ còn `triggers:["exercise"]` và `sensitiveSkin:true`; không có lịch gym, mùi ít, ướt áo, wax hôm qua không xót, hay phân biệt triệu chứng của bạn user.

## Kịch bản 2 — Mix Bắc/Trung/Nam + context nhiễu + memory correction

Latency trung bình `7.327 ms`; thấp nhất `4.012 ms`; cao nhất/P95 `15.156 ms`.

### Lượt 1 — PASS

**User:** “nách mình kiểu ra mồ hôi như tắm ấy, mùa lạnh đôi khi vẫn bị”

**Bot:** “Dạ mình, tình trạng ra mồ hôi nách như vậy thì mình đang cần hỗ trợ kiểm soát mồ hôi rồi ạ.”

- Latency: `8.724 ms`
- State ghi `sweatConcern:true`.

### Lượt 2 — PASS

**User:** “cơ mà mùi thì bình thường thôi, chủ yếu khó chịu vụ ướt áo”

**Bot:** “Dạ vậy mình đang cần ưu tiên kiểm soát mồ hôi rồi ạ. Stopirex hợp với trường hợp này vì hỗ trợ giảm tiết mồ hôi…”

- Latency: `10.471 ms`
- Xác định đúng mồ hôi/ướt áo là vấn đề chính.

### Lượt 3 — PASS ở phản hồi, memory chưa đủ

**User:** “bữa ni tui mới cạo á, chừ quẹt cái ni được chưa hè”

**Bot:** “Chưa nên quẹt liền nha mình. Mới cạo thì để da nghỉ, khô hẳn rồi hãy dùng lại; nếu vùng đó đang rát hoặc có trầy xước thì càng nên ngưng trước.”

- Latency: `6.736 ms`
- Hiểu đúng “bữa ni/chừ/cái ni”; nhưng state không có fact thời điểm cạo để sửa ở lượt 9.

### Lượt 4 — CRITICAL FAIL

**User:** “trước tui có nói da tui nhạy cảm chưa ta”

**Bot:** “Có nha mình, trước đó mình có nói da đang nhạy cảm nên mình mới dặn chỉ dùng khi da đang lành, sạch và khô hẳn.”

- Latency: `4.237 ms`
- User chưa từng nói da nhạy cảm. Bot biến cảnh báo “mới cạo” thành tiền sử da nhạy cảm.

### Lượt 5 — CRITICAL FAIL

**User:** “oke vậy nhớ là da tui bt nha, chỉ có lần xài lăn khác ngay sau cạo thì bị rát thôi”

**Bot:** “Dạ em rất tiếc vì vùng da của mình đang bị khó chịu sau khi dùng sản phẩm. Mình tạm ngưng sử dụng trước giúp em; em kiểm tra nhanh nguyên nhân cùng mình nhé ạ. Vùng da của mình có đang trầy xước hoặc bị tổn thương không ạ?”

- Latency: `4.613 ms`
- Không ghi nhận sửa thành da bình thường; biến trải nghiệm lịch sử với **lăn khác** thành tình trạng hiện tại/Stopirex.
- Audit khởi động `start_customer_care` và khóa route.

### Lượt 6 — CRITICAL FAIL

**User:** “tui copy review này cho coi nè: ‘xài Stopirex 3 hôm là tui bị ngứa với đỏ da’”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `8.616 ms`
- Không nhận ra nội dung là review của người khác.
- Interpretation tạo `handoff_to_human` và `start_customer_care` từ đoạn review.

### Lượt 7 — FAIL

**User:** “vậy tui từng bị đỏ da vì stopirex đúng không”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `5.024 ms`
- Không phủ định và không tách trải nghiệm “lăn khác” khỏi review.

### Lượt 8 — FAIL

**User:** “rứa vấn đề chính của tui là mùi hay mh?”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `5.678 ms`
- Interpretation hiểu topic `sweat`, nhưng care route chặn câu trả lời đúng.

### Lượt 9 — FAIL

**User:** “mà cái vụ mới cạo là hôm qua nha, nãy tui nói hôm nay nhầm á”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `4.012 ms`
- Không xác nhận cập nhật từ hôm nay sang hôm qua; state không lưu thời điểm cạo.

### Lượt 10 — FAIL

**User:** “ê recap case tui thử coi, ngắn thôi: da gì, bị gì chính, cạo lúc nào, từng dị ứng stopirex chưa, với cái review đỏ da là của ai?”

**Bot:** “Dạ em hỏi lại một ý thôi ạ: hiện vùng da của mình còn đỏ hoặc rát không ạ?”

- Latency: `15.156 ms`
- Không trả lời recap. State cuối chỉ giữ `sweatConcern:true`; không giữ da bình thường, cạo hôm qua, sản phẩm khác gây rát, hay chủ thể của review.

## Đối chiếu 5 tiêu chí chung

| Tiêu chí                                     | Kết quả       | Bằng chứng chính                                                                                             |
| -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------ |
| Hiểu ngôn ngữ tự nhiên/viết tắt/vùng miền    | PARTIAL       | Hiểu “bữa ni/chừ/cái ni” và topic “rứa…mh”, nhưng lượt 1 kịch bản 1 fallback và route khóa làm phản hồi sai. |
| Nhớ context từ lượt trước                    | FAIL          | Cả hai lượt recap cuối đều không được trả lời; nhiều fact không được lưu.                                    |
| Cập nhật khi user sửa thông tin              | FAIL          | Không giữ lịch gym mới, da bình thường, hay cạo hôm qua.                                                     |
| Không nhầm user với người khác/review        | CRITICAL FAIL | Bạn user và review đều kích hoạt care workflow cho chính user.                                               |
| Không biến giả định/chưa xác nhận thành fact | CRITICAL FAIL | Tự nói user từng khai da nhạy cảm; trải nghiệm lịch sử/sản phẩm khác bị coi là tình trạng hiện tại.          |

## Chẩn đoán từ telemetry

1. Memory schema hiện không lưu đủ các fact cần cho bài test: lịch gym có ngày/buổi, thời điểm wax/cạo, mức độ mùi/ướt áo, nguồn sản phẩm gây kích ứng, và owner/source của review.
2. Subject resolution chưa an toàn: `bạn tui`, `em tui`, trích dẫn review và trải nghiệm lịch sử chưa được chặn trước khi `start_customer_care` chạy.
3. Care workflow có độ ưu tiên quá cao và không có cơ chế thoát khi user phủ định/cải chính. Sau khi vào `active_care`, nó bỏ qua cả câu hỏi trực tiếp và recap.
4. Response và state có thể mâu thuẫn: lượt 5 kịch bản 1 nói user da bình thường nhưng state vẫn là `sensitiveSkin:true`.
5. Một lỗi OpenAI thoáng qua ở lượt đầu (`llm_error`) khiến safe fallback hoạt động đúng về an toàn nhưng làm mất fact mở đầu của cả phiên.

## Trạng thái sau test

- Production vẫn `healthy` và `ready`.
- Không tạo đơn hàng.
- Không gửi tin Meta.
- Không sửa code, cấu hình hoặc dữ liệu production trong lần test này.
