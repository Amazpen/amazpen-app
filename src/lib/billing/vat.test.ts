import { describe, it, expect } from "vitest";
import { DEFAULT_VAT_PERCENT, round2, computeVat } from "./vat";

describe("round2", () => {
  it("rounds to 2 decimals (agorot) per Math.round(x*100)/100", () => {
    // Matches the exact spec: Math.round(x * 100) / 100. Note 1.005*100 is
    // 100.4999.. in IEEE-754, so it rounds down to 1.0 (documented JS behaviour).
    expect(round2(1.005)).toBe(1.0);
    expect(round2(1.006)).toBe(1.01);
    expect(round2(1.004)).toBe(1.0);
    expect(round2(118)).toBe(118);
    expect(round2(117.999)).toBe(118);
  });
});

describe("computeVat", () => {
  it("net 100 @18 → gross 118, vat 18", () => {
    expect(computeVat(100, 18)).toEqual({
      net: 100,
      vatPercent: 18,
      vatAmount: 18,
      gross: 118,
    });
  });

  it("net 99.99 @18 → correctly rounded gross/vat", () => {
    // 99.99 * 1.18 = 117.9882 → round2 → 117.99 ; vat = 117.99 - 99.99 = 18.00
    expect(computeVat(99.99, 18)).toEqual({
      net: 99.99,
      vatPercent: 18,
      vatAmount: 18,
      gross: 117.99,
    });
  });

  it("net 100 @17 → gross 117, vat 17", () => {
    expect(computeVat(100, 17)).toEqual({
      net: 100,
      vatPercent: 17,
      vatAmount: 17,
      gross: 117,
    });
  });

  it("net 100 @0 → gross = net, vat 0", () => {
    expect(computeVat(100, 0)).toEqual({
      net: 100,
      vatPercent: 0,
      vatAmount: 0,
      gross: 100,
    });
  });

  it("rounds the net input to 2 decimals before computing", () => {
    const r = computeVat(100.005, 18);
    expect(r.net).toBe(100.01);
    expect(r.gross).toBe(round2(100.01 * 1.18));
    expect(r.vatAmount).toBe(round2(r.gross - r.net));
  });

  it("DEFAULT_VAT_PERCENT is 18", () => {
    expect(DEFAULT_VAT_PERCENT).toBe(18);
  });
});
