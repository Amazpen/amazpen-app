import { describe, it, expect } from "vitest";
import { addOneMonthClamped, isDueOn } from "./dates";

describe("addOneMonthClamped", () => {
  it("advances a normal mid-month date by one month", () => {
    expect(addOneMonthClamped("2026-01-15", 15)).toBe("2026-02-15");
  });
  it("clamps day 31 to the last day of a short month", () => {
    expect(addOneMonthClamped("2026-01-31", 31)).toBe("2026-02-28");
  });
  it("clamps day 31 to 30 for a 30-day month", () => {
    expect(addOneMonthClamped("2026-03-31", 31)).toBe("2026-04-30");
  });
  it("restores the original day_of_month after a clamp", () => {
    // Jan31 -> Feb28 -> Mar31 (not Mar28)
    expect(addOneMonthClamped("2026-02-28", 31)).toBe("2026-03-31");
  });
  it("rolls over the year in December", () => {
    expect(addOneMonthClamped("2026-12-10", 10)).toBe("2027-01-10");
  });
});

describe("isDueOn", () => {
  it("is due when next_charge_date is on or before today", () => {
    expect(isDueOn("2026-06-08", "2026-06-08")).toBe(true);
    expect(isDueOn("2026-06-07", "2026-06-08")).toBe(true);
  });
  it("is not due when next_charge_date is in the future", () => {
    expect(isDueOn("2026-06-09", "2026-06-08")).toBe(false);
  });
});
