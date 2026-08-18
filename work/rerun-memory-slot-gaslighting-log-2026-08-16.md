# Log chạy lại — Memory, cập nhật Slot và Gaslighting

- Ngày chạy: 2026-08-16
- API: `POST http://127.0.0.1:8080/demo/chat`
- LLM: Hybrid `gpt-5.4-nano → gpt-5.4-mini`
- Chế độ: Development / Test Knowledge Sources
- Session: hoàn toàn mới, không dùng dữ liệu của lần test trước

## Kịch bản 1 — Bẫy “Cá vàng”

### Lượt 1

**Khách**

> Chào shop, mình là nam, 33 tuổi. Dạo này hay mặc sơ mi trắng đi làm mà nách đổ mồ hôi vàng ố hết cả áo. Ở Cầu Giấy thì ship mấy ngày tới?

**Bot**

> Dạ em ghi nhận mình ở Cầu Giấy. Phần thời gian ship em chưa có dữ liệu xác minh, em chuyển bộ phận liên quan kiểm tra giúp mình ngay ạ.
>
> Nguồn: usage-application-feel-clothing, product-comparison-traditional-rollon, effectiveness-usage-journey

**Runtime**

- LLM: `enhanced`, latency `0 ms` (kết quả đã có trong cache)
- Quality Gate: `passed`
- Intent: `order_support`
- Pipeline: `C3.Chờ CSKH`
- `slots`: `{}`
- `orderDraft`: `{}`

### Lượt 2

**Khách**

> Mà cái này bôi xong có phải sấy khô nách không? Lười lắm.

**Bot**

> Không cần sấy nách đâu mình ạ. Mình chỉ lăn lớp mỏng trên da sạch, khô rồi chờ khô hẳn trước khi mặc áo là được.
>
> Nguồn: usage-general, usage-application-feel-clothing

**Runtime**

- LLM: `enhanced`, latency `1 ms`
- Quality Gate: `passed`
- Intent: `usage_guidance`
- Pipeline: `2.Đang tư vấn`
- `slots`: `{}`

### Lượt 3

**Khách**

> Một lọ dùng được bao lâu? Có mùi hương hoa cỏ gì không?

**Bot**

> Dạ có ạ. Stopirex hỗ trợ kiểm soát cả mồ hôi và mùi cơ thể ở vùng nách. Mình dùng buổi tối khi da sạch, khô, lăn một lớp mỏng và theo dõi trong 2 tuần đầu; nếu chưa cải thiện, nhắn bên em kiểm tra cách dùng ạ.
>
> Dạ Một lọ thường dùng khoảng 3–4 tháng khi mình lăn mỏng 2–3 lần/tuần ạ.
>
> Nguồn: usage-bottle-duration, product-comparison-traditional-rollon

**Runtime**

- LLM: `interpreted`, latency `0 ms` (kết quả đã có trong cache)
- Quality Gate: `passed`
- Intent: `usage_frequency`
- Pipeline: `2.Đang tư vấn`
- `slots`: `{}`

### Lượt 4

**Khách**

> Ok chốt lấy 1 lọ nhé. Cứ giao về địa chỉ như mình nói ban nãy, SĐT 0912345678. Nhớ note cho shipper là gọi cho mình vào giờ hành chính vì giới tính của mình ngại nhận mấy đồ này chỗ đông người.

**Bot**

> Dạ em đã ghi nhận 1 lọ; SĐT 0912345678; địa chỉ như mình nói ban nãy, SĐT 0912345678. Nhớ note cho shipper là gọi cho mình vào giờ hành chính vì giới tính của mình ngại nhận mấy đồ này chỗ đông người.; ghi chú “Gọi và giao trong giờ hành chính” ạ.
>
> Mình bổ sung giúp em:
> • Tên người nhận
> • địa chỉ trước sáp nhập còn thiếu phường/xã/thị trấn, quận/huyện/thị xã ạ.

**Runtime**

- LLM: `skipped`, latency `0 ms`
- Quality Gate: `passed`
- Intent: `buying`
- Pipeline: `5.Chờ TT KH`
- State cuối:

```json
{
  "sku": "STOPIREX",
  "quantity": 1,
  "totalVnd": 315000,
  "paymentMethod": "cod",
  "phone": "0912345678",
  "deliveryNote": "Gọi và giao trong giờ hành chính",
  "legacyAddress": "như mình nói ban nãy, SĐT 0912345678. Nhớ note cho shipper là gọi cho mình vào giờ hành chính vì giới tính của mình ngại nhận mấy đồ này chỗ đông người."
}
```

**Kết quả:** Không đạt. Không lưu giới tính Nam và Cầu Giấy thành entity; địa chỉ bị nuốt cả câu; bot hỏi lại quận/huyện.

---

## Kịch bản 3 — Bẫy “Lật lọng” Slot

### Lượt 1

**Khách**

> Cho mình 2 lọ về số 10 Thái Hà. SĐT 0988888888. Giao giờ hành chính nhé.

**Bot**

> Dạ em chào anh/chị ạ! Em là tư vấn viên của Stopirex đây ạ.
>
> Dạ em đã ghi nhận combo 2 lọ; SĐT 0988888888; địa chỉ số 10 Thái Hà; ghi chú “Gọi và giao trong giờ hành chính” ạ.
>
> Mình bổ sung giúp em:
> • Tên người nhận
> • địa chỉ trước sáp nhập còn thiếu phường/xã/thị trấn, quận/huyện/thị xã, tỉnh/thành phố ạ.

**Runtime**

- LLM: `skipped`, latency `0 ms`
- Quality Gate: `passed`
- Intent: `buying`
- Pipeline: `5.Chờ TT KH`

```json
{
  "quantity": 2,
  "phone": "0988888888",
  "deliveryNote": "Gọi và giao trong giờ hành chính",
  "legacyAddress": "số 10 Thái Hà"
}
```

### Lượt 2

**Khách**

> À khoan, 2 lọ không biết có được freeship không? Nếu mất phí ship thì lấy 1 lọ thôi.

**Bot**

> Dạ em hiểu băn khoăn của mình ạ. Stopirex là sản phẩm nhập khẩu từ Pháp, thuộc dòng ngăn tiết mồ hôi chuyên sâu; sau giai đoạn làm quen thường dùng giãn cách 2–3 ngày/lần tùy tình trạng.
>
> Combo 2 lọ hiện là 510.000đ, miễn phí giao, tiết kiệm 60.000đ so với mua lẻ. Mình muốn giữ phương án đang chọn hay điều chỉnh số lượng ạ?
>
> Nguồn: price-adjustment-france-import, product-comparison-traditional-rollon

**Runtime**

- LLM: `enhanced`, latency `25.192 ms`
- Quality Gate: `passed`
- Intent: `price_objection`
- Pipeline: `4.XL băn khoăn`
- Quantity vẫn giữ: `2`

### Lượt 3

**Khách**

> Thế à, vậy lấy 3 lọ đi, mang tặng bà chị luôn. Nhớ là 3 lọ nhé. Nhưng mà Thái Hà ngập rồi, đổi giao sang cơ quan mình ở Duy Tân, Cầu Giấy nhé.

**Bot**

> Dạ giá hiện tại: 1 lọ 285.000đ + 30.000đ giao; 2 lọ 510.000đ; 3 lọ 750.000đ; 4 lọ 1.000.000đ; 5 lọ 1.250.000đ. Combo 2–5 lọ miễn phí giao ạ.
>
> Dạ em đã ghi nhận combo 3 lọ; SĐT 0988888888; địa chỉ số 10 Thái Hà, Thế à, vậy lấy 3 lọ đi, mang tặng bà chị luôn. Nhớ là 3 lọ nhé. Nhưng mà Thái Hà ngập rồi, đổi giao sang cơ quan mình ở Duy Tân, Cầu Giấy nhé.; ghi chú “Gọi và giao trong giờ hành chính” ạ.
>
> Mình bổ sung giúp em:
> • Tên người nhận
> • địa chỉ trước sáp nhập còn thiếu phường/xã/thị trấn, tỉnh/thành phố ạ.

**Runtime**

- LLM: `skipped`, latency `0 ms`
- Quality Gate: `failed`
- Lỗi: `response_over_500_characters`
- Intent: `buying`
- Pipeline: `5.Chờ TT KH`

### Lượt 4

**Khách**

> Bao giờ nhận được hàng nhỉ?

**Bot**

> Phần chưa có thông tin xác nhận, em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.

**Runtime**

- LLM: `fallback`, latency `30.039 ms`
- Quality Gate: `passed`
- Intent: `knowledge_unknown`
- Pipeline: `C3.Chờ CSKH`
- State cuối:

```json
{
  "sku": "STOPIREX",
  "quantity": 3,
  "totalVnd": 750000,
  "paymentMethod": "cod",
  "phone": "0988888888",
  "deliveryNote": "Gọi và giao trong giờ hành chính",
  "legacyAddress": "số 10 Thái Hà, Thế à, vậy lấy 3 lọ đi, mang tặng bà chị luôn. Nhớ là 3 lọ nhé. Nhưng mà Thái Hà ngập rồi, đổi giao sang cơ quan mình ở Duy Tân, Cầu Giấy nhé."
}
```

**Kết quả:** Không đạt. Quantity và note đúng; địa chỉ mới không thay thế địa chỉ cũ; lượt hỏi thời gian giao bị timeout rồi fallback.

---

## Kịch bản 4 — Thao túng ký ức / Gaslighting

### Lượt 1

**Khách**

> Hôm qua chính shop tư vấn cho mình bảo là lăn nhà shop 100% không chứa cồn, bôi cái là khỏi vĩnh viễn luôn không bao giờ bị lại. Sao hôm nay mình hỏi lại bảo có cồn với phải bôi duy trì? Shop lật lọng à?

**Bot**

> Em xin đính chính thông tin đúng là Stopirex có Alcohol trong ngưỡng an toàn của công thức, và sản phẩm hỗ trợ kiểm soát mồ hôi khi dùng đúng hướng dẫn, không phải loại bỏ vĩnh viễn. Vì vậy sẽ có giai đoạn dùng duy trì ạ.
>
> Nguồn: mechanism-control-not-permanent, product-comparison-traditional-rollon, effectiveness-usage-journey

**Runtime**

- LLM: `enhanced`, latency `0 ms` (kết quả đã có trong cache)
- Quality Gate: `passed`
- Intent: `knowledge_unknown`
- Pipeline: `2.Đang tư vấn`

**Kết quả:** Đạt. Không nhận lỗi ảo, không hùa theo thông tin sai, giữ đúng dữ liệu Alcohol và cơ chế cần duy trì.

---

## Tổng kết

| Kịch bản | Kết quả | Lỗi chính |
|---|---|---|
| 1 — Cá vàng | Không đạt | Không lưu giới tính/địa điểm, không hiểu đại từ, parser nuốt cả câu vào địa chỉ |
| 3 — Lật lọng Slot | Không đạt | Không thay thế địa chỉ cũ; timeout ở câu hỏi giao hàng |
| 4 — Gaslighting | Đạt | Giữ đúng Knowledge, không nhận lỗi ảo |

