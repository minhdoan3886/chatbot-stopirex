import type { KnowledgeEntity } from "./knowledge.js";
import type { TenantId } from "./types.js";

export function stopirexApprovedKnowledge(tenantId: TenantId): readonly KnowledgeEntity[] {
  return [
    {
      id: "price-adjustment-france-import",
      tenantId,
      type: "price",
      title: "Lý do điều chỉnh giá từ 245.000đ lên 285.000đ",
      content:
        "Do chi phí nhập khẩu sản phẩm từ Pháp tăng, bên em đã điều chỉnh giá bán để phù hợp với chi phí đầu vào.",
      sourceRow: 1,
    },
    {
      id: "audience-sensitive-skin",
      tenantId,
      type: "policy",
      title: "Đối tượng sử dụng: da nhạy cảm",
      content:
        "Stopirex có công thức dịu nhẹ, phù hợp với làn da nhạy cảm khi sử dụng đúng hướng dẫn nên khách có thể yên tâm hơn. Chỉ dùng khi da đang lành, sạch và khô hoàn toàn; lăn một lớp mỏng. Cách dùng đúng giúp hạn chế nguy cơ khó chịu. Theo dõi trong 2 tuần đầu; nếu da khó chịu thì tạm ngưng và liên hệ lại để kiểm tra cách dùng.",
      sourceRow: 2,
    },
    {
      id: "audience-child-under-12",
      tenantId,
      type: "policy",
      title: "Đối tượng sử dụng: trẻ em dưới 12 tuổi",
      content: "Dạ Stopirex không dùng cho trẻ em dưới 12 tuổi ạ.",
      sourceRow: 3,
    },
    {
      id: "audience-child-12-plus",
      tenantId,
      type: "policy",
      title: "Đối tượng sử dụng: trẻ từ đủ 12 tuổi",
      content: "Dạ trẻ từ đủ 12 tuổi có thể sử dụng Stopirex theo đúng hướng dẫn ạ.",
      sourceRow: 4,
    },
    {
      id: "audience-pregnancy",
      tenantId,
      type: "policy",
      title: "Đối tượng sử dụng: phụ nữ mang thai",
      content: "Dạ phụ nữ đang mang thai nên tham khảo ý kiến bác sĩ trước khi sử dụng Stopirex ạ.",
      sourceRow: 5,
    },
    {
      id: "audience-breastfeeding",
      tenantId,
      type: "policy",
      title: "Đối tượng sử dụng: phụ nữ đang cho con bú",
      content: "Dạ phụ nữ đang cho con bú nên tham khảo ý kiến bác sĩ trước khi sử dụng Stopirex ạ.",
      sourceRow: 6,
    },
    {
      id: "usage-child-12-plus",
      tenantId,
      type: "script",
      title: "Cách dùng Stopirex cho trẻ từ đủ 12 tuổi",
      content:
        "Dùng vào buổi tối khi vùng da sạch và khô hoàn toàn. Lăn một lớp mỏng, dùng 2–3 lần/tuần theo hướng dẫn. Không dùng trên da đang trầy xước, rát hoặc ngứa; sau cạo hoặc wax cần chờ ít nhất 24 giờ.",
      sourceRow: 7,
    },
    {
      id: "usage-general",
      tenantId,
      type: "script",
      title: "Cách sử dụng Stopirex đúng hướng dẫn",
      content:
        "Dùng vào buổi tối khi vùng da sạch và khô hoàn toàn. Lăn một lớp mỏng, dùng 2–3 lần/tuần theo hướng dẫn. Không dùng trên da đang trầy xước, rát hoặc ngứa; sau cạo hoặc wax cần chờ ít nhất 24 giờ.",
      sourceRow: 8,
    },
    {
      id: "product-comparison-traditional-rollon",
      tenantId,
      type: "script",
      title: "Stopirex khác gì lăn khử mùi thông thường",
      content:
        "Nhiều loại lăn thông thường được dùng hằng ngày và thiên về khử hoặc dùng hương thơm để che mùi. Stopirex là sản phẩm ngăn tiết mồ hôi chuyên sâu: hỗ trợ kiểm soát lượng mồ hôi tiết ra; khi vùng nách bớt ẩm, vi khuẩn gây mùi có ít điều kiện phát triển hơn. Stopirex không dùng hương thơm để che mùi. Sản phẩm dùng vào buổi tối trên da sạch, khô; sau giai đoạn làm quen thường dùng giãn cách 2–3 ngày/lần tùy tình trạng.",
      sourceRow: 9,
    },
    {
      id: "usage-morning-fragrance-layering",
      tenantId,
      type: "script",
      title: "Buổi sáng dùng thêm nước hoa hoặc lăn khử mùi có hương",
      content:
        "Danh sách thành phần công bố không có Parfum hoặc hương liệu tạo mùi; phiếu kiểm nghiệm mô tả sản phẩm có mùi đặc trưng. Theo nội dung doanh nghiệp duyệt, đây là mùi đặc trưng nhẹ và bay nhanh, không phải hương thơm dùng để che mùi. Stopirex được dùng vào buổi tối. Buổi sáng, sau khi vệ sinh vùng nách như bình thường, khách có thể dùng nước hoa hoặc lăn khử mùi có hương mà không bị trộn với hương của Stopirex. Chỉ dùng trên da sạch, khô, không rát hoặc ngứa; nên ngưng nếu da khó chịu và tránh chồng nhiều sản phẩm trực tiếp lên vùng nách nhạy cảm.",
      sourceRow: 10,
    },
    {
      id: "usage-bottle-duration",
      tenantId,
      type: "script",
      title: "Thời gian sử dụng của một lọ",
      content:
        "Một lọ Stopirex thường dùng được khoảng 3–4 tháng khi lăn một lớp mỏng khoảng 2–3 lần/tuần theo hướng dẫn. Thời gian thực tế có thể chênh lệch tùy lượng dùng mỗi lần.",
      sourceRow: 11,
    },
    {
      id: "usage-exercise-sweat-washoff",
      tenantId,
      type: "script",
      title: "Vận động và lo mồ hôi làm trôi tác dụng",
      content:
        "Stopirex được dùng từ buổi tối trên vùng da sạch, khô; không phải lớp lăn vừa bôi ngay trước khi vận động để mồ hôi làm trôi đi. Chiều hôm sau khách vẫn có thể tập luyện bình thường. Khi vận động rất mạnh, cơ thể vẫn có thể tiết thêm mồ hôi. Không tự thêm câu 'tùy cơ địa' hoặc lời giảm nhẹ hiệu quả nếu khách không hỏi trực tiếp về cam kết tuyệt đối.",
      sourceRow: 12,
    },
    {
      id: "authenticity-before-purchase",
      tenantId,
      type: "policy",
      title: "Xác nhận sản phẩm chính hãng trước khi mua",
      content:
        "Sản phẩm Stopirex bên em cung cấp là hàng chính hãng. Khi nhận hàng, khách nên đối chiếu bao bì, tem, đúng tên sản phẩm và thông tin người gửi; nếu thông tin không khớp, khách có quyền từ chối nhận và liên hệ bên em để kiểm tra. Không dùng cách diễn đạt 'đơn đặt trực tiếp được gửi đúng hàng chính hãng' vì có thể gây hiểu rằng sản phẩm ở kênh khác là hàng giả; không kết luận về hàng từ kênh khác khi chưa kiểm tra.",
      sourceRow: 13,
    },
    {
      id: "safety-irritation-hypothetical",
      tenantId,
      type: "policy",
      title: "Nếu xuất hiện rát, ngứa hoặc đỏ da sau khi dùng",
      content:
        "Nếu sau khi lăn mà vùng da xuất hiện rát, ngứa hoặc đỏ, khách nên tạm ngưng sử dụng và không lăn lại khi da còn khó chịu. Khách cần nhắn lại để được kiểm tra tình trạng cụ thể.",
      sourceRow: 14,
    },
    {
      id: "care-ineffective-refund",
      tenantId,
      type: "policy",
      title: "Không hiệu quả: kiểm tra cách dùng và điều kiện chuyển hoàn tiền",
      content:
        "Nếu khách chưa nói rõ, chỉ hỏi phần còn thiếu: dùng vào thời điểm nào, da đã lau khô hoàn toàn chưa và đã dùng đều bao lâu. Nếu dùng sai, hướng dẫn lại quy trình chuẩn. Nếu khách xác nhận dùng đúng đủ 2 tuần mà vẫn không hiệu quả, thu số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước; đủ hồ sơ thì chuyển bộ phận liên quan xử lý tiếp.",
      sourceRow: 15,
    },
    {
      id: "care-irritation",
      tenantId,
      type: "policy",
      title: "Châm chích: tạm ngưng và xác minh nguyên nhân",
      content:
        "Hướng dẫn khách tạm ngưng sử dụng. Kiểm tra vùng da có tổn thương không, có mới wax/triệt/cạo không và da lúc dùng đã khô hoàn toàn chưa. Nếu tổn thương hoặc mới làm thủ thuật, đợi da lành hẳn mới dùng lại. Nếu da còn ướt, hướng dẫn lau khô hoàn toàn. Nếu đã làm đúng mà vẫn kích ứng kéo dài, chuyển bộ phận liên quan hỗ trợ.",
      sourceRow: 16,
    },
    {
      id: "care-damaged-product",
      tenantId,
      type: "policy",
      title: "Hàng vỡ hoặc hỏng",
      content:
        "Yêu cầu khách cung cấp số điện thoại đặt hàng và ảnh sản phẩm bị vỡ hoặc hỏng. Khi đủ ảnh và số điện thoại thì chuyển bộ phận liên quan xử lý tiếp.",
      sourceRow: 17,
    },
    {
      id: "authenticity-legal-summary",
      tenantId,
      type: "policy",
      title: "Nguồn gốc và hồ sơ pháp lý",
      content:
        "Stopirex có Phiếu công bố sản phẩm mỹ phẩm số 181339/22/CBMP-QLD, ngày tiếp nhận 12/09/2022, giá trị 5 năm kể từ ngày cấp. Hồ sơ ghi sản phẩm được sản xuất, đóng gói và xuất khẩu từ Pháp; đơn vị sản xuất/đóng gói là PREVOST LABORATORY CONCEPT. Sản phẩm có Phiếu kết quả thử nghiệm VNTEST mã DV142210268/01 ngày 17/09/2025. Chỉ nói sản phẩm có hồ sơ công bố và kết quả thử nghiệm; không diễn đạt thành cơ quan nhà nước chứng nhận hiệu quả hoặc bảo đảm tuyệt đối an toàn.",
      sourceRow: 18,
    },
    {
      id: "care-delivery-handoff",
      tenantId,
      type: "policy",
      title: "Sự cố shipper hoặc đơn vị vận chuyển",
      content:
        "Khi shipper không giao, đơn bị hoàn về hoặc đơn vị vận chuyển gặp sự cố, bot chỉ ghi nhận ngắn gọn rồi chuyển bộ phận liên quan kiểm tra và xử lý tiếp.",
      sourceRow: 19,
    },
    {
      id: "returns-eligibility",
      tenantId,
      type: "policy",
      title: "Trường hợp được đổi trả",
      content:
        "Được đổi trả khi sản phẩm còn nguyên seal, chưa sử dụng và lỗi từ nhà sản xuất trong 7 ngày; giao sai hàng trong 7 ngày kể từ ngày nhận; hoặc hàng bể vỡ do vận chuyển trong 48 giờ và có video mở hộp.",
      sourceRow: 20,
    },
    {
      id: "returns-exclusions",
      tenantId,
      type: "policy",
      title: "Trường hợp không được đổi trả",
      content:
        "Không đổi trả khi sản phẩm đã mở seal và đã dùng; khách không hợp mùi hoặc không thích sau khi dùng thử; hoặc sản phẩm bị hư do khách làm rơi vỡ sau khi nhận.",
      sourceRow: 21,
    },
    {
      id: "returns-process-fees-refund",
      tenantId,
      type: "policy",
      title: "Quy trình, phí đổi trả và thời gian hoàn tiền",
      content:
        "Khách liên hệ shop trên kênh đã mua, cung cấp ảnh/video và thông tin đơn hàng; shop xác minh và hướng dẫn hoàn trả. Sau khi nhận hàng, shop gửi hàng mới hoặc hoàn tiền trong 3–5 ngày làm việc. Nếu lỗi từ shop, shop chịu phí hai chiều; nếu đổi loại khác, khách chịu phí một chiều gửi về. Hoàn tiền qua chuyển khoản ngân hàng hoặc ví của sàn.",
      sourceRow: 22,
    },
    {
      id: "refund-used-ineffective",
      tenantId,
      type: "policy",
      title: "Hoàn tiền khi đã dùng đúng nhưng chưa hiệu quả",
      content:
        "Chỉ áp dụng khi khách xác nhận đã dùng đúng hướng dẫn và đủ 2 tuần. Khách cần cung cấp số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước. Đây là quy trình hủy sản phẩm để xử lý hoàn tiền nên khách không cần giữ vỏ hộp, không cần gửi sản phẩm về và không phát sinh bước thu hồi hàng. Khi nhận đủ bộ hồ sơ, chuyển bộ phận liên quan xử lý tiếp.",
      sourceRow: 23,
    },
    {
      id: "usage-application-feel-clothing",
      tenantId,
      type: "script",
      title: "Cảm giác khi lăn và cam kết không bám, ố hoặc làm cứng áo",
      content:
        "Stopirex là roll-on dạng dung dịch nên da có thể hơi ẩm nhẹ ngay sau khi lăn; sản phẩm khô nhanh và không bết khi dùng đúng lượng. Khách cần lăn một lớp mỏng trên da sạch, khô hoàn toàn và chờ sản phẩm khô trước khi mặc áo. Khi sử dụng đúng hướng dẫn, Stopirex không bám, không gây ố vàng nách áo và không làm cứng vải. Nếu khách phản ánh vẫn xảy ra dù đã dùng đúng, ghi nhận, xin ảnh và chuyển bộ phận liên quan kiểm tra; không tranh luận với khách.",
      sourceRow: 24,
    },
    {
      id: "usage-underarm-darkening-prevention",
      tenantId,
      type: "script",
      title: "Dùng đúng hướng dẫn để không gây thâm vùng nách",
      content:
        "Khi sử dụng đúng hướng dẫn, Stopirex không gây thâm nách. Khách cần lăn một lớp mỏng vào buổi tối khi vùng da sạch và khô hoàn toàn; không dùng khi da còn ướt, đang trầy, đỏ, rát hoặc ngay sau cạo, nhổ, wax hay triệt lông. Dùng sai trên vùng da đang ẩm hoặc tổn thương có thể gây khó chịu, vì vậy cần chờ da ổn rồi mới dùng.",
      sourceRow: 51,
    },
    {
      id: "usage-approved-area-underarms-only",
      tenantId,
      type: "policy",
      title: "Vùng sử dụng được hướng dẫn: vùng nách",
      content:
        "Stopirex hiện được hướng dẫn dùng cho vùng da dưới cánh tay. Không tự hướng dẫn khách lăn sản phẩm lên lòng bàn tay hoặc lòng bàn chân. Trường hợp mồ hôi tay hoặc chân cần sản phẩm hay hướng dẫn phù hợp riêng; nếu tình trạng nhiều và ảnh hưởng sinh hoạt, khách nên hỏi bác sĩ da liễu.",
      sourceRow: 52,
    },
    {
      id: "policy-clothing-damage-compensation-review",
      tenantId,
      type: "policy",
      title: "Yêu cầu bồi thường quần áo hoặc tài sản",
      content:
        "Khi dùng đúng hướng dẫn, Stopirex không bám và không gây ố vàng nách áo. Nếu khách hỏi trước về việc bồi thường quần áo hoặc tài sản, bot không tự cam kết một mức bồi thường. Nếu thực tế có phát sinh, ghi nhận ảnh, cách dùng và thông tin đơn rồi chuyển bộ phận liên quan kiểm tra trường hợp cụ thể. Không được biến chính sách hoàn tiền sản phẩm do chưa hiệu quả thành cam kết bồi thường tài sản.",
      sourceRow: 53,
    },
    {
      id: "pricing-approved-options-2026-08",
      tenantId,
      type: "price",
      title: "Giá và phương án mua đã duyệt",
      content:
        "Giá Facebook đã duyệt: 1 lọ 285.000đ và phí giao 30.000đ; combo 2 lọ 510.000đ, combo 3 lọ 750.000đ, combo 4 lọ 1.000.000đ, combo 5 lọ 1.250.000đ. Khi khách hỏi giá chung, chỉ báo phương án 1, 2, 3 lọ và quà tặng; giá combo 4 hoặc 5 lọ chỉ trả lời khi khách hỏi đúng số lượng đó. Combo 2–5 lọ miễn phí giao. Mọi đơn từ 2 lọ trở lên được tặng đúng 1 túi đa năng vải dệt Stopirex; quà tính theo đơn hàng, không tính theo số lọ và không cộng nhiều túi khi mua nhiều lọ. Đơn 1 lọ được duyệt miễn phí giao khi khách mặc cả hoặc từ lúc hệ thống bắt đầu gửi follow-up. Chỉ nhắc việc chuyển tư vấn viên cho nhu cầu từ 6 lọ trở lên khi khách thực sự hỏi số lượng này; bot không tự chốt đơn.",
      sourceRow: 25,
    },
    {
      id: "promotion-multiuse-bag-from-two",
      tenantId,
      type: "policy",
      title: "Quà tặng túi đa năng cho đơn từ 2 lọ",
      content:
        "Đơn hàng mua từ 2 lọ Stopirex trở lên được tặng 1 túi đa năng vải dệt Stopirex. Mỗi đơn hàng chỉ tặng 1 túi, không phải mỗi lọ một túi; mua 2, 3, 4 hoặc 5 lọ đều nhận đúng 1 túi. Đơn 1 lọ không áp dụng quà tặng này. Từ 6 lọ trở lên chuyển tư vấn viên hỗ trợ riêng nhưng bot không được tự tăng số túi quà.",
      sourceRow: 54,
    },
    {
      id: "safety-known-aluminum-salt-allergy",
      tenantId,
      type: "policy",
      title: "Khách đã biết mình dị ứng muối nhôm",
      content:
        "Nếu khách nói rõ đã được xác định hoặc từng dị ứng với muối nhôm, không khuyên khách tự dùng thử và không tiếp tục chốt đơn. Tư vấn ngắn gọn: khách chưa nên dùng Stopirex; chuyển bộ phận liên quan kiểm tra đúng bảng thành phần/hoạt chất của phiên bản sản phẩm và khuyên khách hỏi bác sĩ hoặc chuyên gia da liễu trước khi sử dụng. Không tự kết luận Stopirex có hoặc không có chất gây dị ứng nếu chưa đối chiếu nhãn thành phần đã duyệt.",
      sourceRow: 26,
    },
    {
      id: "care-suspected-allergic-reaction",
      tenantId,
      type: "policy",
      title: "Nghi phản ứng dị ứng sau khi dùng",
      content:
        "Nếu khách xuất hiện ngứa, đỏ, phát ban, nổi mề đay, sưng hoặc khó chịu bất thường sau khi dùng: hướng dẫn ngưng sản phẩm ngay, không lăn lại và liên hệ nhân viên để ghi nhận sản phẩm, thời điểm dùng, lượng dùng, triệu chứng và ảnh vùng da nếu phù hợp. Khuyên khách liên hệ bác sĩ để được đánh giá. Nếu có khó thở, khò khè, choáng, khó nuốt hoặc sưng môi/mặt/lưỡi thì cần đi cấp cứu ngay. Bot không tự chẩn đoán nguyên nhân và không khuyên khách thử lại sản phẩm.",
      sourceRow: 27,
    },
    {
      id: "usage-morning-wash-with-soap",
      tenantId,
      type: "script",
      title: "Tắm lại bằng xà phòng vào sáng hôm sau",
      content:
        "Stopirex được dùng vào buổi tối trên vùng da sạch và khô để hoạt chất có thời gian phát huy trong đêm. Sáng hôm sau khách có thể tắm, vệ sinh vùng nách bằng xà phòng như bình thường; việc này không làm mất tác dụng của lần dùng tối hôm trước. Không hướng dẫn khách bôi bù vào buổi sáng.",
      sourceRow: 28,
    },
    {
      id: "usage-timing-missed-evening-application",
      tenantId,
      type: "script",
      title: "Quên dùng buổi tối và không bôi bù buổi sáng",
      content:
        "Stopirex nên dùng buổi tối trên vùng da sạch, khô hoàn toàn để hoạt chất có thời gian phát huy khi tuyến mồ hôi hoạt động ít hơn. Nếu quên một tối, khách không cần bôi bù vào sáng hôm sau; bôi buổi sáng thường kém hiệu quả hơn do cơ thể bắt đầu vận động và tiết mồ hôi. Tiếp tục sử dụng vào buổi tối kế tiếp theo đúng tần suất.",
      sourceRow: 49,
    },
    {
      id: "policy-vat-invoice-handoff",
      tenantId,
      type: "policy",
      title: "Yêu cầu hóa đơn VAT điện tử",
      content:
        "Việc xuất hóa đơn VAT điện tử là nghiệp vụ cần bộ phận liên quan kiểm tra theo thông tin công ty và đơn hàng cụ thể. Bot không tự xác nhận có hoặc không xuất được hóa đơn; ghi nhận ngắn gọn và chuyển bộ phận liên quan hỗ trợ trực tiếp.",
      sourceRow: 29,
    },
    {
      id: "product-official-version-and-false-ingredients",
      tenantId,
      type: "policy",
      title: "Bác bỏ thông tin phiên bản nắp vàng, nọc rắn và 50% muối nhôm",
      content:
        "Thông tin Stopirex có phiên bản nắp vàng chứa nọc rắn hoặc 50% muối nhôm không thuộc thông tin sản phẩm chính thức đã được duyệt. Bot cần đính chính nhẹ nhàng rằng bên em không có thông tin sản phẩm như vậy, không tranh cãi với khách và không tự tạo thêm tỷ lệ thành phần. Stopirex là hàng nhập khẩu chính ngạch, có hồ sơ công bố và kết quả thử nghiệm. Không tự đưa kết luận, số liệu hoặc trích dẫn y khoa về ung thư vú; nếu khách cần đánh giá nguy cơ cá nhân thì hướng dẫn hỏi bác sĩ hoặc chuyên gia da liễu.",
      sourceRow: 30,
    },
    {
      id: "mechanism-control-not-permanent",
      tenantId,
      type: "script",
      title: "Cơ chế kiểm soát mồ hôi và phạm vi tác động",
      content:
        "Stopirex là dược mỹ phẩm dùng ngoài da, hỗ trợ ức chế và giảm lượng mồ hôi tiết ra; sản phẩm không can thiệp loại bỏ tuyến mồ hôi như phẫu thuật hoặc thủ thuật y khoa. Vì sản phẩm được dùng duy trì để kiểm soát mồ hôi nên khái niệm tỷ lệ tái phát sau 1 năm không áp dụng; bot trả lời rõ điều này, không tự tạo phần trăm và không chuyển nhân viên chỉ để kiểm tra một tỷ lệ không phù hợp với cơ chế sản phẩm.",
      sourceRow: 31,
    },
    {
      id: "catalog-no-underarm-darkening-soap",
      tenantId,
      type: "policy",
      title: "Danh mục hiện không có xà phòng trị thâm nách",
      content:
        "Hiện tại gian hàng Stopirex chưa bán xà phòng trị thâm nách. Bot trả lời ngắn gọn đúng danh mục và không tự gợi ý hoặc hứa bán kèm sản phẩm ngoài hệ thống.",
      sourceRow: 32,
    },
    {
      id: "shelf-life-and-after-opening",
      tenantId,
      type: "policy",
      title: "Hạn sử dụng và thời gian sau khi mở nắp",
      content:
        "Hạn 3 năm in trên bao bì là hạn sử dụng của sản phẩm khi còn nguyên và được bảo quản đúng điều kiện. Sau khi mở nắp, khách phải ưu tiên ký hiệu hoặc hướng dẫn sau mở nắp trên chính bao bì của lô sản phẩm; hệ thống hiện chưa có mốc tháng sau mở nắp đã được duyệt nên bot không tự nói 6 hoặc 12 tháng. Đậy kín nắp, để nơi khô ráo, thoáng mát và không để chai lâu trong khu vực nhà tắm ẩm ướt. Nếu khách cần mốc chính xác, chuyển bộ phận liên quan kiểm tra nhãn của lô hàng.",
      sourceRow: 33,
    },
    {
      id: "wholesale-dealer-handoff",
      tenantId,
      type: "policy",
      title: "Khách nhập sỉ hoặc đại lý",
      content:
        "Khi khách là nhà thuốc, cửa hàng hoặc muốn nhập từ 6 lọ trở lên để bán lại, ghi nhận đây là nhu cầu sỉ/đại lý và chuyển bộ phận liên quan hỗ trợ. Bot không tự báo phần trăm chiết khấu và không hứa cấp tủ kệ, banner hoặc vật phẩm marketing nếu chưa có phương án được bộ phận liên quan xác nhận.",
      sourceRow: 34,
    },
    {
      id: "product-composition-tolerance-approved",
      tenantId,
      type: "product",
      title: "Thành phần và độ dịu nhẹ đã được duyệt",
      content:
        "Danh sách thành phần công bố của Stopirex có Alcohol, cùng Aluminium Sesquichlorohydrate, Glycerin, Allantoin và Bisabolol. Tài liệu đào tạo ghi Alcohol và Aqua đóng vai trò dung môi trong công thức; theo nội dung doanh nghiệp duyệt, Alcohol được dùng trong ngưỡng an toàn của công thức. Tuyệt đối không tư vấn rằng sản phẩm không cồn và không tự tạo tỷ lệ phần trăm cụ thể vì hồ sơ hiện có không công bố nồng độ. Phiếu thử nghiệm VNTEST DV142210268/01 ghi mức kích ứng da của mẫu thử là 'không đáng kể' theo ISO 10993-23:2021; đây không phải cam kết mọi người đều không kích ứng. Khi khách từng bị rát hoặc ngứa với sản phẩm khác, không chê đối thủ; chỉ ghi nhận đúng triệu chứng khách nêu, không tự đổi 'ngứa, đỏ' thành 'viêm' hoặc 'không hiệu quả'. Hướng dẫn chỉ dùng trên da lành, sạch, khô hoàn toàn và lăn một lớp mỏng. Nếu da đang đỏ hoặc rát thì chờ da ổn hẳn mới dùng.",
      sourceRow: 35,
    },
    {
      id: "catalog-single-standard-sku",
      tenantId,
      type: "product",
      title: "Danh mục hiện có một quy cách Stopirex chuẩn",
      content:
        "Danh mục bán hàng hiện tại chỉ có một SKU Stopirex với quy cách chai 30 ml; hệ thống chưa có size lớn hoặc size nhỏ khác để lựa chọn. Một lọ thường dùng khoảng 3–4 tháng khi lăn mỏng khoảng 2–3 lần mỗi tuần theo hướng dẫn. Thời gian có thể chênh lệch theo lượng dùng mỗi lần.",
      sourceRow: 36,
    },
    {
      id: "international-shipping-compensation-handoff",
      tenantId,
      type: "policy",
      title: "Vận chuyển quốc tế và yêu cầu bồi thường ngoài chính sách",
      content:
        "Phí gửi Stopirex ra nước ngoài, khả năng giao đến từng quốc gia và điều kiện bồi thường quốc tế chưa có chính sách cố định trong hệ thống. Bot được ghi nhận số lượng và điểm đến nhưng không tự báo phí, không cam kết hộp không móp và không chấp nhận yêu cầu đền gấp đôi. Chuyển nhân viên vận hành kiểm tra phương án trước; chưa tiếp tục thu thông tin đơn khi các điều kiện này chưa được xác nhận.",
      sourceRow: 37,
    },
    {
      id: "competitor-neutral-advice",
      tenantId,
      type: "policy",
      title: "Tư vấn trung lập khi khách nhắc sản phẩm đối thủ",
      content:
        "Khi khách nhắc Etiaxil, Perspirex hoặc sản phẩm cạnh tranh, không chê bai, suy đoán thành phần hoặc quy kết sản phẩm đó gây hại. Ghi nhận trải nghiệm của khách rồi chỉ giải thích dữ kiện Stopirex đã được duyệt, giữ giọng điềm tĩnh và chuyên nghiệp.",
      sourceRow: 38,
    },
    {
      id: "regulatory-product-notification-2022",
      tenantId,
      type: "product",
      title: "Phiếu công bố mỹ phẩm và nguồn gốc sản phẩm",
      content:
        "Phiếu công bố sản phẩm mỹ phẩm số 181339/22/CBMP-QLD được tiếp nhận ngày 12/09/2022 và ghi giá trị 5 năm kể từ ngày cấp. Tên sản phẩm là STOPIREX Détranspirant intensif peaux sensibles; nhóm sản phẩm là khử mùi và chống mùi. Mục đích sử dụng được công bố: giúp khử mùi và ngăn ngừa mùi mồ hôi cơ thể. Sản phẩm do PREVOST LABORATORY CONCEPT sản xuất và đóng gói tại Pháp, xuất khẩu từ Pháp. Phiếu công bố không phải chứng nhận hiệu quả điều trị và không được dùng để nói Stopirex là thuốc.",
      sourceRow: 39,
    },
    {
      id: "product-official-ingredient-list-2022",
      tenantId,
      type: "product",
      title: "Danh sách thành phần INCI theo Phiếu công bố",
      content:
        "Danh sách thành phần đầy đủ trong Phiếu công bố: Aqua, Alcohol, Aluminium Sesquichlorohydrate, PEG-12 Dimethicone, Glycerin, Hydroxyethylcellulose, Allantoin và Bisabolol. Hồ sơ không công bố tỷ lệ phần trăm cụ thể, nên bot không tự tạo nồng độ hoặc nói 50% muối nhôm. Danh sách có Alcohol và không có Parfum; phải phân biệt 'không dùng hương liệu để che mùi' với tuyên bố sai 'không cồn' hoặc 'hoàn toàn không có mùi'.",
      sourceRow: 40,
    },
    {
      id: "lab-test-2025-physical-chemical",
      tenantId,
      type: "product",
      title: "Kết quả thử nghiệm lý hóa và chất cần kiểm soát năm 2025",
      content:
        "Phiếu VNTEST mã DV142210268/01, trả kết quả ngày 17/09/2025, áp dụng cho mẫu Stopirex 30 ml được gửi thử. Kết quả: pH dung dịch 1% là 4,5; mẫu là gel trong suốt, không màu, có mùi đặc trưng. Không phát hiện Asen ở LOD 0,05 mg/kg, Thủy ngân ở LOD 0,2 mg/kg và Chì ở LOD 0,1 mg/kg. Hydroquinone âm tính ở LOD 1,5 mg/kg. Methylparaben, Benzylparaben, Propylparaben, Phenylparaben, Ethylparaben, Butylparaben, Isobutylparaben, Isopropylparaben và Pentylparaben đều âm tính ở LOD 20 mg/kg. Chỉ nói đúng phạm vi mẫu và giới hạn phát hiện; không suy rộng thành 'không có mọi chất độc' hoặc 'an toàn tuyệt đối'.",
      sourceRow: 41,
    },
    {
      id: "lab-test-2025-skin-irritation",
      tenantId,
      type: "product",
      title: "Kết quả thử nghiệm độ kích ứng da năm 2025",
      content:
        "Trên mẫu thử Stopirex trong Phiếu VNTEST DV142210268/01, chỉ tiêu độ kích ứng da cho kết quả 'không đáng kể' theo ISO 10993-23:2021. Khi tư vấn phải dùng đúng cụm này hoặc diễn đạt 'mẫu thử có mức kích ứng không đáng kể'; không đổi thành 'không kích ứng', 'không gây dị ứng', 'an toàn 100%' hoặc bảo đảm cho mọi cơ địa.",
      sourceRow: 42,
    },
    {
      id: "lab-test-2025-microbiology",
      tenantId,
      type: "product",
      title: "Kết quả thử nghiệm vi sinh năm 2025",
      content:
        "Phiếu VNTEST DV142210268/01 ghi không phát hiện tổng số vi sinh vật hiếu khí và tổng số nấm men - nấm mốc ở LOD 10 CFU/g; không phát hiện Pseudomonas aeruginosa, Staphylococcus aureus và Candida albicans trong 0,1 g mẫu. Kết quả chỉ có giá trị với mẫu được thử; không diễn đạt thành bảo đảm mọi lô sản phẩm vô trùng.",
      sourceRow: 43,
    },
    {
      id: "product-training-ingredient-roles",
      tenantId,
      type: "product",
      title: "Vai trò thành phần theo tài liệu đào tạo sản phẩm",
      content:
        "Theo tài liệu đào tạo Stopirex 2024: Aluminium Sesquichlorohydrate là hoạt chất ngăn tiết mồ hôi; Glycerin và Allantoin hỗ trợ giữ ẩm, làm dịu; Bisabolol là thành phần liên quan tinh dầu hoa cúc Đức và hỗ trợ làm dịu; PEG-12 Dimethicone giúp kết cấu mịn, dễ bôi; Hydroxyethylcellulose tạo độ đặc; Alcohol và Aqua đóng vai trò dung môi trong công thức. Chỉ dùng để giải thích thành phần, không biến các vai trò này thành cam kết điều trị, chống dị ứng hoặc phục hồi tổn thương tuyệt đối.",
      sourceRow: 44,
    },
    {
      id: "product-training-72h-conditional-claim",
      tenantId,
      type: "script",
      title: "Kết quả thử nghiệm hiệu quả đến 72 giờ và cách tư vấn",
      content:
        "Mốc đến 72 giờ là kết quả thử nghiệm hiệu quả của Stopirex trên nhóm mẫu thử khi sử dụng đúng hướng dẫn; tài liệu hiện có chưa nêu cỡ mẫu nên bot không tự thêm số người hoặc tỷ lệ phần trăm. Khi tư vấn có thể nói: 'Theo thử nghiệm sản phẩm, Stopirex hỗ trợ kiểm soát mồ hôi đến 72 giờ khi dùng đúng hướng dẫn. Thời gian duy trì thực tế có thể khác theo mức tiết mồ hôi, cường độ vận động, môi trường và cách sử dụng.' Không nói mọi khách chắc chắn khô tuyệt đối đủ 72 giờ, không rút gọn thành câu thoái thác chung chung 'tùy cơ địa', và không dùng mốc này thay thế quy trình xử lý khiếu nại. Khi khách hỏi 'bao lâu thấy hiệu quả', phải truy xuất cùng knowledge effectiveness-usage-journey để trả đủ lộ trình, không chỉ ném ra mốc 72 giờ.",
      sourceRow: 45,
    },
    {
      id: "effectiveness-usage-journey",
      tenantId,
      type: "script",
      title: "Lộ trình bắt đầu, thời gian duy trì và tần suất sử dụng",
      content:
        "Khi dùng đúng hướng dẫn, khách có thể bắt đầu cảm nhận vùng nách khô thoáng hơn trong tuần đầu. Mốc hỗ trợ kiểm soát đến 72 giờ là kết quả thử nghiệm trên nhóm mẫu cho mỗi lần dùng đúng hướng dẫn, không phải cam kết mọi người khô tuyệt đối đủ 72 giờ. Giai đoạn đầu dùng buổi tối trên da sạch, khô hoàn toàn, lăn mỏng 2–3 lần/tuần; khi tình trạng ổn định thì duy trì giãn cách khoảng 2–3 ngày/lần theo hướng dẫn. Sản phẩm hỗ trợ kiểm soát mồ hôi trong quá trình duy trì, không phải phương pháp loại bỏ tuyến mồ hôi và không có cam kết khỏi vĩnh viễn. Khi trả lời câu hỏi về 'bao lâu/hiệu quả', phải nêu đủ phần bắt đầu cảm nhận, mốc thử nghiệm 72 giờ có điều kiện và tần suất duy trì liên quan; không chỉ trả một con số rời rạc.",
      sourceRow: 46,
    },
    {
      id: "domestic-delivery-inspection-policy",
      tenantId,
      type: "policy",
      title: "Giao hàng nội địa, thời gian nhận và kiểm tra hàng",
      content:
        "Khu vực Hà Nội thường nhận hàng trong khoảng 1–2 ngày làm việc. Đây là mốc vận hành tiêu chuẩn, thời tiết hoặc vận hành thực tế có thể làm chậm hơn; thời gian chính xác được theo dõi theo vận đơn sau khi lên đơn. Các tỉnh/thành khác chưa có bảng ETA cố định nên bot không tự hứa số ngày. Khi nhận hàng, khách được kiểm tra bao bì ngoài, tem, đúng sản phẩm Stopirex và thông tin người gửi; không mở seal hoặc tem niêm phong của chính sản phẩm trước khi xác nhận nhận hàng. Nếu khách hỏi đồng thời ETA và kiểm hàng, trả lời đủ cả hai ý; không fallback sang bảng giá.",
      sourceRow: 47,
    },
    {
      id: "business-approved-alcohol-odor-guidance-2026-08",
      tenantId,
      type: "script",
      title: "Cách tư vấn Alcohol và mùi được doanh nghiệp phê duyệt",
      content:
        "Nội dung được doanh nghiệp phê duyệt ngày 14/08/2026: Stopirex có Alcohol, dùng làm dung môi trong ngưỡng an toàn của công thức; không được nói sản phẩm không cồn. Sản phẩm có mùi đặc trưng nhẹ và bay nhanh, không phải hương thơm dùng để che mùi; không được nói hoàn toàn không mùi. Không tự nêu phần trăm Alcohol vì hồ sơ hiện có không công bố nồng độ cụ thể.",
      sourceRow: 48,
    },
    {
      id: "usage-after-hair-removal",
      tenantId,
      type: "script",
      title: "Dùng Stopirex sau nhổ, cạo, wax hoặc triệt lông",
      content:
        "Không dùng Stopirex ngay sau khi nhổ, cạo, wax hoặc triệt lông vùng nách. Chờ 24–48 giờ và chỉ dùng lại khi da đã ổn, không còn trầy, đỏ hoặc rát. Stopirex dùng vào buổi tối trên da sạch, khô hoàn toàn và lăn một lớp mỏng. Khi dùng đúng hướng dẫn, sản phẩm khô nhanh, không bết dính và không gây ố vàng nách áo.",
      sourceRow: 49,
    },
    {
      id: "promotion-current-no-gift",
      tenantId,
      type: "policy",
      title: "Chương trình hiện hành không kèm quà sữa tắm",
      content:
        "Chương trình bán lẻ hiện hành không có quà tặng sữa tắm. Quà đang áp dụng là 1 túi đa năng vải dệt Stopirex cho mỗi đơn từ 2 lọ trở lên; mỗi đơn chỉ nhận đúng 1 túi. Ưu đãi đã duyệt gồm: 1 lọ 285.000đ cộng 30.000đ phí giao; 2 lọ 510.000đ miễn phí giao; 3 lọ 750.000đ miễn phí giao; 4 lọ 1.000.000đ miễn phí giao; 5 lọ 1.250.000đ miễn phí giao. Không nhận lỗi hoặc xác nhận một quà tặng cũ chỉ từ lời kể của khách; chỉ nói chính sách hiện đang áp dụng.",
      sourceRow: 50,
    },
    {
      id: "household-shared-use",
      tenantId,
      type: "script",
      title: "Người thân dùng chung Stopirex",
      content:
        "Người trưởng thành trong gia đình có thể dùng cùng sản phẩm Stopirex, không cần mua một biến thể riêng theo giới tính hoặc theo việc chỉ có mùi nhẹ. Sản phẩm hỗ trợ kiểm soát cả mồ hôi và mùi. Mỗi người dùng lớp mỏng vào buổi tối trên da sạch, khô hoàn toàn; không dùng khi da đang trầy, đỏ hoặc rát.",
      sourceRow: 51,
    },
  ];
}
