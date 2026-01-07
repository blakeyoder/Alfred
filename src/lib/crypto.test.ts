import { encrypt, decrypt } from "./crypto.js";
import { _resetConfigForTesting } from "./config.js";

describe("encrypt/decrypt", () => {
  const originalEnv = process.env.ENCRYPTION_KEY;

  // Valid 32-byte key (64 hex chars)
  const TEST_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeEach(() => {
    _resetConfigForTesting();
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    _resetConfigForTesting();
    if (originalEnv) {
      process.env.ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  describe("happy path", () => {
    it("roundtrips arbitrary text correctly", () => {
      const plaintext =
        "Hello, World! This is a test with unicode: \u00e9\u00e0\u00fc";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("roundtrips empty string", () => {
      const plaintext = "";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("roundtrips long text", () => {
      const plaintext = "x".repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("roundtrips JSON tokens (real use case)", () => {
      const tokens = JSON.stringify({
        access_token: "ya29.a0AfH6SMBx...",
        refresh_token: "1//0eXYZ...",
        expiry_date: 1234567890,
      });
      const encrypted = encrypt(tokens);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(tokens);
    });

    it("produces base64 output", () => {
      const encrypted = encrypt("test");
      // Base64 regex: only contains A-Z, a-z, 0-9, +, /, and = padding
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it("produces different ciphertext for same plaintext (random IV)", () => {
      const plaintext = "same input";
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      // Different ciphertexts due to random IV
      expect(encrypted1).not.toBe(encrypted2);

      // But both decrypt to same value
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe("missing ENCRYPTION_KEY", () => {
    it("throws when ENCRYPTION_KEY is missing on encrypt", () => {
      delete process.env.ENCRYPTION_KEY;
      _resetConfigForTesting();
      expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY");
    });

    it("throws when ENCRYPTION_KEY is missing on decrypt", () => {
      // First encrypt with valid key
      const encrypted = encrypt("test");

      // Then try to decrypt without key
      delete process.env.ENCRYPTION_KEY;
      _resetConfigForTesting();
      expect(() => decrypt(encrypted)).toThrow("ENCRYPTION_KEY");
    });
  });

  describe("invalid ENCRYPTION_KEY length", () => {
    it("throws when key is too short", () => {
      process.env.ENCRYPTION_KEY = "0123456789abcdef"; // 16 chars = 8 bytes
      _resetConfigForTesting();
      expect(() => encrypt("test")).toThrow("64 hex characters");
    });

    it("throws when key is too long", () => {
      // Append valid hex chars to make 36 bytes (72 hex chars)
      process.env.ENCRYPTION_KEY = TEST_KEY + "deadbeef";
      _resetConfigForTesting();
      expect(() => encrypt("test")).toThrow("64 hex characters");
    });
  });

  describe("invalid ciphertext", () => {
    it("throws when decrypting invalid base64", () => {
      expect(() => decrypt("not-valid-base64!!!")).toThrow();
    });

    it("throws when decrypting truncated data (too short)", () => {
      // Need at least 32 bytes (16 IV + 16 auth tag)
      const tooShort = Buffer.from("short").toString("base64");
      expect(() => decrypt(tooShort)).toThrow(
        "Invalid encrypted data: too short"
      );
    });

    it("throws when auth tag is corrupted", () => {
      const encrypted = encrypt("test");
      const buf = Buffer.from(encrypted, "base64");

      // Corrupt the auth tag (bytes 16-31)
      buf[20] = buf[20] ^ 0xff;

      const corrupted = buf.toString("base64");
      expect(() => decrypt(corrupted)).toThrow();
    });

    it("throws when ciphertext is corrupted", () => {
      const encrypted = encrypt("test message");
      const buf = Buffer.from(encrypted, "base64");

      // Corrupt the ciphertext (after byte 32)
      if (buf.length > 32) {
        buf[33] = buf[33] ^ 0xff;
      }

      const corrupted = buf.toString("base64");
      expect(() => decrypt(corrupted)).toThrow();
    });

    it("throws when IV is corrupted", () => {
      const encrypted = encrypt("test");
      const buf = Buffer.from(encrypted, "base64");

      // Corrupt the IV (first 16 bytes)
      buf[5] = buf[5] ^ 0xff;

      const corrupted = buf.toString("base64");
      // AES-GCM with wrong IV will fail auth tag verification
      expect(() => decrypt(corrupted)).toThrow();
    });
  });

  describe("key isolation", () => {
    it("cannot decrypt with different key", () => {
      const encrypted = encrypt("secret");

      // Change to different valid key
      process.env.ENCRYPTION_KEY =
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
      _resetConfigForTesting();

      expect(() => decrypt(encrypted)).toThrow();
    });
  });
});
