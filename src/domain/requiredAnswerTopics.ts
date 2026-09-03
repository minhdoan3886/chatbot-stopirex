export type RequiredAnswerTopic =
  | "alcohol_fact"
  | "product_scent"
  | "permanent_effect"
  | "usage_time"
  | "application_feel"
  | "ineffective_refund"
  | "hypothetical_irritation_refund";

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
    /\b(?:sang|buoi sang|sang day|sang ngu day)\b/.test(text) &&
    (/\b(?:boi|lan|quet)\b/.test(text) ||
      /\bdung (?:stopirex|san pham|loai nay|cai nay)\b/.test(text) ||
      /\bdung (?:vao )?(?:buoi )?sang\b/.test(text)) &&
    !/\b(?:nuoc hoa|lan khu mui|romano)\b/.test(text) &&
    !/\b(?:boi|lan|quet|dung)(?: xong)?\b.{0,60}\b(?:sang|buoi sang|sang hom sau)\b.{0,60}\b(?:tam|rua|xa phong|soap)\b/.test(
      text,
    ) &&
    !(
      /\b(?:tam|rua|xa phong|soap)\b/.test(text) &&
      /\b(?:toi hom truoc|buoi toi|dem truoc)\b/.test(text)
    )
  ) {
    topics.push("usage_time");
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
  if (
    /\b(?:neu|lo ma|gia su|dua ban|ban minh|nguoi khac|minh nghe|neu minh boi)\b/.test(text) &&
    /\b(?:xot|rat|ngua|kich ung|do da)\b/.test(text) &&
    /\b(?:bao hanh|hoan tien|tra tien|tra hang|doi tra)\b/.test(text)
  ) {
    topics.push("hypothetical_irritation_refund");
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
    case "usage_time":
      return (
        /\bbuoi toi\b/.test(text) &&
        (/\bkhong\b.{0,80}\b(?:buoi )?sang\b/.test(text) ||
          /\b(?:cho|doi)\b.{0,30}\b24\s*(?:[–-]\s*)?48 (?:gio|h)\b/.test(text) ||
          /\b(?:boi|lan|quet|dung) (?:vao )?(?:buoi )?sang\b.{0,45}\b(?:kem hieu qua|khong dung huong dan)\b/.test(
            text,
          ))
      );
    case "application_feel":
      return /\bkhong bet\b/.test(text) || /\bkho nhanh\b/.test(text);
    case "ineffective_refund":
      return (
        /\b(?:dung dung|dung theo dung|dung dung huong dan)\b/.test(text) &&
        /\b(?:du )?2 tuan\b/.test(text) &&
        /\bhoan tien\b/.test(text)
      );
    case "hypothetical_irritation_refund": {
      const directConfirmation = /^(?:da\s+)?co\b.{0,80}\b(?:bao hanh|hoan tien)\b/.test(text);
      const conditions =
        /\bdung dung huong dan\b/.test(text) && /\b(?:du )?2 tuan\b/.test(text);
      const evidenceAndNoReturn =
        /\bclip\b.{0,35}\bnhung huy\b/.test(text) &&
        /\bkhong can gui (?:lai )?san pham\b/.test(text);
      const irritationSafety =
        /\b(?:xot|rat)\b/.test(text) &&
        /\bngung dung\b/.test(text) &&
        /\b(?:nhan|lien he)\b/.test(text);
      return directConfirmation && conditions && evidenceAndNoReturn && irritationSafety;
    }
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
