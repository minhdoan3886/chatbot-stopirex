export type OrderDraft = {
  recipientName?: string;
  phone?: string;
  legacyAddress?: string;
  sku?: string;
  quantity?: number;
  totalVnd?: number;
  paymentMethod?: "cod" | "bank_transfer";
  deliveryNote?: string;
  customerConfirmedAt?: Date;
};

export const requiredOrderFields = [
  "recipientName",
  "phone",
  "legacyAddress",
  "sku",
  "quantity",
  "totalVnd",
  "paymentMethod",
] as const;

export type LegacyAddressComponent = "detail" | "ward" | "district" | "province";

export type OrderPriceBreakdown = {
  productPriceVnd: number;
  shippingFeeVnd: number;
};

export function missingLegacyAddressComponents(address?: string): LegacyAddressComponent[] {
  if (!address?.trim()) return ["detail", "ward", "district", "province"];
  const value = normalizeAddress(address);
  const missing: LegacyAddressComponent[] = [];
  const hasDetail =
    /\d/.test(value) || /\b(so nha|duong|pho|ngo|ngach|hem|thon|xom|ap|to|khu|toa|chung cu)\b/.test(value);
  const hasWard = /(?:^|[\s,])(phuong|xa|thi tran|p\.?|x\.?)\b/.test(value);
  const hasDistrict =
    /\b(quan|huyen|thi xa)\b/.test(value) ||
    /\b(?:thanh pho|tp)\s+thu duc\b/.test(value) ||
    (/\b(?:thanh pho|tp)\b/.test(value) && /\btinh\b/.test(value));
  const hasProvince =
    /\btinh\b/.test(value) ||
    /\b(ha noi|ho chi minh|tp hcm|tphcm|hai phong|da nang|can tho|hue)\b/.test(value);
  if (!hasDetail) missing.push("detail");
  // Khách không cần phải viết đủ nhãn hành chính như một tờ khai. Một điểm
  // giao có số nhà/đường/thôn và tỉnh/thành đã đủ để tiếp nhận đơn; đơn vị
  // vận chuyển sẽ chuẩn hóa tiếp. Chỉ yêu cầu phường/quận khi địa chỉ còn
  // thiếu một trong hai tín hiệu cốt lõi trên.
  if (hasDetail && hasProvince) return missing;
  if (!hasWard) missing.push("ward");
  if (!hasDistrict) missing.push("district");
  if (!hasProvince) missing.push("province");
  return missing;
}

export function missingOrderFields(draft: OrderDraft): Array<(typeof requiredOrderFields)[number]> {
  return requiredOrderFields.filter((field) => {
    if (field === "legacyAddress") return missingLegacyAddressComponents(draft.legacyAddress).length > 0;
    return draft[field] === undefined || draft[field] === "";
  });
}

export function assertOrderReady(draft: OrderDraft): void {
  const missing = missingOrderFields(draft);
  if (missing.length > 0) throw new OrderNotReadyError(`Thiếu dữ liệu: ${missing.join(", ")}`);
  if (!draft.customerConfirmedAt) throw new OrderNotReadyError("Khách chưa xác nhận ĐỒNG Ý");
  if (!/^0\d{9}$/.test(draft.phone!)) throw new OrderNotReadyError("Số điện thoại không hợp lệ");
  if ((draft.quantity ?? 0) < 1 || (draft.totalVnd ?? 0) <= 0) {
    throw new OrderNotReadyError("Số lượng hoặc tổng tiền không hợp lệ");
  }
}

export function formatOrderConfirmation(draft: OrderDraft, price?: OrderPriceBreakdown): string {
  const missing = missingOrderFields(draft);
  if (missing.length > 0) throw new OrderNotReadyError(`Chưa thể tóm tắt đơn; thiếu ${missing.join(", ")}`);
  const priceLines = price
    ? [
        `Tiền hàng: ${price.productPriceVnd.toLocaleString("vi-VN")}đ`,
        `Phí giao: ${price.shippingFeeVnd === 0 ? "Miễn phí" : `${price.shippingFeeVnd.toLocaleString("vi-VN")}đ`}`,
      ]
    : [];
  return [
    `Tên người nhận: ${draft.recipientName}`,
    `SĐT: ${draft.phone}`,
    `Địa chỉ trước sáp nhập: ${draft.legacyAddress}`,
    `Sản phẩm: ${draft.sku} × ${draft.quantity}`,
    ...priceLines,
    ...(draft.quantity !== undefined && draft.quantity >= 2
      ? ["Quà tặng: 1 túi đa năng vải dệt Stopirex (1 túi/đơn)"]
      : []),
    `Tổng thanh toán: ${draft.totalVnd!.toLocaleString("vi-VN")}đ`,
    `Thanh toán: ${draft.paymentMethod === "cod" ? "COD" : "Chuyển khoản"}`,
    ...(draft.deliveryNote ? [`Ghi chú giao hàng: ${draft.deliveryNote}`] : []),
    "Anh/chị kiểm tra và phản hồi “ĐỒNG Ý” để em tạo đơn ạ.",
  ].join("\n");
}

export class OrderNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderNotReadyError";
  }
}

function normalizeAddress(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}
