# Log Multi-turn Stress Test Stopirex

- Thời gian chạy: 2026-08-15 (Asia/Ho_Chi_Minh)
- Session: `stress-multiturn-1786806924283`
- API: `POST /demo/chat`
- Chế độ nguồn: `includeSources=true`

## Lượt 1

**Khách**

> Chào shop, nách mình dạo này ướt sũng áo với hơi có mùi. Trước dùng Etiaxil đỏ ngứa gãi trầy cả da, loại Stopirex nhà bạn có êm thật không hay lại quảng cáo?

**Bot**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ em hiểu mình lo vì trước đây từng bị rát hoặc ngứa ạ. Em không nhận xét về Etiaxil hay Perspirex; riêng mẫu Stopirex đã thử nghiệm có mức kích ứng da không đáng kể. Công thức có Aluminium Sesquichlorohydrate, Glycerin, Allantoin và Bisabolol; mình chỉ dùng khi da đã ổn, sạch, khô hoàn toàn và lăn một lớp mỏng ạ.
>
> Nguồn: product-comparison-traditional-rollon, safety-irritation-hypothetical, competitor-neutral-advice, product-composition-tolerance-approved, product-official-ingredient-list-2022, lab-test-2025-skin-irritation, product-training-ingredient-roles

**Log:** intent=`product_comparison`; pipeline=`2.Đang tư vấn`; Quality=`failed/question_coverage_incomplete`; LLM=`enhanced` (24.928 giây).

## Lượt 2

**Khách**

> Thấy bảo dịu nhẹ thì chắc là 100% không cồn đúng không? Với mình hay xịt nước hoa đắt tiền, cái lăn này có hoàn toàn không mùi như nước lavi không để khỏi bị lộn mùi?

**Bot**

> Dạ có ạ. Stopirex hỗ trợ kiểm soát mùi cơ thể ở vùng nách. Mình dùng buổi tối khi da sạch, khô, lăn một lớp mỏng và theo dõi trong 2 tuần đầu; nếu chưa cải thiện, nhắn bên em kiểm tra cách dùng ạ.
>
> Mình muốn em hướng dẫn cách dùng trước hay gửi bảng giá để tham khảo ạ?
>
> Nguồn: product-comparison-traditional-rollon

**Log:** intent=`product_effect`; pipeline=`2.Đang tư vấn`; Quality=`passed` (sai thực tế); composition=`fallback/knowledge_grounding_guard:ungrounded_numeric_fact`; LLM=20.447 giây.

## Lượt 3

**Khách**

> Thế bôi như nào? Sáng nay mình vừa nhổ lông nách xong, định tắm sạch rồi quệt luôn, mặc áo sơ mi trắng đi làm thì có sợ ố vàng nách áo không?

**Bot**

> Dạ lúc mới lăn da chỉ hơi ẩm nhẹ, sản phẩm khô nhanh và không bết ạ. Mình lăn một lớp mỏng trên da khô, chờ khô rồi mặc áo. Dùng đúng hướng dẫn, Stopirex không bám, không gây ố vàng nách áo hay làm cứng vải đâu anh/chị ơi.
>
> Nguồn: usage-application-feel-clothing, product-comparison-traditional-rollon

**Log:** intent=`product_effect`; pipeline=`2.Đang tư vấn`; Quality=`passed` (sai thực tế); LLM=`fallback/llm_hybrid_exhausted` sau 30.018 giây.

## Lượt 4

**Khách**

> Dùng lằng nhằng phết nhỉ. Thôi kệ, nếu thấy tốt đợt tới mình nhập 20 lọ về cho quầy thuốc thì chiết khấu bao nhiêu? Bên shop xuất hóa đơn đỏ VAT công ty cho đơn sỉ luôn nhé?

**Bot**

> Mình đang hỏi đơn sỉ 20 lọ và hóa đơn VAT. Phần chiết khấu và xuất hóa đơn đỏ công ty bên em chưa có dữ liệu đã xác nhận, cần nhân viên kiểm tra lại.
>
> Nguồn: wholesale-dealer-handoff

**Log:** intent=`buying`; pipeline=`C3.Chờ CSKH`; handoff=`bulk_quantity_over_5`; Quality=`passed`; LLM=`enhanced` (20.027 giây).

## Lượt 5

**Khách**

> À thôi từ từ, chưa nhập sỉ vội, cho mình chốt thử 1 lọ về dùng trước đã. Ship về Tòa V6, khu đô thị Victoria, Văn Phú, Hà Đông. SĐT 0987654321. Giao giờ hành chính nhé. Chiều nay Hà Nội có mưa không để mình dặn bảo vệ nhận cất cho cẩn thận?

**Bot**

> Dạ em đã ghi nhận nhu cầu nhập hàng cho tiệm thuốc ạ. Phần chiết khấu, tủ kệ và banner cần phương án riêng; em chuyển nhân viên kinh doanh hỗ trợ trực tiếp cho mình.
>
> Nguồn: wholesale-dealer-handoff

**Log:** intent=`order_support`; pipeline=`C3.Chờ CSKH`; handoff=`wholesale_or_dealer_request`; LLM=`skipped/deterministic_transition`; Quality=`passed` (sai thực tế).

**Order slots sau lượt 5:**

- quantity: chưa lưu
- customer_phone: chưa lưu
- customer_address: chưa lưu
- delivery_note: chưa lưu
- orderMissing: `recipientName`, `phone`, `legacyAddress`, `sku`, `quantity`, `totalVnd`, `paymentMethod`

## Lượt 6

**Khách**

> Chốt vậy đi. Hỏi nốt câu cuối, sau 2 tuần dùng mà nách vẫn ướt thì có hoàn tiền thật không? Nhưng hộp giấy lỡ bóc rách vứt đi rồi thì nhân viên tới lấy hàng hay sao?

**Bot**

> Dạ shop đổi trả nếu hàng còn nguyên seal và lỗi nhà sản xuất trong 7 ngày hoặc giao sai. Hàng bể vỡ do vận chuyển cần báo trong 48 giờ và có video mở hộp.
>
> Không áp dụng với hàng đã mở/dùng, không hợp mùi hoặc do khách làm hỏng. Sau khi nhận hàng trả, shop đổi mới hoặc hoàn tiền trong 3–5 ngày làm việc ạ.
>
> Nguồn: returns-process-fees-refund, product-comparison-traditional-rollon

**Log:** intent=`product_effect`; pipeline=`2.Đang tư vấn`; Quality=`failed/question_coverage_incomplete`; LLM=`fallback/llm_hybrid_exhausted` sau 30.027 giây.

## Trạng thái cuối phiên

- current_intent: `product_effect` — không đạt kỳ vọng `buying/order_support`
- pipeline: `2.Đang tư vấn` — không ở trạng thái xử lý đơn
- order_quantity: chưa có
- customer_phone: chưa có
- customer_address: chưa có
- delivery_note: chưa có
- handoff sỉ từ lượt 4 đã làm lệch lượt 5
- không có câu chê đối thủ
- lượt 2 không trả lời fact cồn/mùi
- lượt 6 lấy nhầm chính sách đổi trả hàng nguyên seal thay vì chính sách hoàn tiền sau khi dùng đúng đủ 2 tuần

## Kết luận

Phiên stress test không đạt. Lượt 4 đạt; lượt 1 đạt một phần; lượt 2, 3, 5 và 6 có lỗi quan trọng. Quality Gate có false-positive ở lượt 2, 3 và 5.

Lưu ý: theo chính sách hoàn tiền đã duyệt trước đó, trường hợp dùng đúng đủ 2 tuần nhưng chưa hiệu quả cần clip nhúng hủy sản phẩm và thông tin ngân hàng; không cần vỏ hộp, không gửi trả và không có nhân viên tới thu hồi sản phẩm.
