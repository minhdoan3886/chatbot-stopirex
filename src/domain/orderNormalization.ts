export type EntityConfidence = "mentioned" | "inferred" | "proposed" | "confirmed";

export type NormalizedEntity<T> = {
  raw: string;
  normalized?: T;
  confidence: number;
  status: EntityConfidence;
  valid: boolean;
  reason?: string;
};

export type VietnameseAddress = {
  street?: string;
  ward?: string;
  district?: string;
  city?: string;
  rawParts: string[];
  status: EntityConfidence;
};

const VI_DIGITS: Readonly<Record<string, string>> = {
  "0": "0",
  khong: "0",
  ko: "0",
  zero: "0",
  "1": "1",
  mot: "1",
  "2": "2",
  hai: "2",
  "3": "3",
  ba: "3",
  "4": "4",
  bon: "4",
  tu: "4",
  "5": "5",
  nam: "5",
  lam: "5",
  "6": "6",
  sau: "6",
  "7": "7",
  bay: "7",
  "8": "8",
  tam: "8",
  "9": "9",
  chin: "9",
};

export function isVietnameseMobilePhone(value: string): boolean {
  return /^(?:03|05|07|08|09)\d{8}$/u.test(value);
}

/**
 * Exact digits win. Word-digits are accepted only in a phone-labelled span so
 * ordinary words such as "không" cannot silently become order data.
 */
export function normalizeVietnamesePhone(rawText: string): NormalizedEntity<string> {
  const exact = rawText.match(/(?<!\d)(0\d{9})(?!\d)/u)?.[1];
  if (exact) {
    return {
      raw: exact,
      normalized: exact,
      confidence: isVietnameseMobilePhone(exact) ? 1 : 0.45,
      status: "proposed",
      valid: isVietnameseMobilePhone(exact),
      ...(!isVietnameseMobilePhone(exact) ? { reason: "invalid_vietnam_mobile_prefix" } : {}),
    };
  }

  const comparable = normalizeComparable(rawText);
  const marker = /(?:^|\s)(?:sdt|s d t|so dien thoai|dien thoai|dt)(?:\s|$)/u.exec(comparable);
  if (!marker) {
    return { raw: rawText, confidence: 0, status: "mentioned", valid: false, reason: "missing_phone_marker" };
  }
  const tail = comparable.slice(marker.index + marker[0].length).trim();
  const digits: string[] = [];
  const evidenceTokens: string[] = [];
  for (const token of tail.split(/\s+/u)) {
    const digit = VI_DIGITS[token];
    if (digit === undefined) {
      if (digits.length > 0) break;
      continue;
    }
    digits.push(digit);
    evidenceTokens.push(token);
    if (digits.length === 10) break;
  }
  const normalized = digits.join("");
  const valid = digits.length === 10 && isVietnameseMobilePhone(normalized);
  return {
    raw: evidenceTokens.join(" ") || tail,
    ...(normalized ? { normalized } : {}),
    confidence: valid ? 0.99 : digits.length >= 8 ? 0.55 : 0.2,
    status: "proposed",
    valid,
    ...(!valid ? { reason: digits.length === 10 ? "invalid_vietnam_mobile_prefix" : "phone_digit_count" } : {}),
  };
}

export function resolveDeliveryContext(rawText: string): NormalizedEntity<VietnameseAddress> {
  const text = normalizeComparable(rawText);
  const district = /\b(?:q\s*1|quan\s*1)\b/u.test(text) ? "Quận 1" : undefined;
  const city = /\b(?:sg|sai gon|tphcm|tp hcm|ho chi minh)\b/u.test(text)
    ? "TP. Hồ Chí Minh"
    : undefined;
  const valid = Boolean(district || city);
  return {
    raw: rawText.trim(),
    ...(valid
      ? {
          normalized: {
            ...(district ? { district } : {}),
            ...(city ? { city } : {}),
            rawParts: [rawText.trim()],
            status: "mentioned",
          },
        }
      : {}),
    confidence: district && city ? 0.99 : valid ? 0.9 : 0,
    status: "mentioned",
    valid,
    ...(!valid ? { reason: "unsupported_delivery_alias" } : {}),
  };
}

export function normalizeVietnameseAddress(
  rawText: string,
  prior?: VietnameseAddress,
): NormalizedEntity<VietnameseAddress> {
  const comparable = normalizeComparable(rawText)
    .replace(/\b(?:dc|dia chi)\s+(?:m|minh)\s+la\b/u, " ")
    .replace(/\b(?:sdt|so dien thoai|dien thoai|dt)\b[\s\S]*$/u, " ")
    .trim();
  const context = resolveDeliveryContext(rawText).normalized;
  const ward = /\b(?:f|p|phuong)\s*(?:da\s*kao|dakao|dakhao)\b/u.test(comparable)
    ? "Phường Đa Kao"
    : undefined;
  const streetMatch = comparable.match(
    /\b(\d+[\d/]*)\s+(nguyen\s+th(?:i|j)\s+minh\s+khai)\b/u,
  );
  const street = streetMatch ? `${streetMatch[1]} Nguyễn Thị Minh Khai` : undefined;
  const district = context?.district ?? prior?.district;
  const city = context?.city ?? prior?.city;
  const rawParts = [
    ...(prior?.rawParts ?? []),
    rawText.trim(),
  ].filter((value, index, all) => value && all.indexOf(value) === index);
  const mergedStreet = street ?? prior?.street;
  const mergedWard = ward ?? prior?.ward;
  const normalized: VietnameseAddress = {
    ...(mergedStreet ? { street: mergedStreet } : {}),
    ...(mergedWard ? { ward: mergedWard } : {}),
    ...(district ? { district } : {}),
    ...(city ? { city } : {}),
    rawParts,
    status: street && ward && district && city ? "confirmed" : "proposed",
  };
  const hasNewAddressPart = Boolean(street || ward || context?.district || context?.city);
  const valid = hasNewAddressPart && Boolean(normalized.street || normalized.district || normalized.city);
  return {
    raw: rawText.trim(),
    ...(valid ? { normalized } : {}),
    confidence: street && ward ? 0.98 : context?.district && context.city ? 0.95 : valid ? 0.82 : 0,
    status: normalized.status,
    valid,
    ...(!valid ? { reason: "address_not_recognized" } : {}),
  };
}

export function formatVietnameseAddress(address: VietnameseAddress): string {
  return [address.street, address.ward, address.district, address.city].filter(Boolean).join(", ");
}

export function normalizeDeliveryNotes(rawText: string): NormalizedEntity<string[]> {
  const text = normalizeComparable(rawText);
  const notes: string[] = [];
  if (/\bgiao\b.{0,24}\bgio\s+h(?:anh\s*chinh|chjnh)\b/u.test(text)) {
    notes.push("Giao trong giờ hành chính");
  }
  if (/\b(?:t2|thu\s*2)\b.{0,30}\b(?:t6|thu\s*6)\b/u.test(text)) {
    notes.push("Chỉ nhận hàng từ Thứ 2 đến Thứ 6");
  }
  if (/\b(?:t7|thu\s*7)\b.{0,25}\b(?:nghi|ngi|khong nhan|ko nhan)\b|\b(?:nghi|ngi|khong nhan|ko nhan)\b.{0,25}\b(?:t7|thu\s*7)\b/u.test(text)) {
    notes.push("Không nhận hàng Thứ 7");
  }
  return {
    raw: rawText.trim(),
    ...(notes.length > 0 ? { normalized: notes } : {}),
    confidence: notes.length > 0 ? 0.98 : 0,
    status: "proposed",
    valid: notes.length > 0,
    ...(notes.length === 0 ? { reason: "delivery_note_not_recognized" } : {}),
  };
}

export function mergeDeliveryNotes(existing: string | undefined, incoming: readonly string[]): string {
  return [...new Set([...(existing ? existing.split(/\s*;\s*/u) : []), ...incoming].filter(Boolean))].join("; ");
}

export function normalizeComparable(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/gu, "d")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
