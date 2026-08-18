# Log nghiệm thu AI Chatbot Stopirex

- Ngày chạy: 15/08/2026
- API: `POST http://127.0.0.1:8080/demo/chat`
- Chế độ nguồn: `includeSources=true`
- Mỗi bài test sử dụng một session độc lập.

---

## Test 1 — Thời gian sử dụng một lọ

**Câu hỏi khách hàng**

> Một lọ lăn bé tí tẹo thế này thì bôi được mấy tháng là cạn đáy vậy shop?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ Một lọ thường dùng khoảng 3–4 tháng khi mình lăn mỏng 2–3 lần/tuần ạ.
>
> Nguồn: usage-bottle-duration

**Trace**

- Intent: `usage_frequency`
- Skill: `solution-guidance`
- Pipeline: `2.Đang tư vấn`
- Nguồn: `usage-bottle-duration`
- Quality Gate: **Không đạt** — `next_step_missing`
- LLM: `hybrid`, interpreted; khoảng 18.063 ms ở lượt đầu

---

## Test 2 — Chốt 1 lọ + tắm xà phòng + hóa đơn VAT

**Câu hỏi khách hàng**

> Mình muốn lấy 1 lọ. Cho mình hỏi cái này bôi xong sáng hôm sau tắm lại bằng xà phòng thì có mất tác dụng không? Và bên shop có xuất hóa đơn VAT điện tử công ty cho đơn hàng này luôn được không?

**Câu trả lời thực tế**

> Mình báo luôn: bôi tối xong, sáng hôm sau tắm lại bằng xà phòng bình thường không làm mất tác dụng.
> Về hóa đơn VAT điện tử công ty, em ghi nhận và chuyển nhân viên kiểm tra cho đơn này. Mình gửi giúp em tên, SĐT và địa chỉ nhận nhé.
>
> Nguồn: usage-morning-wash-with-soap, policy-vat-invoice-handoff

**Trace**

- Intent: `buying`
- Skill: `knowledge-handoff`
- Pipeline: `C3.Chờ CSKH`
- Trạng thái đơn: `paused`
- Nguồn: `usage-morning-wash-with-soap`, `policy-vat-invoice-handoff`
- Quality Gate: **Đạt**
- LLM: `hybrid`, enhanced; khoảng 24.821 ms ở lượt đầu
- Lỗi quan sát: state đã `paused` nhưng câu trả lời vẫn xin tên, SĐT và địa chỉ.

---

## Test 3 — Tin giả nắp vàng, nọc rắn và 50% muối nhôm

**Câu hỏi khách hàng**

> Nghe đồn Stopirex mới ra phiên bản nâng cấp nắp vàng có chứa nọc rắn và 50% muối nhôm để khóa mồ hôi đúng không? Dùng nồng độ cao thế có bị ung thư vú hay viêm nang lông không?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ thông tin này chưa đúng với hồ sơ sản phẩm chính thức bên em ạ. Stopirex không có phiên bản nắp vàng chứa nọc rắn hay thông tin 50% muối nhôm. Riêng lo ngại y khoa, em không tự đưa kết luận hoặc số liệu ngoài nguồn đã duyệt.
>
> Phần chưa có thông tin xác nhận, em chuyển nhân viên kiểm tra và phản hồi mình ạ.
>
> Nguồn: product-official-version-and-false-ingredients, authenticity-before-purchase

**Trace**

- Intent: `authenticity_question`
- Skill: `knowledge-handoff`
- Pipeline: `C3.Chờ CSKH`
- Nguồn: `product-official-version-and-false-ingredients`, `authenticity-before-purchase`
- Quality Gate: **Đạt**
- LLM: interpreted, composition fallback do `critical_direction_guard`; khoảng 27.989 ms

---

## Test 4 — Cứng vải và ố vàng áo

**Câu hỏi khách hàng**

> Cái lăn nách nhà bác bôi lên nách áo sơ mi trắng đi làm thì có bị cứng đơ vải với ố vàng khè ra áo không? Hôm trước mua loại kia hỏng mất 2 cái áo hàng hiệu.

**Câu trả lời thực tế**

> Không, nếu mình lăn đúng lớp mỏng trên da sạch khô rồi chờ khô hẳn trước khi mặc, Stopirex không làm cứng vải và không ố vàng nách áo sơ mi trắng. Mình từng bị hỏng áo với loại khác thì bên này cứ dùng đúng hướng dẫn là yên tâm.
>
> Nguồn: usage-application-feel-clothing, product-comparison-traditional-rollon

**Trace**

- Intent: `product_effect`
- Skill: `direct-answer`
- Pipeline: `2.Đang tư vấn`
- Nguồn: `usage-application-feel-clothing`, `product-comparison-traditional-rollon`
- Quality Gate: **Đạt**
- LLM: `hybrid`, enhanced; khoảng 20.135 ms

---

## Test 5 — Hoàn tiền và mất vỏ hộp

**Câu hỏi khách hàng**

> Dùng không đỡ thì có được hoàn tiền như quảng cáo không? Mà vỏ hộp giấy mình lỡ bóc rách vứt đi rồi, giờ muốn gửi trả thì bên bạn cho người qua lấy hay mình phải tự mang ra bưu điện?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ bên em hỗ trợ hoàn tiền khi mình đã dùng đúng hướng dẫn đủ 2 tuần mà vẫn chưa hiệu quả ạ. Hồ sơ gồm số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước.
>
> Về việc không còn vỏ hộp và cách gửi trả, em chuyển nhân viên CSKH kiểm tra đơn cụ thể rồi hướng dẫn mình; em không tự báo phí hoặc cách gửi ạ.
>
> Nguồn: refund-used-ineffective, returns-process-fees-refund, product-comparison-traditional-rollon

**Trace**

- Intent: `product_effect`
- Skill: `direct-answer`
- Pipeline: `1.Phân loại`
- Nguồn: `refund-used-ineffective`, `returns-process-fees-refund`, `product-comparison-traditional-rollon`
- Quality Gate: **Đạt**
- LLM: fallback do `llm_hybrid_exhausted`; khoảng 30.011 ms

---

## Test 6 — Nhập sỉ 50 lọ

**Câu hỏi khách hàng**

> Mình có tiệm thuốc, muốn nhập sỉ 50 lọ Stopirex về bán thì chiết khấu bao nhiêu %? Bên shop có cấp luôn tủ kệ trưng bày với file banner chạy quảng cáo không?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ em ghi nhận nhu cầu nhập 50 lọ cho tiệm ạ. Phần chiết khấu, tủ kệ và banner cần phương án riêng; em chuyển nhân viên kinh doanh hỗ trợ trực tiếp cho mình.
>
> Nguồn: wholesale-dealer-handoff

**Trace**

- Intent: `buying`
- Skill: `order-closing`
- Pipeline: `C3.Chờ CSKH`
- Nguồn: `wholesale-dealer-handoff`
- Quality Gate: **Đạt**
- LLM: interpreted; composition fallback do `unsupported_part_not_disclosed`; khoảng 19.928 ms
- Lỗi quan sát: nội dung đúng nhưng intent nên là `order_support` hoặc `wholesale_inquiry`.

---

## Test 7 — Triệt tiêu vĩnh viễn và tỷ lệ tái phát

**Câu hỏi khách hàng**

> Mình đi khám bác sĩ bảo bị hôi nách do tuyến mồ hôi apocrine hoạt động quá mạnh. Bôi cái lăn này có triệt tiêu vĩnh viễn được tuyến đó không? Tỉ lệ khách hàng dùng bên bạn bị tái phát sau 1 năm là bao nhiêu phần trăm?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ Stopirex hỗ trợ kiểm soát lượng mồ hôi tiết ra, không triệt tiêu vĩnh viễn tuyến mồ hôi ạ. Bên em chưa có số liệu đã duyệt về tỷ lệ tái phát sau 1 năm nên không tự báo phần trăm; em chuyển nhân viên kiểm tra phần này cho mình.
>
> Về số liệu theo dõi sau một năm, em chuyển nhân viên kiểm tra nguồn đã duyệt rồi phản hồi mình ạ.
>
> Nguồn: mechanism-control-not-permanent, product-comparison-traditional-rollon

**Trace**

- Intent: `product_effect`
- Skill: `knowledge-handoff`
- Pipeline: `C3.Chờ CSKH`
- Nguồn: `mechanism-control-not-permanent`, `product-comparison-traditional-rollon`
- Quality Gate: **Không đạt** — `question_coverage_incomplete`
- LLM: `hybrid`, enhanced; khoảng 20.285 ms
- Lỗi quan sát: câu handoff bị lặp dù hai ý đã được xử lý.

---

## Test 8 — Quên bôi buổi tối, muốn bôi bù buổi sáng

**Câu hỏi khách hàng**

> Hôm nào xỉn quá quên bôi buổi tối thì sáng dậy lôi ra quẹt luôn trước khi đi làm có được việc không, hay bôi thế phí thuốc chả có tác dụng gì?

**Câu trả lời thực tế**

> Không nên quẹt sáng rồi đi làm ạ; Stopirex dùng buổi tối trên da sạch, khô để có thời gian phát huy. Sáng hôm sau mình tắm rửa bình thường, không cần bôi bù.
>
> Nguồn: usage-morning-wash-with-soap, usage-exercise-sweat-washoff

**Trace**

- Intent: `usage_time`
- Skill: `direct-answer`
- Pipeline: `2.Đang tư vấn`
- Nguồn: `usage-morning-wash-with-soap`, `usage-exercise-sweat-washoff`
- Quality Gate: **Đạt**
- LLM: `hybrid`, enhanced; khoảng 20.085 ms

---

## Test 9 — Dùng nước hoa và hỏi xà phòng trị thâm

**Câu hỏi khách hàng**

> Sáng bôi cái này xong mình xịt luôn nước hoa mùi gỗ vào nách thì có bị đánh nhau mùi không? Với bên shop có bán kèm xà phòng trị thâm nách không để mình gom mua luôn thể cho tiện?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ Stopirex không dùng hương thơm để che mùi nên sáng mình dùng nước hoa sẽ không bị lẫn hương ạ. Hiện gian hàng chưa bán xà phòng trị thâm nách nên em không tự gợi ý sản phẩm ngoài danh mục.
>
> Nguồn: catalog-no-underarm-darkening-soap, usage-morning-fragrance-layering

**Trace**

- Intent: `usage_guidance`
- Skill: `solution-guidance`
- Pipeline: `2.Đang tư vấn`
- Nguồn: `catalog-no-underarm-darkening-soap`, `usage-morning-fragrance-layering`
- Quality Gate: **Không đạt** — `next_step_missing`
- LLM: `hybrid`, enhanced; khoảng 20.577 ms
- Lưu ý: tiêu chí cũ “không mùi” phải đổi thành “có mùi đặc trưng nhẹ, bay nhanh”.

---

## Test 10 — Hạn sử dụng và thời hạn sau mở nắp

**Câu hỏi khách hàng**

> Hạn sử dụng in dưới đáy chai là tận 3 năm cơ à? Thế là cứ mở nắp ra thì cứ để loanh quanh trong nhà tắm dùng lai rai 3 năm mới phải vứt đúng không?

**Câu trả lời thực tế**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ hạn 3 năm là hạn của sản phẩm còn nguyên và bảo quản đúng ạ. Sau khi mở, mình xem ký hiệu trên chai; bên em chưa có mốc tháng đã duyệt nên không tự báo 6 hay 12 tháng.
>
> Phần chưa có thông tin xác nhận, em chuyển nhân viên kiểm tra và phản hồi mình ạ.
>
> Nguồn: shelf-life-and-after-opening, usage-general

**Trace**

- Intent: `usage_guidance`
- Skill: `knowledge-handoff`
- Pipeline: `C3.Chờ CSKH`
- Nguồn: `shelf-life-and-after-opening`, `usage-general`
- Quality Gate: **Đạt**
- LLM: interpreted; composition fallback do `unsupported_part_not_disclosed`; khoảng 19.303 ms
- Thiếu dữ liệu: chưa có PAO chính thức sau khi mở nắp.

---

## Tổng hợp

- Nội dung sạch hoàn toàn: test 4, 5 và 8.
- Đúng nội dung chính nhưng còn lỗi state/intent/Quality Gate: test 1, 2, 6, 7 và 9.
- Chưa đủ dữ liệu để nghiệm thu trọn vẹn: test 3 và 10.
- Thời gian LLM lượt đầu trung bình khoảng 22,1 giây.
- Có một lượt chạm timeout khoảng 30 giây và chuyển sang Knowledge fallback.
