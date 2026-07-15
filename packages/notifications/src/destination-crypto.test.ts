import { describe, expect, it } from "vitest";

import {
  decryptNotificationDestination,
  encryptNotificationDestination,
  hashNotificationDestination,
  maskNotificationDestination,
  normalizeNotificationDestination
} from "./destination-crypto.js";

const key = "unit-test-encryption-key-32-characters";

describe("notification destination protection", () => {
  it("normalizes, encrypts, decrypts, masks, and hashes email destinations", () => {
    const ciphertext = encryptNotificationDestination("EMAIL", "  Person@Example.COM ", key);

    expect(decryptNotificationDestination("EMAIL", ciphertext, key)).toBe("person@example.com");
    expect(maskNotificationDestination("EMAIL", "Person@Example.COM")).toBe("pe****@example.com");
    expect(hashNotificationDestination("EMAIL", "Person@Example.COM", key)).toBe(
      hashNotificationDestination("EMAIL", "person@example.com", key)
    );
    expect(Buffer.from(ciphertext).toString("utf8")).not.toContain("person@example.com");
  });

  it("rejects tampering and channel substitution", () => {
    const ciphertext = encryptNotificationDestination("EMAIL", "person@example.com", key);
    const tampered = Uint8Array.from(ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;

    expect(() => decryptNotificationDestination("EMAIL", tampered, key)).toThrow(
      "DESTINATION_DECRYPTION_FAILED"
    );
    expect(() => decryptNotificationDestination("TELEGRAM", ciphertext, key)).toThrow(
      "DESTINATION_DECRYPTION_FAILED"
    );
  });

  it("validates Telegram chat identifiers and masks all but the final four digits", () => {
    expect(normalizeNotificationDestination("TELEGRAM", " -1001234567890 ")).toBe("-1001234567890");
    expect(maskNotificationDestination("TELEGRAM", "-1001234567890")).toBe("-*********7890");
    expect(() => normalizeNotificationDestination("TELEGRAM", "@public-channel")).toThrow();
  });

  it("refuses undersized encryption secrets", () => {
    expect(() =>
      encryptNotificationDestination("EMAIL", "person@example.com", "too-short")
    ).toThrow("DATA_ENCRYPTION_KEY_TOO_SHORT");
  });
});
