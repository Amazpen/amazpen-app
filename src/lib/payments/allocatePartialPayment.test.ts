import { describe, it, expect } from "vitest";
import { allocatePartialPayment } from "./allocatePartialPayment";

const inv = (id: string, balance: number) => ({ id, balance });

describe("allocatePartialPayment", () => {
  it("closes oldest in full and leaves one partial", () => {
    // oldest -> newest: 100, 200, 300 ; pay 250
    const r = allocatePartialPayment([inv("a", 100), inv("b", 200), inv("c", 300)], 250);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBe("b");
    expect(r.lines).toEqual([
      { invoice_id: "a", amount_allocated: 100, new_status: "paid", remaining_balance: 0 },
      { invoice_id: "b", amount_allocated: 150, new_status: "partial", remaining_balance: 50 },
    ]);
    expect(r.totalAllocated).toBe(250);
    expect(r.overpay).toBe(0);
  });

  it("marks all paid when amount equals sum (no partial)", () => {
    const r = allocatePartialPayment([inv("a", 100), inv("b", 200)], 300);
    expect(r.fullyPaidIds).toEqual(["a", "b"]);
    expect(r.partialId).toBeNull();
    expect(r.overpay).toBe(0);
  });

  it("marks only the oldest partial when amount is below the first balance", () => {
    const r = allocatePartialPayment([inv("a", 100), inv("b", 200)], 40);
    expect(r.fullyPaidIds).toEqual([]);
    expect(r.partialId).toBe("a");
    expect(r.lines).toEqual([
      { invoice_id: "a", amount_allocated: 40, new_status: "partial", remaining_balance: 60 },
    ]);
  });

  it("reports overpay and does not allocate beyond balances", () => {
    const r = allocatePartialPayment([inv("a", 100)], 130);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBeNull();
    expect(r.totalAllocated).toBe(100);
    expect(r.overpay).toBeCloseTo(30, 5);
  });

  it("treats sub-agora rounding as a full close", () => {
    const r = allocatePartialPayment([inv("a", 100)], 99.999);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBeNull();
    expect(r.lines[0].amount_allocated).toBe(100);
  });
});
