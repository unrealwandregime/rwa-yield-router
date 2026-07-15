import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import { z } from "zod";

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MINIMUM_KEY_CHARACTERS = 16;

export const externalNotificationChannelSchema = z.enum(["EMAIL", "TELEGRAM"]);
export type ExternalNotificationChannel = z.infer<typeof externalNotificationChannelSchema>;

const emailDestinationSchema = z.email().max(320);
const telegramDestinationSchema = z
  .string()
  .trim()
  .regex(/^-?[1-9]\d{0,19}$/u, "Telegram destination must be a numeric chat identifier");

const deriveKey = (secret: string, purpose: "ENCRYPTION" | "LOOKUP_HASH"): Buffer => {
  if (secret.length < MINIMUM_KEY_CHARACTERS) {
    throw new Error("DATA_ENCRYPTION_KEY_TOO_SHORT");
  }
  return createHash("sha256")
    .update(`rwa-yield-router:notification-destination:v1:${purpose}\0`, "utf8")
    .update(secret, "utf8")
    .digest();
};

export function normalizeNotificationDestination(
  channel: ExternalNotificationChannel,
  destination: string
): string {
  const trimmed = destination.trim();
  return channel === "EMAIL"
    ? emailDestinationSchema.parse(trimmed).toLowerCase()
    : telegramDestinationSchema.parse(trimmed);
}

export function maskNotificationDestination(
  channel: ExternalNotificationChannel,
  destination: string
): string {
  const normalized = normalizeNotificationDestination(channel, destination);
  if (channel === "EMAIL") {
    const separator = normalized.lastIndexOf("@");
    const local = normalized.slice(0, separator);
    const domain = normalized.slice(separator + 1);
    const visibleLocal = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
    return `${visibleLocal}${"*".repeat(Math.max(3, local.length - visibleLocal.length))}@${domain}`;
  }
  const sign = normalized.startsWith("-") ? "-" : "";
  const digits = sign === "" ? normalized : normalized.slice(1);
  return `${sign}${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export function hashNotificationDestination(
  channel: ExternalNotificationChannel,
  destination: string,
  secret: string
): string {
  const normalized = normalizeNotificationDestination(channel, destination);
  return createHmac("sha256", deriveKey(secret, "LOOKUP_HASH"))
    .update(`${channel}\0${normalized}`, "utf8")
    .digest("hex");
}

export function encryptNotificationDestination(
  channel: ExternalNotificationChannel,
  destination: string,
  secret: string
): Uint8Array {
  const normalized = normalizeNotificationDestination(channel, destination);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, "ENCRYPTION"), iv);
  cipher.setAAD(Buffer.from(channel, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, authenticationTag, ciphertext]);
}

export function decryptNotificationDestination(
  channel: ExternalNotificationChannel,
  envelope: Uint8Array,
  secret: string
): string {
  if (envelope.byteLength <= 1 + IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("DESTINATION_ENVELOPE_INVALID");
  }
  const bytes = Buffer.from(envelope);
  const version = bytes.subarray(0, 1);
  if (!timingSafeEqual(version, Buffer.from([ENVELOPE_VERSION]))) {
    throw new Error("DESTINATION_ENVELOPE_VERSION_UNSUPPORTED");
  }
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const authenticationTag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = bytes.subarray(1 + IV_BYTES + AUTH_TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret, "ENCRYPTION"), iv);
    decipher.setAAD(Buffer.from(channel, "utf8"));
    decipher.setAuthTag(authenticationTag);
    const destination = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    );
    return normalizeNotificationDestination(channel, destination);
  } catch {
    throw new Error("DESTINATION_DECRYPTION_FAILED");
  }
}
