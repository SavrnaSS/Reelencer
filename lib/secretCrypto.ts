import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function keyFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function getSecretKey() {
  const secret = String(process.env.WORK_EMAIL_CRYPTO_SECRET ?? "").trim();
  if (!secret) return null;
  return keyFromSecret(secret);
}

export function encryptSecretText(plain: string) {
  const key = getSecretKey();
  if (!key) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `${PREFIX}${payload}`;
}

export function decryptSecretText(value: string) {
  if (!value.startsWith(PREFIX)) return value;
  const key = getSecretKey();
  if (!key) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(PREFIX);
}
