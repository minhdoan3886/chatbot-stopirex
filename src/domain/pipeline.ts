export const pipelineTags = [
  "0.Chưa tư vấn",
  "1.Phân loại",
  "2.Đang tư vấn",
  "3.Đã báo giá",
  "4.XL băn khoăn",
  "5.Chờ TT KH",
  "6.Đã tạo đơn",
  "7.Chờ followup",
  "N.Nuôi dưỡng",
  "R.Đã rớt",
  "C0.Tiếp nhận",
  "C1.Xác minh",
  "C2.Chờ ảnh",
  "C3.Chờ CSKH",
  "C4.Theo dõi",
  "C5.Đã xử lý",
] as const;

export type PipelineTag = (typeof pipelineTags)[number];

export const signalTags = [
  "CT.Giá/Ship",
  "CT.An toàn",
  "CT.Hiệu quả",
  "CT.Tham khảo",
  "TH.Xem im lặng",
  "TH.Không xem",
  "TH.Spam/Rác",
  "SC.Hàng hỏng",
  "SC.Giao hàng",
  "SC.Hàng giả",
  "SC.Đánh giá",
  "SC.Khiếu nại",
] as const;

export type SignalTag = (typeof signalTags)[number];

export type PipelineEvent =
  | "first_reply"
  | "classified"
  | "price_sent"
  | "needs_more_advice"
  | "objection_found"
  | "agreed_to_buy"
  | "order_created"
  | "followup_due"
  | "followup_replied"
  | "nurture_with_date"
  | "explicit_reject"
  | "followup_exhausted"
  | "customer_returned";

const transitions: Record<PipelineTag, Partial<Record<PipelineEvent, PipelineTag>>> = {
  "0.Chưa tư vấn": { first_reply: "1.Phân loại" },
  "1.Phân loại": {
    classified: "2.Đang tư vấn",
    price_sent: "3.Đã báo giá",
    agreed_to_buy: "5.Chờ TT KH",
  },
  "2.Đang tư vấn": {
    price_sent: "3.Đã báo giá",
    objection_found: "4.XL băn khoăn",
    agreed_to_buy: "5.Chờ TT KH",
    nurture_with_date: "N.Nuôi dưỡng",
    explicit_reject: "R.Đã rớt",
  },
  "3.Đã báo giá": {
    needs_more_advice: "2.Đang tư vấn",
    objection_found: "4.XL băn khoăn",
    agreed_to_buy: "5.Chờ TT KH",
    followup_due: "7.Chờ followup",
    nurture_with_date: "N.Nuôi dưỡng",
    explicit_reject: "R.Đã rớt",
  },
  "4.XL băn khoăn": {
    needs_more_advice: "2.Đang tư vấn",
    agreed_to_buy: "5.Chờ TT KH",
    followup_due: "7.Chờ followup",
    nurture_with_date: "N.Nuôi dưỡng",
    explicit_reject: "R.Đã rớt",
  },
  "5.Chờ TT KH": {
    order_created: "6.Đã tạo đơn",
    needs_more_advice: "2.Đang tư vấn",
  },
  "6.Đã tạo đơn": {},
  "7.Chờ followup": {
    followup_replied: "4.XL băn khoăn",
    agreed_to_buy: "5.Chờ TT KH",
    followup_exhausted: "N.Nuôi dưỡng",
    explicit_reject: "R.Đã rớt",
  },
  "N.Nuôi dưỡng": { customer_returned: "1.Phân loại" },
  "R.Đã rớt": { customer_returned: "1.Phân loại" },
  "C0.Tiếp nhận": {},
  "C1.Xác minh": {},
  "C2.Chờ ảnh": {},
  "C3.Chờ CSKH": {},
  "C4.Theo dõi": {},
  "C5.Đã xử lý": {},
};

export function transitionPipeline(current: PipelineTag, event: PipelineEvent): PipelineTag {
  const next = transitions[current][event];
  if (!next) throw new InvalidPipelineTransition(current, event);
  return next;
}

export function validateTagLengths(): void {
  for (const tag of [...pipelineTags, ...signalTags]) {
    if ([...tag].length > 14) throw new Error(`Tag vượt quá 14 ký tự: ${tag}`);
  }
}

export class InvalidPipelineTransition extends Error {
  constructor(
    readonly current: PipelineTag,
    readonly event: PipelineEvent,
  ) {
    super(`Không thể chuyển Pipeline từ ${current} bằng event ${event}`);
    this.name = "InvalidPipelineTransition";
  }
}
