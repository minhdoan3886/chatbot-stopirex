import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaChallenge(input: {
  mode?: string | undefined;
  token?: string | undefined;
  challenge?: string | undefined;
  expectedToken?: string | undefined;
}): string | undefined {
  if (
    input.mode === "subscribe" &&
    input.expectedToken &&
    input.token === input.expectedToken &&
    input.challenge
  ) {
    return input.challenge;
  }
  return undefined;
}

export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!signatureHeader || !appSecret || !signatureHeader.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "utf8");
  const received = Buffer.from(signatureHeader.slice("sha256=".length), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
