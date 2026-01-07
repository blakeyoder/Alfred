import { interpretAsEastern } from "./google-calendar.js";

describe("interpretAsEastern", () => {
  describe("Z suffix times (UTC indicator)", () => {
    it("should convert Z suffix to EST offset in winter", () => {
      // January is EST (UTC-5)
      const result = interpretAsEastern("2024-01-15T19:00:00Z");
      expect(result).toBe("2024-01-15T19:00:00-05:00");
    });

    it("should convert Z suffix to EDT offset in summer", () => {
      // July is EDT (UTC-4)
      const result = interpretAsEastern("2024-07-15T19:00:00Z");
      expect(result).toBe("2024-07-15T19:00:00-04:00");
    });

    it("should handle Z suffix with milliseconds", () => {
      const result = interpretAsEastern("2024-01-15T19:00:00.000Z");
      expect(result).toBe("2024-01-15T19:00:00-05:00");
    });

    it("should handle early morning times", () => {
      const result = interpretAsEastern("2024-01-15T07:00:00Z");
      expect(result).toBe("2024-01-15T07:00:00-05:00");
    });

    it("should handle late evening times", () => {
      const result = interpretAsEastern("2024-05-10T22:00:00Z");
      expect(result).toBe("2024-05-10T22:00:00-04:00");
    });

    it("should handle midnight", () => {
      const result = interpretAsEastern("2024-03-15T00:00:00Z");
      expect(result).toBe("2024-03-15T00:00:00-04:00");
    });
  });

  describe("explicit timezone offsets", () => {
    it("should pass through EST offset unchanged", () => {
      const result = interpretAsEastern("2024-01-15T19:00:00-05:00");
      expect(result).toBe("2024-01-15T19:00:00-05:00");
    });

    it("should pass through EDT offset unchanged", () => {
      const result = interpretAsEastern("2024-07-15T19:00:00-04:00");
      expect(result).toBe("2024-07-15T19:00:00-04:00");
    });

    it("should pass through other offsets unchanged", () => {
      const result = interpretAsEastern("2024-01-15T19:00:00+01:00");
      expect(result).toBe("2024-01-15T19:00:00+01:00");
    });
  });

  describe("DST boundary handling", () => {
    // 2024 DST: starts March 10, ends November 3

    it("should use EST just before DST starts (March 9)", () => {
      const result = interpretAsEastern("2024-03-09T12:00:00Z");
      expect(result).toBe("2024-03-09T12:00:00-05:00");
    });

    it("should use EDT just after DST starts (March 10)", () => {
      const result = interpretAsEastern("2024-03-10T12:00:00Z");
      expect(result).toBe("2024-03-10T12:00:00-04:00");
    });

    it("should use EDT just before DST ends (November 2)", () => {
      const result = interpretAsEastern("2024-11-02T12:00:00Z");
      expect(result).toBe("2024-11-02T12:00:00-04:00");
    });

    it("should use EST just after DST ends (November 3)", () => {
      const result = interpretAsEastern("2024-11-03T12:00:00Z");
      expect(result).toBe("2024-11-03T12:00:00-05:00");
    });
  });

  describe("real-world LLM output scenarios", () => {
    it("should fix dinner at 7pm when LLM outputs Z", () => {
      // User says "schedule dinner at 7pm tomorrow" in January
      // LLM outputs 7pm with Z suffix, meaning 7pm local time
      const result = interpretAsEastern("2024-01-16T19:00:00Z");
      expect(result).toBe("2024-01-16T19:00:00-05:00");
    });

    it("should fix late dinner at 10pm in summer", () => {
      const result = interpretAsEastern("2024-05-10T22:00:00.000Z");
      expect(result).toBe("2024-05-10T22:00:00-04:00");
    });

    it("should fix early breakfast at 7am", () => {
      const result = interpretAsEastern("2024-01-15T07:00:00.000Z");
      expect(result).toBe("2024-01-15T07:00:00-05:00");
    });
  });
});
