import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import config from "@shared/infra/config";

const ALGORITHM = "aes-256-gcm";

function getKey(configured = config.leadSources.encryptionKey): Buffer {
  if (!configured) {
    throw new Error(
      "CUSTOM_ACTION_ENCRYPTION_KEY is required to store integration credentials",
    );
  }
  return createHash("sha256").update(configured, "utf8").digest();
}

function encryptWithKey(value: string, configured?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(configured), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return ["v1", iv, tag, encrypted]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(":");
}

function decryptWithKey(value: string, configured?: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Unsupported encrypted credential format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(configured),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export const encryptCredential = (value: string) => encryptWithKey(value);
export const decryptCredential = (value: string) => decryptWithKey(value);
export const encryptCustomActionCredential = (value: string) =>
  encryptWithKey(value, config.customActions?.encryptionKey || config.leadSources.encryptionKey);
export const decryptCustomActionCredential = (value: string) =>
  decryptWithKey(value, config.customActions?.encryptionKey || config.leadSources.encryptionKey);
