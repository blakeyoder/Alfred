import { parseEasternDateTime, isEasternDST, formatEastern } from "./datetime.js";

describe("parseEasternDateTime", () => {
  describe("with explicit timezone", () => {
    it("should parse UTC (Z suffix) as-is", () => {
      const result = parseEasternDateTime("2026-01-02T19:43:00Z");
      expect(result.toISOString()).toBe("2026-01-02T19:43:00.000Z");
    });

    it("should parse positive offset correctly", () => {
      const result = parseEasternDateTime("2026-01-02T19:43:00+05:00");
      expect(result.toISOString()).toBe("2026-01-02T14:43:00.000Z");
    });

    it("should parse negative offset correctly", () => {
      const result = parseEasternDateTime("2026-01-02T19:43:00-05:00");
      expect(result.toISOString()).toBe("2026-01-03T00:43:00.000Z");
    });
  });

  describe("without timezone (assumes Eastern)", () => {
    describe("during EST (Standard Time, Nov-Mar)", () => {
      // January is EST (UTC-5)
      it("should add 5 hours to convert Eastern to UTC in winter", () => {
        // User says 7:43 PM Eastern on Jan 2
        const result = parseEasternDateTime("2026-01-02T19:43:00");
        // Should be 7:43 PM + 5 hours = 00:43 AM UTC on Jan 3
        expect(result.toISOString()).toBe("2026-01-03T00:43:00.000Z");
      });

      it("should handle midnight correctly in winter", () => {
        const result = parseEasternDateTime("2026-01-15T00:00:00");
        // Midnight Eastern = 5 AM UTC
        expect(result.toISOString()).toBe("2026-01-15T05:00:00.000Z");
      });

      it("should handle noon correctly in winter", () => {
        const result = parseEasternDateTime("2026-02-20T12:00:00");
        // Noon Eastern = 5 PM UTC
        expect(result.toISOString()).toBe("2026-02-20T17:00:00.000Z");
      });

      it("should handle early morning in winter", () => {
        const result = parseEasternDateTime("2026-12-25T06:30:00");
        // 6:30 AM Eastern = 11:30 AM UTC
        expect(result.toISOString()).toBe("2026-12-25T11:30:00.000Z");
      });
    });

    describe("during EDT (Daylight Time, Mar-Nov)", () => {
      // July is EDT (UTC-4)
      it("should add 4 hours to convert Eastern to UTC in summer", () => {
        // User says 7:43 PM Eastern on Jul 15
        const result = parseEasternDateTime("2026-07-15T19:43:00");
        // Should be 7:43 PM + 4 hours = 11:43 PM UTC
        expect(result.toISOString()).toBe("2026-07-15T23:43:00.000Z");
      });

      it("should handle midnight correctly in summer", () => {
        const result = parseEasternDateTime("2026-06-01T00:00:00");
        // Midnight Eastern = 4 AM UTC
        expect(result.toISOString()).toBe("2026-06-01T04:00:00.000Z");
      });

      it("should handle noon correctly in summer", () => {
        const result = parseEasternDateTime("2026-08-10T12:00:00");
        // Noon Eastern = 4 PM UTC
        expect(result.toISOString()).toBe("2026-08-10T16:00:00.000Z");
      });

      it("should handle late evening in summer", () => {
        const result = parseEasternDateTime("2026-05-20T23:30:00");
        // 11:30 PM Eastern = 3:30 AM UTC next day
        expect(result.toISOString()).toBe("2026-05-21T03:30:00.000Z");
      });
    });

    describe("DST transition dates", () => {
      // 2026 DST: starts March 8, ends November 1

      it("should use EST just before DST starts (March 7)", () => {
        const result = parseEasternDateTime("2026-03-07T23:00:00");
        // Still EST (UTC-5): 11 PM + 5 = 4 AM next day
        expect(result.toISOString()).toBe("2026-03-08T04:00:00.000Z");
      });

      it("should use EDT just after DST starts (March 8)", () => {
        const result = parseEasternDateTime("2026-03-08T12:00:00");
        // Now EDT (UTC-4): 12 PM + 4 = 4 PM
        expect(result.toISOString()).toBe("2026-03-08T16:00:00.000Z");
      });

      it("should use EDT just before DST ends (October 31)", () => {
        const result = parseEasternDateTime("2026-10-31T23:00:00");
        // Still EDT (UTC-4): 11 PM + 4 = 3 AM next day
        expect(result.toISOString()).toBe("2026-11-01T03:00:00.000Z");
      });

      it("should use EST just after DST ends (November 1)", () => {
        const result = parseEasternDateTime("2026-11-01T12:00:00");
        // Now EST (UTC-5): 12 PM + 5 = 5 PM
        expect(result.toISOString()).toBe("2026-11-01T17:00:00.000Z");
      });
    });
  });

  describe("edge cases", () => {
    it("should handle date without time component", () => {
      const result = parseEasternDateTime("2026-01-02");
      // Should default to midnight Eastern
      expect(result.toISOString()).toBe("2026-01-02T05:00:00.000Z");
    });

    it("should handle time with milliseconds", () => {
      const result = parseEasternDateTime("2026-01-02T19:43:00.123");
      // Should strip milliseconds and parse correctly
      expect(result.toISOString()).toBe("2026-01-03T00:43:00.000Z");
    });

    it("should handle time with seconds omitted", () => {
      const result = parseEasternDateTime("2026-01-02T19:43");
      expect(result.toISOString()).toBe("2026-01-03T00:43:00.000Z");
    });
  });

  describe("real-world LLM scenarios", () => {
    it('should correctly parse "remind me in 10 minutes" at 7:33 PM Eastern in January', () => {
      // User asks at 7:33 PM Eastern on Jan 2
      // LLM generates 7:43 PM (10 minutes later) without timezone
      const result = parseEasternDateTime("2026-01-02T19:43:00");

      // Result should be 7:43 PM Eastern = 00:43 UTC on Jan 3
      expect(result.toISOString()).toBe("2026-01-03T00:43:00.000Z");

      // Verify this is in the future relative to 7:33 PM Eastern (00:33 UTC)
      const userAskedAt = new Date("2026-01-03T00:33:00.000Z");
      expect(result.getTime()).toBeGreaterThan(userAskedAt.getTime());
    });

    it('should correctly parse "remind me at 6pm tonight" in summer', () => {
      // User in July asks for 6 PM reminder
      const result = parseEasternDateTime("2026-07-15T18:00:00");

      // 6 PM Eastern in July (EDT) = 10 PM UTC
      expect(result.toISOString()).toBe("2026-07-15T22:00:00.000Z");
    });

    it('should correctly parse "remind me tomorrow at 9am" in winter', () => {
      // User asks for 9 AM reminder on Jan 3
      const result = parseEasternDateTime("2026-01-03T09:00:00");

      // 9 AM Eastern in January (EST) = 2 PM UTC
      expect(result.toISOString()).toBe("2026-01-03T14:00:00.000Z");
    });
  });
});

describe("isEasternDST", () => {
  it("should return false in January (EST)", () => {
    const date = new Date("2026-01-15T12:00:00Z");
    expect(isEasternDST(date)).toBe(false);
  });

  it("should return true in July (EDT)", () => {
    const date = new Date("2026-07-15T12:00:00Z");
    expect(isEasternDST(date)).toBe(true);
  });

  it("should return false in December (EST)", () => {
    const date = new Date("2026-12-25T12:00:00Z");
    expect(isEasternDST(date)).toBe(false);
  });

  it("should return true in June (EDT)", () => {
    const date = new Date("2026-06-01T12:00:00Z");
    expect(isEasternDST(date)).toBe(true);
  });
});

describe("formatEastern", () => {
  it("should format date in Eastern time", () => {
    // 5 PM UTC = 12 PM Eastern (EST)
    const date = new Date("2026-01-15T17:00:00Z");
    const result = formatEastern(date, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    expect(result).toBe("12:00 PM");
  });

  it("should format date with full options", () => {
    const date = new Date("2026-07-04T16:00:00Z");
    const result = formatEastern(date, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    // 4 PM UTC = 12 PM EDT on July 4
    expect(result).toContain("July");
    expect(result).toContain("4");
    expect(result).toContain("2026");
    expect(result).toContain("12:00");
  });
});
