# Log Multi-turn Stress Test Stopirex — Sau khi sửa

- Thời gian chạy: 2026-08-15 (Asia/Ho_Chi_Minh)
- Session: `stress-accepted-final-20260815-2308`
- API: `POST /demo/chat`
- Chế độ nguồn: `includeSources=true`
- Kết quả: **ĐẠT 6/6 lượt**

## Lượt 1 — So sánh và tiền sử kích ứng

**Khách**

> Chào shop, nách mình dạo này ướt sũng áo với hơi có mùi. Trước dùng Etiaxil đỏ ngứa gãi trầy cả da, loại Stopirex nhà bạn có êm thật không hay lại quảng cáo?

**Bot**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ em hiểu mình lo vì trước đây từng bị rát hoặc ngứa ạ. Em không nhận xét về Etiaxil hay Perspirex; riêng mẫu Stopirex đã thử nghiệm có mức kích ứng da không đáng kể. Công thức có Aluminium Sesquichlorohydrate, Glycerin, Allantoin và Bisabolol; mình chỉ dùng khi da đã ổn, sạch, khô hoàn toàn và lăn một lớp mỏng ạ.
>
> Nguồn: product-comparison-traditional-rollon, safety-irritation-hypothetical, competitor-neutral-advice, product-composition-tolerance-approved, product-official-ingredient-list-2022, lab-test-2025-skin-irritation

**Log:** intent=`product_comparison`; pipeline=`2.Đang tư vấn`; Quality=`passed`; LLM=`fallback/llm_hybrid_exhausted`; latency=`32.061s`.

## Lượt 2 — Cồn và mùi

**Khách**

> Thấy bảo dịu nhẹ thì chắc là 100% không cồn đúng không? Với mình hay xịt nước hoa đắt tiền, cái lăn này có hoàn toàn không mùi như nước lavi không để khỏi bị lộn mùi?

**Bot**

> Dạ không phải 100% không cồn và cũng không hoàn toàn không mùi ạ. Stopirex có Alcohol dùng làm dung môi trong ngưỡng an toàn của công thức; sản phẩm có mùi đặc trưng nhẹ, bay nhanh và không làm lẫn mùi nước hoa. Hồ sơ hiện có không công bố tỷ lệ Alcohol nên bên em không tự nêu phần trăm.
>
> Nguồn: business-approved-alcohol-odor-guidance-2026-08, product-official-ingredient-list-2022, usage-morning-fragrance-layering

**Log:** intent=`product_comparison`; pipeline=`2.Đang tư vấn`; Quality=`passed`; LLM=`enhanced`; latency=`17.366s`.

## Lượt 3 — Nhổ lông, thời điểm dùng và ố áo

**Khách**

> Thế bôi như nào? Sáng nay mình vừa nhổ lông nách xong, định tắm sạch rồi quệt luôn, mặc áo sơ mi trắng đi làm thì có sợ ố vàng nách áo không?

**Bot**

> Dạ mình chưa bôi ngay sáng nay ạ. Sau nhổ, cạo, wax hoặc triệt lông, mình chờ 24–48 giờ và chỉ dùng khi da đã ổn. Stopirex dùng buổi tối trên da sạch, khô, lăn mỏng; chờ khô rồi mặc áo. Dùng đúng hướng dẫn, sản phẩm không bết và không gây ố vàng nách áo.
>
> Nguồn: usage-after-hair-removal, usage-application-feel-clothing

**Log:** intent=`usage_guidance`; pipeline=`2.Đang tư vấn`; Quality=`passed`; LLM=`enhanced`; latency=`24.909s`.

## Lượt 4 — Sỉ và VAT

**Khách**

> Dùng lằng nhằng phết nhỉ. Thôi kệ, nếu thấy tốt đợt tới mình nhập 20 lọ về cho quầy thuốc thì chiết khấu bao nhiêu? Bên shop xuất hóa đơn đỏ VAT công ty cho đơn sỉ luôn nhé?

**Bot**

> Dạ em ghi nhận nhu cầu nhập 20 lọ cho tiệm ạ. Phần chiết khấu và xuất hóa đơn VAT cần xác nhận riêng; em chuyển nhân viên kinh doanh hỗ trợ trực tiếp cho mình.
>
> Nguồn: wholesale-dealer-handoff

**Log:** intent=`buying`; pipeline=`C3.Chờ CSKH`; handoff=`bulk_quantity_over_5`; Quality=`passed`; LLM=`skipped/deterministic_transition`; latency=`0ms`.

## Lượt 5 — Hủy ý định sỉ, chốt đơn lẻ và hỏi thời tiết

**Khách**

> À thôi từ từ, chưa nhập sỉ vội, cho mình chốt thử 1 lọ về dùng trước đã. Ship về Tòa V6, khu đô thị Victoria, Văn Phú, Hà Đông. SĐT 0987654321. Giao giờ hành chính nhé. Chiều nay Hà Nội có mưa không để mình dặn bảo vệ nhận cất cho cẩn thận?

**Bot**

> Dạ em đã ghi nhận 1 lọ; SĐT 0987654321; địa chỉ Tòa V6, khu đô thị Victoria, Phường Văn Phú, Quận Hà Đông, Hà Nội; ghi chú “Gọi và giao trong giờ hành chính” ạ.
>
> Mình bổ sung giúp em:
> • Tên người nhận ạ. Em không theo dõi thời tiết theo thời gian thực ạ.

**Log:** intent=`buying`; pipeline=`5.Chờ TT KH`; Quality=`passed`; LLM=`skipped/deterministic_transition`; latency=`0ms`; handoff cũ đã được xóa.

**Order slots sau lượt 5**

- quantity: `1`
- customer_phone: `0987654321`
- customer_address: `Tòa V6, khu đô thị Victoria, Phường Văn Phú, Quận Hà Đông, Hà Nội`
- delivery_note: `Gọi và giao trong giờ hành chính`
- orderMissing: chỉ còn `recipientName`

## Lượt 6 — Hoàn tiền sau khi dùng và không còn vỏ hộp

**Khách**

> Chốt vậy đi. Hỏi nốt câu cuối, sau 2 tuần dùng mà nách vẫn ướt thì có hoàn tiền thật không? Nhưng hộp giấy lỡ bóc rách vứt đi rồi thì nhân viên tới lấy hàng hay sao?

**Bot**

> Dạ nếu mình đã dùng đúng hướng dẫn đủ 2 tuần mà vẫn chưa hiệu quả, bên em hỗ trợ hoàn tiền ạ. Mình gửi số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước. Trường hợp này mình không cần giữ vỏ hộp hay gửi sản phẩm về; đủ hồ sơ em chuyển sale online xử lý tiếp ạ.
>
> Nguồn: refund-used-ineffective

**Log:** intent=`order_support`; pipeline=`5.Chờ TT KH`; Quality=`passed`; LLM interpretation=`interpreted`; composition=`fallback/action_grounding_guard`; latency=`18.016s`.

## Trạng thái cuối phiên

- current_intent: `order_support`
- pipeline: `5.Chờ TT KH`
- order_quantity: `1`
- customer_phone: `0987654321`
- customer_address: `Tòa V6, khu đô thị Victoria, Phường Văn Phú, Quận Hà Đông, Hà Nội`
- delivery_note: `Gọi và giao trong giờ hành chính`
- orderMissing: chỉ còn `recipientName`
- handoff sỉ đã được Escape Hatch xóa ở lượt 5
- dữ liệu đơn không bị mất khi khách hỏi chính sách hoàn tiền ở lượt 6
- không nói xấu đối thủ, không nhận sai “100% không cồn/không mùi”, không bịa chiết khấu/VAT, không yêu cầu gửi lại sản phẩm đã nhúng hủy

## Kết luận

Phiên stress test đạt yêu cầu chức năng. Lượt 1 vẫn ghi nhận `llm_hybrid_exhausted` sau khoảng 32 giây, nhưng fallback Knowledge trả đúng nội dung, đúng nguồn và Quality Gate pass; đây còn là vấn đề độ trễ provider cần theo dõi, không còn làm sai câu trả lời hoặc state.
