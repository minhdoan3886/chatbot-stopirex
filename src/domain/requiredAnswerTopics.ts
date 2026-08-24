export type RequiredAnswerTopic =
  "alcohol_fact" | "product_scent" | "permanent_effect" | "application_feel" | "ineffective_refund";

export function requiredAnswerTopics(customerMessage: string): RequiredAnswerTopic[] {
  const text = normalize(customerMessage);
  const topics: RequiredAnswerTopic[] = [];

  if (/\b(?:con|alcohol)\b/.test(text)) topics.push("alcohol_fact");
  if (/\b(?:mui gi|co mui|khong mui|hoan toan khong mui|mui huong|huong hoa|lon mui|lan mui)\b/.test(text)) {
    topics.push("product_scent");
  }
  if (
    /\b(?:dut diem|khoi vinh vien|vinh vien|khong bao gio bi lai|ngung (?:boi|dung).{0,30}(?:bi lai|ra lai|mo hoi))\b/.test(
      text,
    )
  ) {
    topics.push("permanent_effect");
  }
  if (
    /\b(?:boi|lan)(?: xong| len| vao)?\b.{0,45}\b(?:bet|dinh|uot|am|nhep)\b/.test(text) ||
    /\b(?:bet|dinh|o vang|bam)\b.{0,35}\b(?:ao|vai|nach)\b/.test(text)
  ) {
    topics.push("application_feel");
  }
  if (
    /\b(?:khong|ko|k)\s*(?:do|khoi|het|hieu qua|cai thien)\b/.test(text) &&
    /\b(?:hoan tien|hoan xeng|tra tien|tra hang|doi tra)\b/.test(text)
  ) {
    topics.push("ineffective_refund");
  }

  return [...new Set(topics)];
}

export function replyCoversRequiredAnswerTopic(topic: RequiredAnswerTopic, customerReply: string): boolean {
  const text = normalize(customerReply);
  switch (topic) {
    case "alcohol_fact":
      return (
        /\b(?:stopirex|san pham)?\s*(?:van )?co (?:chua )?(?:con|alcohol)\b/.test(text) &&
        /\bdung moi\b/.test(text) &&
        /\bnguong an toan\b/.test(text)
      );
    case "product_scent":
      return (
        /\bmui (?:duoc tinh )?dac trung nhe\b/.test(text) &&
        /\bbay (?:hoi )?(?:rat |cuc ky )?nhanh\b/.test(text)
      );
    case "permanent_effect":
      return (
        /\b(?:ho tro )?kiem soat (?:tiet )?mo hoi\b/.test(text) &&
        (/\bkhong phai (?:thuoc )?chua (?:dut diem|khoi|vinh vien)\b/.test(text) ||
          /\bkhong (?:co cam ket |phai )?(?:khoi )?vinh vien\b/.test(text) ||
          /\bcan (?:dung )?duy tri\b/.test(text))
      );
    case "application_feel":
      return /\bkhong bet\b/.test(text) || /\bkho nhanh\b/.test(text);
    case "ineffective_refund":
      return (
        /\b(?:dung dung|dung theo dung|dung dung huong dan)\b/.test(text) &&
        /\b(?:du )?2 tuan\b/.test(text) &&
        /\bhoan tien\b/.test(text)
      );
  }
}

export function missingRequiredAnswerTopics(
  customerMessage: string,
  customerReply: string,
): RequiredAnswerTopic[] {
  return requiredAnswerTopics(customerMessage).filter(
    (topic) => !replyCoversRequiredAnswerTopic(topic, customerReply),
  );
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9%]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
