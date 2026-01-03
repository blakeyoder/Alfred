import { createReservationTools } from "./reservations.js";
import type { ToolContext } from "./reminders.js";
import type { ToolExecutionOptions } from "ai";

describe("createReservationTools", () => {
  const mockCtx: ToolContext = {
    session: {
      userId: "user-1",
      coupleId: "couple-1",
      coupleName: "Test Couple",
      userName: "Test User",
      partnerName: "Partner",
      threadId: "thread-1",
      visibility: "shared",
    },
  };

  const tools = createReservationTools(mockCtx, "partner-1");

  // Mock ToolExecutionOptions - not used by our tools but required by type
  const mockOptions: ToolExecutionOptions = {
    toolCallId: "test-call-id",
    messages: [],
    abortSignal: undefined as unknown as AbortSignal,
  };

  describe("generateReservationLink", () => {
    const executeRaw = tools.generateReservationLink.execute!;
    const execute = async (input: Parameters<typeof executeRaw>[0]) => {
      const result = await executeRaw(input, mockOptions);
      // Tool doesn't stream, so cast to object result
      return result as Exclude<
        Awaited<ReturnType<typeof executeRaw>>,
        AsyncIterable<unknown>
      >;
    };

    describe("Resy URLs", () => {
      it("generates link from resy.com/cities/{city}/venues/{slug}", async () => {
        const result = await execute({
          restaurantUrl: "https://resy.com/cities/ny/venues/carbone",
          date: "2026-02-14",
          time: "19:00",
          partySize: 2,
        });

        expect(result.success).toBe(true);
        expect(result.platform).toBe("Resy");
        expect(result.bookingLink).toContain(
          "resy.com/cities/ny/venues/carbone"
        );
        expect(result.bookingLink).toContain("date=2026-02-14");
        expect(result.bookingLink).toContain("seats=2");
      });

      it("handles Resy URL with existing query params", async () => {
        const result = await execute({
          restaurantUrl: "https://resy.com/cities/la/venues/bestia?ref=google",
          date: "2026-03-01",
          time: "20:00",
          partySize: 4,
        });

        expect(result.success).toBe(true);
        expect(result.bookingLink).toContain("date=2026-03-01");
        expect(result.bookingLink).toContain("seats=4");
        // Original query params should be stripped
        expect(result.bookingLink).not.toContain("ref=google");
      });

      it("handles Resy URL without cities pattern (fallback)", async () => {
        const result = await execute({
          restaurantUrl: "https://resy.com/some-other-path/restaurant",
          date: "2026-01-15",
          time: "18:30",
          partySize: 3,
        });

        expect(result.success).toBe(true);
        expect(result.platform).toBe("Resy");
      });
    });

    describe("OpenTable URLs", () => {
      it("generates link from opentable.com/r/{slug}", async () => {
        const result = await execute({
          restaurantUrl: "https://www.opentable.com/r/the-french-laundry",
          date: "2026-04-20",
          time: "18:00",
          partySize: 2,
        });

        expect(result.success).toBe(true);
        expect(result.platform).toBe("OpenTable");
        expect(result.bookingLink).toContain("covers=2");
        // Colon is URL-encoded as %3A
        expect(result.bookingLink).toMatch(/dateTime=2026-04-20T18(:00|%3A00)/);
      });

      it("generates link from opentable.com/{slug} without /r prefix", async () => {
        const result = await execute({
          restaurantUrl: "https://www.opentable.com/eleven-madison-park",
          date: "2026-05-10",
          time: "19:30",
          partySize: 4,
        });

        expect(result.success).toBe(true);
        expect(result.platform).toBe("OpenTable");
        expect(result.bookingLink).toContain("covers=4");
      });
    });

    describe("Tock URLs", () => {
      it("generates link from exploretock.com/{slug}", async () => {
        const result = await execute({
          restaurantUrl: "https://www.exploretock.com/alinea",
          date: "2026-06-15",
          time: "17:30",
          partySize: 2,
        });

        expect(result.success).toBe(true);
        expect(result.platform).toBe("Tock");
        expect(result.bookingLink).toContain("exploretock.com/alinea");
        expect(result.bookingLink).toContain("date=2026-06-15");
        expect(result.bookingLink).toContain("size=2");
        // Colon is URL-encoded as %3A
        expect(result.bookingLink).toMatch(/time=17(:30|%3A30)/);
      });

      it("handles tock.com domain", async () => {
        const result = await execute({
          restaurantUrl: "https://www.tock.com/noma",
          date: "2026-07-01",
          time: "20:00",
          partySize: 6,
        });

        expect(result.success).toBe(true);
        expect(result.platform).toBe("Tock");
      });
    });

    describe("unsupported platforms", () => {
      it("returns error for unknown domains", async () => {
        const result = await execute({
          restaurantUrl: "https://www.yelp.com/biz/some-restaurant",
          date: "2026-01-01",
          time: "19:00",
          partySize: 2,
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("Resy, OpenTable, or Tock");
        expect(result.originalUrl).toBe(
          "https://www.yelp.com/biz/some-restaurant"
        );
      });

      it("returns error for random websites", async () => {
        const result = await execute({
          restaurantUrl: "https://restaurant-website.com/reservations",
          date: "2026-01-01",
          time: "19:00",
          partySize: 2,
        });

        expect(result.success).toBe(false);
      });
    });

    describe("invalid URLs", () => {
      it("returns error for malformed URL", async () => {
        const result = await execute({
          restaurantUrl: "not-a-url",
          date: "2026-01-01",
          time: "19:00",
          partySize: 2,
        });

        expect(result.success).toBe(false);
        expect(result.message).toBeDefined();
      });
    });

    describe("result structure", () => {
      it("includes all expected fields on success", async () => {
        const result = await execute({
          restaurantUrl: "https://resy.com/cities/ny/venues/test",
          date: "2026-01-15",
          time: "19:00",
          partySize: 2,
        });

        expect(result).toMatchObject({
          success: true,
          platform: expect.any(String),
          bookingLink: expect.any(String),
          date: "2026-01-15",
          time: "19:00",
          partySize: 2,
          instructions: expect.any(String),
        });
      });

      it("includes platform-specific instructions", async () => {
        const resyResult = await execute({
          restaurantUrl: "https://resy.com/cities/ny/venues/test",
          date: "2026-01-15",
          time: "19:00",
          partySize: 2,
        });
        expect(resyResult.instructions).toContain("Resy");

        const otResult = await execute({
          restaurantUrl: "https://opentable.com/test",
          date: "2026-01-15",
          time: "19:00",
          partySize: 2,
        });
        expect(otResult.instructions).toContain("OpenTable");
      });
    });
  });

  describe("detectReservationPlatform", () => {
    const executeRaw = tools.detectReservationPlatform.execute!;
    const execute = async (input: Parameters<typeof executeRaw>[0]) => {
      const result = await executeRaw(input, mockOptions);
      // Tool doesn't stream, so cast to object result
      return result as Exclude<
        Awaited<ReturnType<typeof executeRaw>>,
        AsyncIterable<unknown>
      >;
    };

    it("returns search suggestion with restaurant and city", async () => {
      const result = await execute({
        restaurantName: "Carbone",
        city: "New York",
      });

      expect(result.success).toBe(true);
      expect(result.suggestion).toContain("Carbone");
      expect(result.suggestion).toContain("New York");
      expect(result.suggestion).toContain("site:resy.com");
      expect(result.suggestion).toContain("site:opentable.com");
      expect(result.suggestion).toContain("site:exploretock.com");
    });

    it("returns platform URL patterns", async () => {
      const result = await execute({
        restaurantName: "Test",
        city: "LA",
      });

      expect(result.platforms).toEqual([
        { name: "Resy", urlPattern: "resy.com/cities/*/venues/*" },
        { name: "OpenTable", urlPattern: "opentable.com/r/*" },
        { name: "Tock", urlPattern: "exploretock.com/*" },
      ]);
    });

    it("includes usage note about generateReservationLink", async () => {
      const result = await execute({
        restaurantName: "Test",
        city: "Chicago",
      });

      expect(result.note).toContain("generateReservationLink");
    });
  });
});
