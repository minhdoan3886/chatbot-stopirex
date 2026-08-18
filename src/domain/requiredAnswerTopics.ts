export type RequiredAnswerTopic = "alcohol_fact" | "product_scent" | "permanent_effect";

export function requiredAnswerTopics(customerMessage: string): RequiredAnswerTopic[] {
  const text = normalize(customerMessage);
  const topics: RequiredAnswerTopic[] = [];

  if (/\b(?:con|alcohol)\b/.test(text)) topics.push("alcohol_fact");
  if (
    /\b(?:mui gi|co mui|khong mui|hoan toan khong mui|mui huong|huong hoa|lon mui|lan mui)\b/.test(
      text,
    )
  ) {
    topics.push("product_scent");
  }
  if (/\b(?:dut diem|khoi vinh vien|vinh vien|khong bao gio bi lai|ngung (?:boi|dung).{0,30}(?:bi lai|ra lai|mo hoi))\b/.test(text)) {
    topics.push("permanent_effect");
  }

  return [...new Set(topics)];
}

export function replyCoversRequiredAnswerTopic(
  topic: RequiredAnswerTopic,
  customerReply: string,
): boolean {
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
