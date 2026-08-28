export type OrderTrackingCarrier = "viettel_post" | "spx" | "ghn" | "ghtk";

const carrierLabels: Record<OrderTrackingCarrier, string> = {
  viettel_post: "Viettel Post",
  spx: "SPX Express",
  ghn: "Giao Hàng Nhanh",
  ghtk: "Giao Hàng Tiết Kiệm",
};

export function normalizeTrackingNumber(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/gu, "");
  if (!/^[A-Za-z0-9._-]{6,80}$/u.test(normalized)) return undefined;
  return normalized;
}

export function isOrderTrackingCarrier(value: unknown): value is OrderTrackingCarrier {
  return value === "viettel_post" || value === "spx" || value === "ghn" || value === "ghtk";
}

export function buildOrderTrackingNotification(input: {
  carrier: OrderTrackingCarrier;
  trackingNumber: string;
}): { text: string; trackingUrl?: string } {
  if (input.carrier === "viettel_post") {
    return {
      text: [
        "Dạ đơn hàng của mình đã được bàn giao cho Viettel Post rồi ạ ✅",
        `Mã vận đơn: ${input.trackingNumber}`,
        "Để theo dõi hành trình, mình mở website hoặc ứng dụng Viettel Post, chọn mục Tra cứu vận đơn và tự nhập mã trên giúp em nhé.",
        "Khi nhận hàng, mình kiểm tra tình trạng kiện hàng và thông tin sản phẩm trước khi nhận. Nếu kiện có dấu hiệu bất thường, mình có thể từ chối nhận và nhắn lại bên em để được hỗ trợ ạ.",
        "Cảm ơn mình đã tin tưởng Stopirex ạ!",
      ].join("\n\n"),
    };
  }
  const carrierUrls: Record<Exclude<OrderTrackingCarrier, "viettel_post">, string> = {
    spx: `https://spx.vn/track?${encodeURIComponent(input.trackingNumber)}`,
    ghn: `https://donhang.ghn.vn/?order_code=${encodeURIComponent(input.trackingNumber)}`,
    ghtk: `https://i.ghtk.vn/${encodeURIComponent(input.trackingNumber)}`,
  };
  const url = carrierUrls[input.carrier];
  return {
    trackingUrl: url,
    text: [
      "Dạ đơn hàng của mình đã được bàn giao cho đơn vị vận chuyển rồi ạ ✅",
      `Đơn vị vận chuyển: ${carrierLabels[input.carrier]}`,
      `Mã vận đơn: ${input.trackingNumber}`,
      `Link tra cứu: ${url}`,
      "Khi nhận hàng, mình kiểm tra tình trạng kiện hàng và thông tin sản phẩm trước khi nhận giúp em. Nếu kiện có dấu hiệu bất thường, mình có thể từ chối nhận và nhắn lại bên em để được hỗ trợ ạ.",
      "Cảm ơn mình đã tin tưởng Stopirex ạ!",
    ].join("\n\n"),
  };
}

export function metaRecipientIdFromOrderSession(sessionId: string): string | undefined {
  const separator = sessionId.indexOf(":");
  if (separator < 1 || separator === sessionId.length - 1) return undefined;
  const recipientId = sessionId.slice(separator + 1).trim();
  return /^[0-9]{4,80}$/u.test(recipientId) ? recipientId : undefined;
}
