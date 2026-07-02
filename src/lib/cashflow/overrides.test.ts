import { describe, expect, it } from "vitest";
import { applyIncomeOverrides, buildOverrideMap } from "./overrides";
import type { SettledIncome } from "./settlement";

const woltItem = (originalEntryDate: string, gross: number): SettledIncome => ({
  settlement_date: "2026-07-01",
  payment_method_id: "pm-wolt",
  payment_method_name: "וולט",
  original_entry_date: originalEntryDate,
  gross_amount: gross,
  fee_amount: gross * 0.295,
  net_amount: gross * 0.705,
});

describe("income overrides", () => {
  it("overrides ONLY the item with the matching original_entry_date, not siblings", () => {
    // 3 Wolt entry days all settling on the same bank day — the reported bug
    // was that editing one changed all of them.
    const items = [woltItem("2026-06-17", 1630), woltItem("2026-06-18", 2000), woltItem("2026-06-19", 3000)];
    const map = buildOverrideMap([
      {
        settlement_date: "2026-07-01",
        payment_method_id: "pm-wolt",
        original_entry_date: "2026-06-17",
        override_amount: 1485,
        note: "יישור למציאות",
      },
    ]);

    const result = applyIncomeOverrides(items, map, "2026-07-01");

    expect(result[0].net_amount).toBe(1485);
    expect(result[0].fee_amount).toBeCloseTo(1630 - 1485);
    expect(result[0].override_note).toBe("יישור למציאות");
    // siblings untouched
    expect(result[1].net_amount).toBeCloseTo(2000 * 0.705);
    expect(result[1].override_note).toBeUndefined();
    expect(result[2].net_amount).toBeCloseTo(3000 * 0.705);
  });

  it("does not apply overrides from a different settlement date or method", () => {
    const items = [woltItem("2026-06-17", 1630)];
    const map = buildOverrideMap([
      { settlement_date: "2026-08-01", payment_method_id: "pm-wolt", original_entry_date: "2026-06-17", override_amount: 1 },
      { settlement_date: "2026-07-01", payment_method_id: "pm-other", original_entry_date: "2026-06-17", override_amount: 2 },
    ]);

    const result = applyIncomeOverrides(items, map, "2026-07-01");
    expect(result[0].net_amount).toBeCloseTo(1630 * 0.705);
  });

  it("ignores legacy rows without original_entry_date instead of overriding the whole day", () => {
    const items = [woltItem("2026-06-17", 1630), woltItem("2026-06-18", 2000)];
    const map = buildOverrideMap([
      { settlement_date: "2026-07-01", payment_method_id: "pm-wolt", original_entry_date: null, override_amount: 1485 },
    ]);

    const result = applyIncomeOverrides(items, map, "2026-07-01");
    expect(result[0].net_amount).toBeCloseTo(1630 * 0.705);
    expect(result[1].net_amount).toBeCloseTo(2000 * 0.705);
  });

  it("matches DATE values serialized as full timestamps", () => {
    const items = [woltItem("2026-06-17", 1630)];
    const map = buildOverrideMap([
      {
        settlement_date: "2026-07-01T00:00:00.000Z",
        payment_method_id: "pm-wolt",
        original_entry_date: "2026-06-17T00:00:00.000Z",
        override_amount: "1485",
        note: null,
      },
    ]);

    const result = applyIncomeOverrides(items, map, "2026-07-01");
    expect(result[0].net_amount).toBe(1485);
    expect(result[0].override_note).toBeNull();
  });
});
