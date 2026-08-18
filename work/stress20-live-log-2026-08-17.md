# Log kiểm thử liên hoàn 20 lượt — Stopirex

- Thời điểm: 17/08/2026
- Session: `stress20-live-20260817-v2`
- Endpoint: `POST /demo/chat`
- Kết quả HTTP: 20/20 lượt trả `200`
- Tổng thời gian: 220.884 ms
- Trung bình toàn chuỗi: 11.044 ms/lượt
- Lượt gọi LLM: 14 lượt, trung bình 15.772 ms/lượt
- Fast path: 6 lượt
- Kết luận: **KHÔNG ĐẠT nghiệp vụ**. Không crash nhưng state bị lệch từ lượt 3; quantity không cập nhật ở lượt 7 nên các lượt sau tiếp tục dùng đơn 1 lọ.

## Tóm tắt đánh giá

| Lượt | Đánh giá | Intent | Pipeline sau lượt | Quantity | Lỗi chính |
|---:|---|---|---|---:|---|
| 1 | Đạt | product_comparison | 2.Đang tư vấn | — | — |
| 2 | Đạt | product_effect | 2.Đang tư vấn | — | — |
| 3 | Không đạt | consultation | C3.Chờ CSKH | — | Quality Gate handoff sai |
| 4 | Không đạt | knowledge_unknown | C3.Chờ CSKH | — | Không trả ETA Hà Nội; bị nhận như địa chỉ |
| 5 | Không đạt luồng | price_request | C3.Chờ CSKH | — | Giá đúng nhưng handoff cũ còn kẹt |
| 6 | Đạt một phần | buying | 5.Chờ TT KH | 1 | Lưu đơn nhưng vẫn hỏi lại phần địa chỉ |
| 7 | Không đạt | buying | C3.Chờ CSKH | 1 | Không ghi đè 1 → 3 |
| 8 | Không đạt | buying | 5.Chờ TT KH | 1 | Lưu SĐT nhưng không thay địa chỉ Keangnam |
| 9 | Không đạt | promotion_inquiry | C3.Chờ CSKH | 1 | Không khẳng định chính sách hiện tại không có quà |
| 10 | Đạt nội dung | usage_time | 2.Đang tư vấn | 1 | Trả đúng cách dùng buổi tối |
| 11 | Không đạt | ineffective | 2.Đang tư vấn | 1 | Trả sai hoàn toàn chính sách hoàn tiền |
| 12 | Không đạt | price_request | C3.Chờ CSKH | 1 | Không trả quy trình nhúng hủy/không cần vỏ hộp |
| 13 | Không đạt | buying | 5.Chờ TT KH | 1 | Không thực hiện phép trừ 3 − 1 = 2 |
| 14 | Không đạt | price_request | C3.Chờ CSKH | 1 | Không báo đúng recap 2 lọ 510.000đ |
| 15 | Đạt một phần | other | 5.Chờ TT KH | 1 | Lưu tên Nướng nhưng phản hồi “chưa hiểu” |
| 16 | Không đủ điều kiện xác minh | buying | 5.Chờ TT KH | 1 | Định Công chưa từng bị thay ở lượt 8 nên chưa test được phục hồi ký ức |
| 17 | Đạt một phần | order_support | 5.Chờ TT KH | 1 | Lưu note nhưng trả lời lạc sang công dụng |
| 18 | Không đạt | price_request | 3.Đã báo giá | 1 | Không recap đơn; gửi lại toàn bộ bảng giá |
| 19 | Đạt nội dung | buying | C3.Chờ CSKH | 1 | Handoff sỉ đúng, giữ đơn lẻ nhưng đơn lẻ đang sai quantity |
| 20 | Không đạt | other | 3.Đã báo giá | 1 | Không xác nhận đơn; hỏi lại phường/quận |

## Log đầy đủ

### Lượt 1

**Khách**

> Chào shop, nách mình dạo này ẩm ướt khó chịu. Thấy quảng cáo Stopirex là không cồn không mùi 100% đúng không?

**Bot**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ em xin thông tin chính xác đến mình ạ: Stopirex vẫn có chứa cồn (Alcohol) đóng vai trò làm dung môi trong ngưỡng an toàn, giúp da nhanh khô ráo. Sản phẩm có mùi dược tính đặc trưng nhẹ chứ không hoàn toàn không mùi như nước lọc, nhưng mùi sẽ bay hơi rất nhanh. Mình hoàn toàn yên tâm dùng chung với nước hoa mà không sợ bị lộn mùi đâu ạ.
>
> Nguồn: business-approved-alcohol-odor-guidance-2026-08, product-official-ingredient-list-2022, usage-morning-fragrance-layering

Log: `HTTP 200 · 14.010 ms · product_comparison · 2.Đang tư vấn · Quality passed`

### Lượt 2

**Khách**

> Dùng cái này có bị ố vàng nách áo sơ mi không? Mình đi làm hay mặc đồ trắng.

**Bot**

> Không ạ. Mình lăn lớp mỏng trên da sạch, khô rồi chờ khô hẳn trước khi mặc, Stopirex không bám và không gây ố vàng nách áo sơ mi.
>
> Nguồn: usage-application-feel-clothing, product-comparison-traditional-rollon

Log: `HTTP 200 · 12.585 ms · product_effect · 2.Đang tư vấn · Quality passed`

### Lượt 3

**Khách**

> Vợ mình thì không ra mồ hôi mấy nhưng thỉnh thoảng hơi có mùi, dùng ké được không hay phải mua loại khác?

**Bot**

> Phần phản hồi vừa xử lý chưa đạt kiểm tra nội dung nên em chưa gửi thông tin chưa chắc chắn. Em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

Log: `HTTP 200 · 14.785 ms · consultation · C3.Chờ CSKH · Quality failed/question_coverage_incomplete`

### Lượt 4

**Khách**

> Hôm nay Hà Nội mưa to ngập cả đường, ship có chậm không shop?

**Bot**

> Phần chưa có thông tin xác nhận, em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

Log: `HTTP 200 · 18 ms · knowledge_unknown · C3.Chờ CSKH · skipped/address_detected`

### Lượt 5

**Khách**

> Thôi được rồi, lọ này giá sao? Có freeship không?

**Bot**

> Dạ giá hiện tại: 1 lọ 285.000đ + 30.000đ giao; 2 lọ 510.000đ; 3 lọ 750.000đ; 4 lọ 1.000.000đ; 5 lọ 1.250.000đ. Combo 2–5 lọ miễn phí giao ạ.
>
> Phần chưa có thông tin xác nhận, em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

Log: `HTTP 200 · 12.344 ms · price_request · C3.Chờ CSKH · Quality passed`

### Lượt 6

**Khách**

> Đắt phết nhỉ. Thôi lấy 1 lọ đi. Giao về số 15 ngõ 50 Định Công, Hoàng Mai nhé.

**Bot**

> Dạ em đã ghi nhận 1 lọ; địa chỉ số 15 ngõ 50 Định Công, Hoàng Mai ạ.
>
> Mình bổ sung giúp em:
> • Tên người nhận
> • SĐT 10 số
> • địa chỉ trước sáp nhập còn thiếu phường/xã/thị trấn, quận/huyện/thị xã, tỉnh/thành phố ạ.

Log: `HTTP 200 · 29 ms · buying · 5.Chờ TT KH · quantity=1 · address=Định Công`

### Lượt 7

**Khách**

> À quên, bà chị cùng cơ quan cũng muốn mua. Đổi thành 3 lọ nhé. 3 lọ thì giá sao?

**Bot**

> Dạ em đã ghi nhận mình chọn 1 lọ ạ.
>
> Phần phản hồi vừa xử lý chưa đạt kiểm tra nội dung nên em chưa gửi thông tin chưa chắc chắn. Em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

Log: `HTTP 200 · 15.830 ms · buying · C3.Chờ CSKH · quantity vẫn =1 · Quality failed`

### Lượt 8

**Khách**

> Nhận 3 lọ ở nhà thì ngại lắm. Đổi địa chỉ ship qua công ty mình ở tòa nhà Keangnam, Phạm Hùng, Nam Từ Liêm nha. SĐT 0912345678.

**Bot**

> Dạ em tiếp tục 1 lọ đang làm dở cho mình nhé. Mình gửi giúp em: Tên người nhận, địa chỉ trước sáp nhập đầy đủ số nhà/đường/thôn, phường/xã, quận/huyện và tỉnh/thành phố ạ.

Log: `HTTP 200 · 8 ms · buying · quantity=1 · phone=0912345678 · address vẫn Định Công`

### Lượt 9

**Khách**

> Ủa hôm qua nhân viên bên shop bảo mua 3 lọ được tặng kèm sữa tắm mà, sao nay không thấy nhắc gì?

**Bot**

> Dạ phần quà tặng kèm 3 lọ hiện em chưa có dữ liệu xác nhận cho mình. Em chuyển bộ phận liên quan kiểm tra lại đúng chương trình hôm qua rồi phản hồi mình ngay ạ.
>
> Nguồn: effectiveness-usage-journey

Log: `HTTP 200 · 16.989 ms · promotion_inquiry · C3.Chờ CSKH · quantity=1`

### Lượt 10

**Khách**

> Sáng mai mình có cuộc họp quan trọng, sáng dậy bôi luôn cho chắc ăn được không?

**Bot**

> Không nên bôi sáng để “chắc ăn” ạ. Stopirex nên dùng buổi tối trên da sạch, khô; nếu quên tối nay thì mình không cần bôi bù sáng mai, dùng lại vào tối kế tiếp nhé.
>
> Nguồn: usage-timing-missed-evening-application

Log: `HTTP 200 · 14.313 ms · usage_time · 2.Đang tư vấn · Quality passed`

### Lượt 11

**Khách**

> Nhỡ cả 3 người dùng đều không đỡ thì có được trả hàng hoàn tiền như quảng cáo không?

**Bot**

> Dạ em hiểu rồi ạ — mình đang gặp cả tình trạng ra nhiều mồ hôi và có mùi. Stopirex phù hợp để hỗ trợ kiểm soát cả mồ hôi và mùi.
>
> Mình lăn một lớp mỏng vào buổi tối khi da sạch, khô. Dùng đều theo hướng dẫn sẽ giúp vùng da khô thoáng và dễ chịu hơn nhé.
>
> Để mình dễ cân nhắc, anh/chị muốn em gửi phương án 1 lọ dùng thử trước, hay gửi cả 1 lọ và combo để mình so sánh ạ?

Log: `HTTP 200 · 17.574 ms · ineffective · 2.Đang tư vấn · trả sai chính sách hoàn tiền`

### Lượt 12

**Khách**

> Nhưng lúc đấy vứt hết vỏ hộp giấy đi rồi thì sao?

**Bot**

> Dạ em đã ghi nhận mình chọn 1 lọ ạ.
>
> Phần phản hồi vừa xử lý chưa đạt kiểm tra nội dung nên em chưa gửi thông tin chưa chắc chắn. Em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

Log: `HTTP 200 · 18.468 ms · price_request · C3.Chờ CSKH · Quality failed`

### Lượt 13

**Khách**

> Thôi bà chị đổi ý rồi, không mua nữa. Trừ đi 1 lọ, giữ lại cho 2 vợ chồng dùng thôi.

**Bot**

> Dạ, em ghi nhận mình chọn 1 lọ nhé.
>
> Để em lên đơn chính xác, mình gửi giúp em trong một tin nhắn:
>
> 1. Tên người nhận
> 2. SĐT
> 3. Địa chỉ trước sáp nhập đầy đủ số nhà/đường/thôn, phường/xã, quận/huyện và tỉnh/thành phố ạ.

Log: `HTTP 200 · 19.657 ms · buying · 5.Chờ TT KH · quantity vẫn =1`

### Lượt 14

**Khách**

> Thế chốt lại đơn của mình bao nhiêu tiền?

**Bot**

> Dạ giá hiện tại: 1 lọ 285.000đ + 30.000đ giao; 2 lọ 510.000đ; 3 lọ 750.000đ; 4 lọ 1.000.000đ; 5 lọ 1.250.000đ. Combo 2–5 lọ miễn phí giao ạ.
>
> Phần chưa có thông tin xác nhận, em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

Log: `HTTP 200 · 13.890 ms · price_request · C3.Chờ CSKH · quantity=1`

### Lượt 15

**Khách**

> Tên người nhận là Nướng nhé.

**Bot**

> Dạ em chưa hiểu chắc ý “Tên người nhận là Nướng nhé.” trong ngữ cảnh hiện tại ạ. Mình diễn đạt rõ thêm chính câu này giúp em để em trả lời đúng nhé.

Log: `HTTP 200 · 8 ms · other · 5.Chờ TT KH · recipientName=Nướng đã lưu`

### Lượt 16

**Khách**

> Mình thay đổi phút chót, quay về nhận ở Định Công như ban nãy nhé, Keangnam không tiện nhận.

**Bot**

> Dạ em tiếp tục 1 lọ đang làm dở cho mình nhé. Mình gửi giúp em: địa chỉ trước sáp nhập đầy đủ số nhà/đường/thôn, phường/xã, quận/huyện và tỉnh/thành phố ạ.

Log: `HTTP 200 · 18.647 ms · buying · address=Định Công do lượt 8 chưa từng thay thành Keangnam`

### Lượt 17

**Khách**

> Note cho shipper là đến nơi gọi trước 15 phút không mình khóa máy đấy.

**Bot**

> Dạ em hiểu rồi ạ — mình đang gặp cả tình trạng ra nhiều mồ hôi và có mùi. Stopirex phù hợp để hỗ trợ kiểm soát cả mồ hôi và mùi.
>
> Mình lăn một lớp mỏng vào buổi tối khi da sạch, khô. Dùng đều theo hướng dẫn sẽ giúp vùng da khô thoáng và dễ chịu hơn nhé.
>
> Để mình dễ cân nhắc, anh/chị muốn em gửi phương án 1 lọ dùng thử trước, hay gửi cả 1 lọ và combo để mình so sánh ạ?

Log: `HTTP 200 · 14.593 ms · order_support · deliveryNote đã lưu · phản hồi sai chủ đề`

### Lượt 18

**Khách**

> Nhắc lại toàn bộ thông tin đơn hàng cho mình xem đã chuẩn chưa.

**Bot**

> ⚠️ GIÁ SANDBOX — chỉ để kiểm thử localhost, chưa phải dữ liệu production.
> Dạ giá hiện tại:
> • 1 lọ: 285.000đ + 30.000đ phí giao.
> • Combo 2 lọ: 510.000đ, miễn phí giao, tiết kiệm 60.000đ.
> • Combo 3 lọ: 750.000đ, miễn phí giao.
> • Combo 4 lọ: 1.000.000đ, miễn phí giao.
> • Combo 5 lọ: 1.250.000đ, miễn phí giao.
> Từ 6 lọ trở lên, bên em chuyển tư vấn viên hỗ trợ riêng ạ.
> Anh/chị muốn chọn phương án mấy lọ ạ?

Log: `HTTP 200 · 17.127 ms · price_request · 3.Đã báo giá · không recap đơn`

### Lượt 19

**Khách**

> Dùng tốt thì tháng sau mình nhập 50 lọ về bán thử trên TikTok Shop, lúc đấy chiết khấu 50% nhé?

**Bot**

> Dạ em ghi nhận nhu cầu nhập 50 lọ cho tiệm ạ. Phần chiết khấu cần xác nhận riêng; em chuyển bộ phận liên quan hỗ trợ trực tiếp cho mình.
>
> Nguồn: wholesale-dealer-handoff

Log: `HTTP 200 · 4 ms · buying · C3.Chờ CSKH · đơn lẻ vẫn còn nhưng quantity sai =1`

### Lượt 20

**Khách**

> Đùa thôi, cứ giao đơn lẻ này trước đi. Chào shop nhé.

**Bot**

> Dạ em hiểu “Đùa thôi, cứ giao đơn lẻ này trước đi. Chào shop nhé.” có thể là phần địa chỉ, nhưng em chưa chắc cách tách nên chưa tự ghi vào đơn ạ. Mình nhắn lại giúp em theo mẫu: Phường/xã: …; Quận/huyện: … ạ.

Log: `HTTP 200 · 5 ms · other · 3.Đã báo giá · không tạo đơn`

## State cuối cùng thực tế

```json
{
  "pipeline": "3.Đã báo giá",
  "quantity": 1,
  "orderDraft": {
    "sku": "STOPIREX",
    "quantity": 1,
    "totalVnd": 315000,
    "paymentMethod": "cod",
    "legacyAddress": "số 15 ngõ 50 Định Công, Hoàng Mai",
    "phone": "0912345678",
    "recipientName": "Nướng",
    "deliveryNote": "cho shipper là đến nơi gọi trước 15 phút không mình khóa máy đấy"
  },
  "orderId": null,
  "botPaused": false
}
```

## State kỳ vọng

```json
{
  "quantity": 2,
  "totalVnd": 510000,
  "shippingFeeVnd": 0,
  "recipientName": "Nướng",
  "phone": "0912345678",
  "legacyAddress": "số 15 ngõ 50 Định Công, Hoàng Mai, Hà Nội",
  "deliveryNote": "Gọi trước 15 phút",
  "orderCreated": true
}
```

## Các lỗi gốc được bộc lộ

1. Quality Gate đang chuyển handoff quá sớm ở câu có Knowledge.
2. Handoff mềm vẫn làm nhiễu các lượt giá/đơn tiếp theo.
3. Quantity update không hiểu “đổi thành 3 lọ” và phép trừ “3 trừ 1”.
4. Address replace không chạy khi câu chứa cả quantity tham chiếu, địa chỉ mới và SĐT.
5. Memory không thể được kiểm tra đúng ở lượt 16 vì lượt 8 đã không lưu Keangnam.
6. Refund policy mất chủ đề ở lượt 11–12.
7. Slot được lưu nhưng Response Planner trả sai ở lượt 15 và 17.
8. Order recap bị route nhầm thành price_request.
9. Escape hatch từ handoff sỉ về đơn lẻ không nhận câu “đùa thôi, cứ giao đơn lẻ này”.
10. Không có `orderId` cuối chuỗi.
