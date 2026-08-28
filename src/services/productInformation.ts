import { createDemoProductCatalog, demoCommerceEffectiveAt } from "../config/demoCommerce.js";
import { defaultBlockedClaims } from "../domain/claims.js";
import {
  careQuestions,
  createCareCase,
  negativeReviewSteps,
  type IssueType,
} from "../domain/customerCare.js";
import { stopirexApprovedKnowledge } from "../domain/stopirexKnowledge.js";
import type { TenantId } from "../domain/types.js";

export function buildProductInformationSnapshot(tenantId: TenantId) {
  const catalog = createDemoProductCatalog(tenantId);
  const knowledge = stopirexApprovedKnowledge(tenantId);
  const offers = ([1, 2, 3, 4, 5] as const).map((quantity) =>
    catalog.quote({
      tenantId,
      channel: "facebook",
      sku: "STOPIREX",
      quantity,
      at: demoCommerceEffectiveAt,
    }),
  );
  const now = new Date("2026-01-01T00:00:00.000Z");
  const careDefinitions: ReadonlyArray<{
    issue: IssueType;
    title: string;
    handling: string;
    evidence: string;
  }> = [
    {
      issue: "irritation",
      title: "Kích ứng, ngứa hoặc rát",
      handling:
        "Tạm ngưng trước; kiểm tra tổn thương, cạo/wax/triệt và độ khô của da. Chờ da lành nếu có tổn thương/thủ thuật; lau khô hoàn toàn nếu da ướt; dùng đúng vẫn kéo dài thì chuyển bộ phận liên quan.",
      evidence: "Tổn thương da, thủ thuật gần đây và độ khô của da lúc dùng.",
    },
    {
      issue: "ineffective",
      title: "Dùng chưa thấy hiệu quả",
      handling:
        "Chỉ hỏi phần còn thiếu về thời điểm dùng, da đã lau khô và thời gian dùng đều. Dùng sai thì hướng dẫn lại. Dùng đúng đủ 2 tuần vẫn chưa hiệu quả thì thu hồ sơ hoàn tiền và chuyển bộ phận liên quan.",
      evidence:
        "Thời điểm dùng, độ khô của da, số ngày đã dùng; khi đủ điều kiện: tài khoản ngân hàng, người thụ hưởng và clip hủy sản phẩm.",
    },
    {
      issue: "missing_or_damaged",
      title: "Hàng hỏng, đổ, móp hoặc thiếu",
      handling: "Xin SĐT đặt hàng và ảnh sản phẩm vỡ/hỏng; đủ hai phần thì chuyển bộ phận liên quan xử lý.",
      evidence: "SĐT đặt hàng và ảnh sản phẩm bị vỡ/hỏng.",
    },
    {
      issue: "delivery",
      title: "Giao chậm, chưa nhận hoặc giao sai",
      handling:
        "Bot chỉ ghi nhận ngắn gọn rồi chuyển bộ phận liên quan kiểm tra với shipper/đơn vị vận chuyển; không tự hứa kết quả.",
      evidence: "Nội dung sự cố khách vừa phản ánh.",
    },
    {
      issue: "counterfeit",
      title: "Nghi sản phẩm giả",
      handling:
        "Tư vấn Stopirex nhập khẩu chính ngạch, có hồ sơ công bố và kết quả thử nghiệm; với hàng khách đã nhận, thu nguồn mua và ảnh để bộ phận liên quan xác minh.",
      evidence: "Kênh mua, mã đơn và ảnh bao bì/tem/đáy lọ nếu đã nhận hàng.",
    },
    {
      issue: "negative_review",
      title: "Đánh giá tiêu cực",
      handling:
        "Tiếp nhận, không tranh cãi; làm rõ vấn đề, mã đơn và mong muốn. Chỉ xin khách cân nhắc cập nhật đánh giá sau khi nguyên nhân đã được giải quyết.",
      evidence: "Vấn đề chính, mã đơn và kết quả khách mong muốn.",
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    product: {
      name: "Stopirex",
      sku: "STOPIREX",
      channel: "facebook",
      knowledgeItems: knowledge.length,
      knowledgeLastRow: Math.max(...knowledge.map((item) => item.sourceRow)),
    },
    offers,
    knowledge: knowledge.map(({ tenantId: _tenantId, ...item }) => item),
    blockedClaims: defaultBlockedClaims.map((claim) => ({
      id: claim.id,
      phrase: claim.phrase,
      status: claim.status,
      replacement: claim.replacement ?? "Chuyển nhân viên xác minh trước khi trả lời",
    })),
    customerCare: careDefinitions.map((definition) => {
      const careCase = createCareCase({
        id: `PRODUCT-INFO-${definition.issue}`,
        issue: definition.issue,
        now,
      });
      return {
        ...definition,
        priority: careCase.priority,
        targetMinutes: Math.round((careCase.dueAt.getTime() - careCase.createdAt.getTime()) / 60_000),
        questions: careQuestions(definition.issue),
      };
    }),
    warrantyAndReturns: {
      status: "approved_with_verification" as const,
      title: "Chính sách đổi trả và hoàn tiền đã duyệt",
      summary:
        "Bot được phép tư vấn đúng các điều kiện dưới đây; bộ phận liên quan xác minh hồ sơ và thực hiện đổi/hoàn.",
      sections: [
        {
          title: "Được đổi trả",
          items: [
            "Nguyên seal, chưa dùng, lỗi nhà sản xuất trong 7 ngày",
            "Giao sai hàng trong 7 ngày kể từ ngày nhận",
            "Bể vỡ do vận chuyển trong 48 giờ, có video mở hộp",
          ],
        },
        {
          title: "Không đổi trả",
          items: [
            "Đã mở seal và đã dùng",
            "Không hợp mùi hoặc không thích sau khi dùng thử",
            "Khách làm rơi vỡ sau khi nhận",
          ],
        },
        {
          title: "Quy trình và thời gian",
          items: [
            "Liên hệ đúng kênh đã mua và cung cấp ảnh/video cùng thông tin đơn",
            "Shop xác minh, hướng dẫn hoàn trả và gửi hàng mới hoặc hoàn tiền trong 3–5 ngày làm việc sau khi nhận hàng",
            "Hoàn qua chuyển khoản ngân hàng hoặc ví của sàn",
          ],
        },
        {
          title: "Phí vận chuyển",
          items: ["Lỗi từ shop: shop chịu phí hai chiều", "Đổi loại khác: khách chịu phí một chiều gửi về"],
        },
        {
          title: "Đã dùng đúng nhưng chưa hiệu quả",
          items: [
            "Chỉ áp dụng khi đã dùng đúng hướng dẫn đủ 2 tuần",
            "Cần số tài khoản, tên ngân hàng, tên người thụ hưởng và clip nhúng hủy sản phẩm xuống nước",
            "Đủ hồ sơ thì chuyển bộ phận liên quan xử lý tiếp",
          ],
        },
      ],
      humanOnlyDecisions: [
        "Xác minh hồ sơ đủ điều kiện",
        "Thực hiện đổi hàng hoặc hoàn tiền",
        "Kết luận sản phẩm thật/giả",
        "Tra soát và xử lý sự cố đơn vị vận chuyển",
      ],
    },
    negativeReviewSteps,
    operatingRules: [
      "Chỉ dùng dữ kiện có trong kho tri thức đã duyệt.",
      "Không tự tạo mã giảm giá, ưu đãi hoặc freeship. Thời gian giao chỉ dùng ba mốc đã duyệt: cùng tỉnh/thành phố 1–2 ngày, nội miền 2–3 ngày, liên miền Bắc–Nam 3–5 ngày.",
      "Không có cửa hàng offline hoặc showroom; không có ship hỏa tốc. Đơn chỉ được đặt online và giao qua đơn vị vận chuyển.",
      "Được miễn phí giao cho 1 lọ khi khách mặc cả hoặc hệ thống bắt đầu follow-up; combo 2–5 lọ luôn miễn phí giao.",
      "Khi khách hỏi giá chung, chỉ hiển thị phương án 1, 2, 3 lọ và quà tặng; chỉ báo phương án 4 hoặc 5 lọ khi khách hỏi đúng số lượng đó.",
      "Từ 6 lọ trở lên phải chuyển tư vấn viên, không tự chốt đơn.",
      "Câu hỏi chưa có dữ liệu phải nói rõ cần kiểm tra; không tự ước lượng.",
      "Khi khách hỏi nhiều ý, trả lời ý hiện tại trước và không làm mất dữ liệu đơn đã ghi nhận.",
    ],
  };
}

export type ProductInformationSnapshot = ReturnType<typeof buildProductInformationSnapshot>;
