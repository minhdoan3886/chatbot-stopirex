import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const version = "v1";

export class MetaPageCredentialVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret.trim()) throw new Error("ENCRYPTION_KEY không được trống");
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  encrypt(value: string): string {
    if (!value.trim()) throw new Error("Page access token không được trống");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      version,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string): string {
    const [payloadVersion, ivValue, tagValue, encryptedValue] = payload.split(".");
    if (payloadVersion !== version || !ivValue || !tagValue || !encryptedValue) {
      throw new Error("Page access token đã mã hóa không hợp lệ");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
