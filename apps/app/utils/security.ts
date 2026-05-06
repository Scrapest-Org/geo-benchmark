import { getEnv } from "@scrapest/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function createOpaqueToken(size = 32) {
  return toBase64Url(randomBytes(size));
}

function sha256(input: string) {
  return createHash("sha256").update(input).digest();
}

function createPkcePair() {
  const verifier = createOpaqueToken(48);
  const challenge = toBase64Url(sha256(verifier));

  return { challenge, verifier };
}

function getEncryptionKey() {
  return createHash("sha256")
    .update(getEnv("API_KEY_ENCRYPTION_SECRET"), "utf8")
    .digest();
}

function encryptString(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [toBase64Url(iv), toBase64Url(tag), toBase64Url(encrypted)].join(".");
}

function decryptString(payload: string) {
  const [ivValue, tagValue, encryptedValue] = payload.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted payload is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    fromBase64Url(ivValue),
  );
  decipher.setAuthTag(fromBase64Url(tagValue));

  const decrypted = Buffer.concat([
    decipher.update(fromBase64Url(encryptedValue)),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export { createOpaqueToken, createPkcePair, decryptString, encryptString };
