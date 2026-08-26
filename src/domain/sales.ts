import type { PriceQuote } from "./products.js";

export type OpeningVariantId =
  | "AUTO.dynamic"
  | "A.choice"
  | "B.context"
  | "C.prior"
  | "D.pain"
  | "E.number";

export type ConversationIdentity = {
  salutation?: "anh" | "chị" | "anh/chị";
  customerFirstName?: string;
  staffFirstName?: string;
};

export const openingVariants = [
  {
    id: "AUTO.dynamic",
    label: "AI tự chọn theo tin khách",
    strategy: "Điều phối động",
    path: "Đọc intent + dữ kiện + trạng thái → chọn A/B/C/D/E; ý định rõ được trả lời thẳng",
    text: "",
  },
  {
    id: "A.choice",
    label: "Tư vấn trước hay xem giá",
    strategy: "Khách tự chọn hướng đi",
    path: "Chọn tư vấn → hỏi bối cảnh → xác định vấn đề; hoặc chọn xem giá → báo giá ngay",
    text: "Dạ anh/chị muốn em hỗ trợ theo cách nào trước ạ?\n1. Tư vấn tình trạng mồ hôi và mùi để chọn cách dùng phù hợp\n2. Gửi bảng giá ưu đãi 1 lọ và liệu trình 2 lọ dùng khoảng 4–6 tháng\n\nAnh/chị chọn giúp em phương án 1 hoặc 2 ạ.",
  },
  {
    id: "B.context",
    label: "Hỏi môi trường phát sinh",
    strategy: "Chẩn đoán theo bối cảnh",
    path: "Môi trường phát sinh → vấn đề chính → hướng dẫn phù hợp → giá",
    text: "Dạ tình trạng đổ mồ hôi của mình thường chỉ xuất hiện khi vận động mạnh, đi ngoài trời, hay ngay cả khi ngồi điều hòa hoặc lúc căng thẳng cũng bị ra nhiều ạ?",
  },
  {
    id: "C.prior",
    label: "Hỏi sản phẩm từng dùng",
    strategy: "Giáo dục từ thói quen cũ",
    path: "Sản phẩm từng dùng → giải thích điểm khác → vấn đề chính → bối cảnh → hướng dẫn",
    text: "Để hỗ trợ đúng điều mình cần, anh/chị muốn bắt đầu với:\n1. Tìm hiểu cách dùng Stopirex và điểm khác với lăn hằng ngày\n2. Tư vấn theo tình trạng mồ hôi hoặc mùi đang gặp\n\nAnh/chị nhắn giúp em số 1 hoặc 2 là được ạ.",
  },
  {
    id: "D.pain",
    label: "Hỏi vấn đề chính",
    strategy: "Chẩn đoán theo nỗi đau",
    path: "Ướt áo/mùi/cả hai → môi trường phát sinh → hướng dẫn → giá",
    text: "Dạ vùng da dưới cánh tay của mình đang gặp tình trạng nào nhiều hơn ạ?\n\n1. Ra nhiều mồ hôi, làm ướt hoặc ố áo\n2. Chủ yếu có mùi cơ thể\n3. Gặp cả hai tình trạng\n\nMình nhắn giúp em 1, 2 hoặc 3 ạ.",
  },
  {
    id: "E.number",
    label: "Chọn nhanh bằng số",
    strategy: "Phản hồi nhanh theo mục tiêu",
    path: "Chọn mục tiêu → trả lời lợi ích ngay; nếu từng khó chịu → kiểm tra an toàn trước",
    text: "Dạ anh/chị đang muốn ưu tiên vấn đề nào nhất ạ?\n\n1. Giảm tình trạng ướt hoặc ố áo\n2. Kiểm soát mùi cơ thể\n3. Đổi sản phẩm vì loại cũ gây khó chịu\n\nAnh/chị nhắn giúp em số tương ứng ạ.",
  },
] as const;

export function greetingMessage(identity: ConversationIdentity = {}): string {
  const salutation = identity.salutation ?? "anh/chị";
  const customerName = safeName(identity.customerFirstName);
  const staffName = safeName(identity.staffFirstName);
  const customer = customerName ? `${salutation} ${customerName}` : salutation;
  const staff = staffName
    ? `Em là ${staffName}, bộ phận tư vấn của Stopirex đây ạ.`
    : "Em là tư vấn viên của Stopirex đây ạ.";
  return `Dạ em chào ${customer} ạ! ${staff}`;
}

export function openingMessage(
  variantId: OpeningVariantId = "A.choice",
  identity: ConversationIdentity = {},
): string {
  const variant = openingVariants.find((item) => item.id === variantId) ?? openingVariants[0];
  const salutation = identity.salutation ?? "anh/chị";
  return variant.text.replaceAll("anh/chị", salutation);
}

export function personalizeCustomerAddress(
  text: string,
  identity: ConversationIdentity = {},
): string {
  const salutation = identity.salutation ?? "anh/chị";
  const capitalized = `${salutation.charAt(0).toUpperCase()}${salutation.slice(1)}`;
  return text.replaceAll("Anh/chị", capitalized).replaceAll("anh/chị", salutation);
}

function safeName(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/[<>{}#]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned || undefined;
}

export function usageGuidance(input: { recentShaveWaxLaser: boolean; skinDamaged: boolean }): string {
  if (input.skinDamaged)
    return "Mình tạm ngưng dùng trên vùng da đang tổn thương và để chuyên viên hỗ trợ kiểm tra trước giúp em ạ.";
  if (input.recentShaveWaxLaser)
    return "Mình chờ ít nhất 24 giờ sau cạo/wax/triệt và chỉ dùng khi da ổn định giúp em ạ.";
  return "Dạ mình dùng buổi tối trên da sạch, khô hoàn toàn; lăn lớp mỏng và dùng giãn cách theo hướng dẫn phiên bản đang áp dụng ạ.";
}

export function formatPriceOffer(
  single: PriceQuote,
  combo: PriceQuote,
  bulk: readonly PriceQuote[] = [],
  nextQuestion = "Anh/chị muốn chọn phương án mấy lọ ạ?",
): string {
  const money = (value: number) => `${value.toLocaleString("vi-VN")}đ`;
  const saved = single.productPrice.amount * 2 - combo.productPrice.amount;
  return [
    "Dạ giá hiện tại:",
    "Lăn ngăn tiết mồ hôi Stopirex:",
    `• 1 lọ: ${money(single.productPrice.amount)}${single.shippingFee.amount ? ` + ${money(single.shippingFee.amount)} phí giao` : ", miễn phí giao"}.`,
    `• Combo 2 lọ: ${money(combo.total.amount)}${combo.shippingFee.amount === 0 ? ", miễn phí giao" : `, phí giao ${money(combo.shippingFee.amount)}`}${saved > 0 ? `, tiết kiệm ${money(saved)}` : ""}.`,
    ...bulk.map(
      (offer) =>
        `• Combo ${offer.quantity} lọ: ${money(offer.total.amount)}${offer.shippingFee.amount === 0 ? ", miễn phí giao" : `, phí giao ${money(offer.shippingFee.amount)}`}.`,
    ),
    "• Quà tặng: đơn từ 2 lọ trở lên được tặng 1 túi đa năng vải dệt Stopirex (1 túi/đơn).",
    "",
    "Combo chăm sóc mùi cơ thể:",
    "• 1 lăn Stopirex + 1 chai Herbal Body Wash 500 ml: 525.000đ, miễn phí giao.",
    "• Herbal Body Wash hiện chưa bán lẻ.",
    nextQuestion,
  ].join("\n");
}

export function stopirexGiftForQuantity(quantity: number): string | undefined {
  return quantity >= 2
    ? "1 túi đa năng vải dệt Stopirex"
    : undefined;
}

export function followupMessage(stage: "3h" | "6h" | "9h"): string {
  if (stage === "3h")
    return "Dạ em nhắn lại để thông tin không bị trôi ạ. Lần này bên em hỗ trợ miễn phí giao cả phương án 1 lọ. Anh/chị muốn chọn mấy lọ ạ?";
  if (stage === "6h")
    return "Dạ để em hỗ trợ đúng phần mình còn cân nhắc: anh/chị đang băn khoăn về giá/phí giao, hiệu quả, an toàn hay hiện chưa cần mua ngay ạ?";
  return "Dạ em xin phép khép lại vòng tư vấn để không làm phiền anh/chị. Khi cần hỗ trợ, mình chỉ cần nhắn TƯ VẤN, bên em sẽ xem lại thông tin và hỗ trợ tiếp ạ.";
}

export function oneQuestionResponse(statements: readonly string[], nextQuestion: string): string {
  const body = statements
    .map((line) => line.trim().replace(/[?？]+$/u, "."))
    .filter(Boolean)
    .join(" ");
  return `${body} ${nextQuestion.trim()}`.trim();
}

export type SalesIntent =
  | "opening"
  | "work_context"
  | "symptom"
  | "prior_product"
  | "price"
  | "order"
  | "customer_care"
  | "opt_out"
  | "fallback";
export function routeSalesIntent(text: string): SalesIntent {
  const value = text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  if (/không nhắn|dừng nhắn|hủy đăng ký|stop/.test(value)) return "opt_out";
  if (/rát|ngứa|đỏ da|không hiệu quả|hàng giả|thiếu hàng|giao chậm/.test(value)) return "customer_care";
  if (/đặt|chốt|mua|số điện thoại|địa chỉ/.test(value)) return "order";
  if (/giá|bao nhiêu|phí ship|combo/.test(value)) return "price";
  if (/lăn cũ|đã dùng|chưa dùng|hằng ngày|chuyên sâu/.test(value)) return "prior_product";
  if (/ướt áo|ố áo|mùi|mồ hôi/.test(value)) return "symptom";
  if (/ngoài trời|vận động|phòng lạnh|căng thẳng|văn phòng/.test(value)) return "work_context";
  if (/tư vấn|xin chào|hello|inbox|ib/.test(value)) return "opening";
  return "fallback";
}
