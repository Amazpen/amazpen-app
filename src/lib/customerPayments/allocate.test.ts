import { describe, it, expect } from "vitest";
import {
  allocateCustomerPayment,
  grossToNet,
  netToGross,
  type AllocatedRow,
  type InstallmentInput,
  type OpenMonth,
} from "./allocate";

// ---------------------------------------------------------------------------
// Helpers (test-local, no shared mutable state)
// ---------------------------------------------------------------------------

const VAT = 0.18;

function month(year: number, month: number, openNet: number): OpenMonth {
  return { year, month, openNet };
}

function inst(
  amountGross: number,
  overrides: Partial<InstallmentInput> = {}
): InstallmentInput {
  return {
    paymentMethod: "transfer",
    date: "2026-09-15",
    amountGross,
    installmentsCount: 1,
    installmentNumber: 1,
    ...overrides,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumNet(rows: AllocatedRow[]): number {
  return round2(rows.reduce((acc, r) => acc + r.amountNet, 0));
}

function isTwoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function rowsOf(rows: AllocatedRow[], installmentNumber: number): AllocatedRow[] {
  return rows.filter((r) => r.installmentNumber === installmentNumber);
}

// ---------------------------------------------------------------------------
// grossToNet / netToGross
// ---------------------------------------------------------------------------

describe("grossToNet", () => {
  it("strips 18% VAT from a gross amount and rounds to 2 decimals", () => {
    expect(grossToNet(118, VAT)).toBe(100);
    expect(grossToNet(100, VAT)).toBe(84.75); // 84.7457... -> 84.75
  });

  it("converts the David gross 6490 to exactly 5500 net at 18%", () => {
    expect(grossToNet(6490, VAT)).toBe(5500);
  });

  it("is the identity when vatRate is 0 (foreign customer)", () => {
    expect(grossToNet(1234.56, 0)).toBe(1234.56);
  });

  it("treats non-finite or negative gross as 0", () => {
    expect(grossToNet(NaN, VAT)).toBe(0);
    expect(grossToNet(Infinity, VAT)).toBe(0);
    expect(grossToNet(-100, VAT)).toBe(0);
  });
});

describe("netToGross", () => {
  it("adds 18% VAT to a net amount and rounds to 2 decimals", () => {
    expect(netToGross(100, VAT)).toBe(118);
    expect(netToGross(5500, VAT)).toBe(6490);
    expect(netToGross(84.75, VAT)).toBe(100.01); // 100.005 -> 100.01
  });

  it("is the identity when vatRate is 0", () => {
    expect(netToGross(999.99, 0)).toBe(999.99);
  });

  it("treats non-finite or negative net as 0", () => {
    expect(netToGross(NaN, VAT)).toBe(0);
    expect(netToGross(-1, VAT)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// allocateCustomerPayment - happy path
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - happy path", () => {
  it("David scenario: Jan 2026 open 5500 net, one 6490 gross installment paid 2026-09-15 => single row", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 5500)],
      [inst(6490, { date: "2026-09-15", paymentMethod: "transfer" })],
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      year: 2026,
      month: 0,
      billingMonth: "2026-01-01",
      paymentDate: "2026-09-15",
      amountNet: 5500,
      paymentMethod: "transfer",
      installmentsCount: 1,
      installmentNumber: 1,
    });
  });

  it("foreign customer (vatRate 0): net equals gross, one row for the covered month", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 3, 1000)],
      [inst(1000, { paymentMethod: "wire", date: "2026-04-02" })],
      0
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].amountNet).toBe(1000);
    expect(rows[0].billingMonth).toBe("2026-04-01");
    expect(rows[0].paymentDate).toBe("2026-04-02");
    expect(rows[0].paymentMethod).toBe("wire");
  });

  it("copies paymentMethod, installmentsCount and installmentNumber through to every row", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 100), month(2026, 1, 100)],
      [
        inst(236, {
          paymentMethod: "credit_card",
          installmentsCount: 4,
          installmentNumber: 3,
          date: "2026-05-05",
        }),
      ],
      VAT
    );

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.paymentMethod).toBe("credit_card");
      expect(r.installmentsCount).toBe(4);
      expect(r.installmentNumber).toBe(3);
      expect(r.paymentDate).toBe("2026-05-05");
    }
  });
});

// ---------------------------------------------------------------------------
// Waterfall shapes
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - waterfall", () => {
  it("3 months + 1 installment covering 2.5 months: fills first two, partial on the third", () => {
    // net = 2950 / 1.18 = 2500
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000), month(2026, 1, 1000), month(2026, 2, 1000)],
      [inst(2950)],
      VAT
    );

    expect(rows.map((r) => [r.billingMonth, r.amountNet])).toEqual([
      ["2026-01-01", 1000],
      ["2026-02-01", 1000],
      ["2026-03-01", 500],
    ]);
    expect(sumNet(rows)).toBe(2500);
  });

  it("1 month + 3 installments: each installment gets its own row against the same month", () => {
    // 3 x (1180 gross => 1000 net) against 3000 open
    const rows = allocateCustomerPayment(
      [month(2026, 5, 3000)],
      [
        inst(1180, { installmentsCount: 3, installmentNumber: 1, date: "2026-06-01" }),
        inst(1180, { installmentsCount: 3, installmentNumber: 2, date: "2026-07-01" }),
        inst(1180, { installmentsCount: 3, installmentNumber: 3, date: "2026-08-01" }),
      ],
      VAT
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.paymentDate)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
    for (const r of rows) {
      expect(r.billingMonth).toBe("2026-06-01");
      expect(r.amountNet).toBe(1000);
      expect(r.installmentsCount).toBe(3);
    }
  });

  it("2 months + 2 installments crossing a month boundary", () => {
    // inst1 net 1500 => Jan 1000 + Feb 500 ; inst2 net 500 => Feb 500
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000), month(2026, 1, 1000)],
      [
        inst(1770, { installmentsCount: 2, installmentNumber: 1, date: "2026-03-01" }),
        inst(590, { installmentsCount: 2, installmentNumber: 2, date: "2026-04-01" }),
      ],
      VAT
    );

    expect(rows).toHaveLength(3);

    const first = rowsOf(rows, 1);
    expect(first.map((r) => [r.billingMonth, r.amountNet, r.paymentDate])).toEqual([
      ["2026-01-01", 1000, "2026-03-01"],
      ["2026-02-01", 500, "2026-03-01"],
    ]);

    const second = rowsOf(rows, 2);
    expect(second.map((r) => [r.billingMonth, r.amountNet, r.paymentDate])).toEqual([
      ["2026-02-01", 500, "2026-04-01"],
    ]);
  });

  it("does not emit a row for a month that received nothing", () => {
    // net 1000 exactly fills Jan; Feb and Mar must have no rows
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000), month(2026, 1, 1000), month(2026, 2, 1000)],
      [inst(1180)],
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].billingMonth).toBe("2026-01-01");
    expect(rows[0].amountNet).toBe(1000);
  });

  it("an installment with zero gross produces no rows but does not block later installments", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000)],
      [
        inst(0, { installmentsCount: 2, installmentNumber: 1 }),
        inst(1180, { installmentsCount: 2, installmentNumber: 2 }),
      ],
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].installmentNumber).toBe(2);
    expect(rows[0].amountNet).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Overpayment
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - overpayment", () => {
  it("excess beyond total open is added to the newest eligible month row (single installment)", () => {
    // net 3000 against 1000 + 1000 => Jan 1000, Feb 2000
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000), month(2026, 1, 1000)],
      [inst(3540)],
      VAT
    );

    expect(rows.map((r) => [r.billingMonth, r.amountNet])).toEqual([
      ["2026-01-01", 1000],
      ["2026-02-01", 2000],
    ]);
    expect(sumNet(rows)).toBe(3000);
  });

  it("with a single open month, overpayment lands on that month in one row", () => {
    const rows = allocateCustomerPayment([month(2026, 0, 1000)], [inst(1770)], VAT);

    expect(rows).toHaveLength(1);
    expect(rows[0].billingMonth).toBe("2026-01-01");
    expect(rows[0].amountNet).toBe(1500);
  });

  it("a later installment arriving after everything is covered is still allocated to the newest month (never dropped)", () => {
    // inst1 net 1000 fills Jan; inst2 net 500 has nothing open left
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000)],
      [
        inst(1180, { installmentsCount: 2, installmentNumber: 1 }),
        inst(590, { installmentsCount: 2, installmentNumber: 2 }),
      ],
      VAT
    );

    expect(sumNet(rows)).toBe(1500);
    const second = rowsOf(rows, 2);
    expect(second).toHaveLength(1);
    expect(second[0].billingMonth).toBe("2026-01-01");
    expect(second[0].amountNet).toBe(500);
  });

  it("overpayment goes to the newest month even when months were given in unsorted order", () => {
    // newest = Mar 2026, listed first in input
    const rows = allocateCustomerPayment(
      [month(2026, 2, 100), month(2026, 0, 100)],
      [inst(590)], // net 500 against 200 open => Jan 100, Mar 400
      VAT
    );

    expect(rows.map((r) => [r.billingMonth, r.amountNet])).toEqual([
      ["2026-01-01", 100],
      ["2026-03-01", 400],
    ]);
  });

  it("overpayment skips months with non-positive openNet when choosing the newest month", () => {
    // Apr has openNet 0 so it is not eligible; newest eligible is Mar
    const rows = allocateCustomerPayment(
      [month(2026, 2, 100), month(2026, 3, 0)],
      [inst(236)], // net 200
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].billingMonth).toBe("2026-03-01");
    expect(rows[0].amountNet).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Ordering / skipping / empties
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - month ordering and eligibility", () => {
  it("processes months oldest-first regardless of input order", () => {
    // input: Mar, Jan, Feb ; net 1500 => Jan 1000, Feb 500 (Mar untouched)
    const rows = allocateCustomerPayment(
      [month(2026, 2, 1000), month(2026, 0, 1000), month(2026, 1, 1000)],
      [inst(1770)],
      VAT
    );

    expect(rows.map((r) => [r.billingMonth, r.amountNet])).toEqual([
      ["2026-01-01", 1000],
      ["2026-02-01", 500],
    ]);
  });

  it("orders by year before month (Dec 2025 comes before Jan 2026)", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 100), month(2025, 11, 100)],
      [inst(177)], // net 150 => Dec 2025 100, Jan 2026 50
      VAT
    );

    expect(rows.map((r) => [r.year, r.month, r.billingMonth, r.amountNet])).toEqual([
      [2025, 11, "2025-12-01", 100],
      [2026, 0, "2026-01-01", 50],
    ]);
  });

  it("skips months with zero or negative openNet", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 0), month(2026, 1, -50), month(2026, 2, 1000)],
      [inst(1180)], // net 1000
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].billingMonth).toBe("2026-03-01");
    expect(rows[0].amountNet).toBe(1000);
  });

  it("treats a month with a non-finite openNet as 0 and skips it", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, NaN), month(2026, 1, 500)],
      [inst(590)], // net 500
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].billingMonth).toBe("2026-02-01");
    expect(rows[0].amountNet).toBe(500);
  });

  it("returns [] when there are no months", () => {
    expect(allocateCustomerPayment([], [inst(1180)], VAT)).toEqual([]);
  });

  it("returns [] when every month has non-positive openNet (money is not silently assigned)", () => {
    expect(
      allocateCustomerPayment([month(2026, 0, 0), month(2026, 1, -1)], [inst(1180)], VAT)
    ).toEqual([]);
  });

  it("returns [] when there are no installments", () => {
    expect(allocateCustomerPayment([month(2026, 0, 1000)], [], VAT)).toEqual([]);
  });

  it("zero-pads billingMonth for single-digit months and uses day 01", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 10), month(2026, 8, 10), month(2026, 9, 10), month(2026, 11, 10)],
      [inst(47.2)], // net 40 => fills all four
      VAT
    );

    expect(rows.map((r) => r.billingMonth)).toEqual([
      "2026-01-01",
      "2026-09-01",
      "2026-10-01",
      "2026-12-01",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - rounding", () => {
  it("gross 100 at 18% becomes 84.75 net in the allocated row", () => {
    const rows = allocateCustomerPayment([month(2026, 0, 500)], [inst(100)], VAT);

    expect(rows).toHaveLength(1);
    expect(rows[0].amountNet).toBe(84.75);
  });

  it("3-way split with awkward decimals: every row has 2 decimals and the rows sum exactly to the net", () => {
    // net 84.75 against 33.33 / 33.33 / 33.33 => 33.33, 33.33, 18.09
    const rows = allocateCustomerPayment(
      [month(2026, 0, 33.33), month(2026, 1, 33.33), month(2026, 2, 33.33)],
      [inst(100)],
      VAT
    );

    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(isTwoDecimals(r.amountNet)).toBe(true);
    }
    expect(rows.map((r) => r.amountNet)).toEqual([33.33, 33.33, 18.09]);
    expect(sumNet(rows)).toBe(84.75);
  });

  it("net with rounding from VAT division (1000 at 17% => 854.7) splits and sums exactly", () => {
    // 1000 / 1.17 = 854.7008... => 854.7 ; against 300/300/300 => 300, 300, 254.7
    const rows = allocateCustomerPayment(
      [month(2026, 0, 300), month(2026, 1, 300), month(2026, 2, 300)],
      [inst(1000)],
      0.17
    );

    expect(rows.map((r) => r.amountNet)).toEqual([300, 300, 254.7]);
    expect(sumNet(rows)).toBe(854.7);
    expect(sumNet(rows)).toBe(grossToNet(1000, 0.17));
  });

  it("last row absorbs the remainder for each installment across multiple installments", () => {
    // Two installments of 33.33 gross at vat 0 against 10.01 / 10.02 / 100
    // inst1 => 10.01, 10.02, 13.30 (sum 33.33)
    // inst2 => 33.33 on Mar (remaining 86.70 open)
    const rows = allocateCustomerPayment(
      [month(2026, 0, 10.01), month(2026, 1, 10.02), month(2026, 2, 100)],
      [
        inst(33.33, { installmentsCount: 2, installmentNumber: 1 }),
        inst(33.33, { installmentsCount: 2, installmentNumber: 2 }),
      ],
      0
    );

    const first = rowsOf(rows, 1);
    expect(first.map((r) => r.amountNet)).toEqual([10.01, 10.02, 13.3]);
    expect(sumNet(first)).toBe(33.33);

    const second = rowsOf(rows, 2);
    expect(second.map((r) => [r.billingMonth, r.amountNet])).toEqual([["2026-03-01", 33.33]]);
    expect(sumNet(second)).toBe(33.33);

    for (const r of rows) {
      expect(isTwoDecimals(r.amountNet)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Garbage-in: non-finite / negative amounts
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - invalid amounts", () => {
  it("NaN amountGross is treated as 0 => no rows", () => {
    expect(allocateCustomerPayment([month(2026, 0, 1000)], [inst(NaN)], VAT)).toEqual([]);
  });

  it("Infinity amountGross is treated as 0 => no rows", () => {
    expect(allocateCustomerPayment([month(2026, 0, 1000)], [inst(Infinity)], VAT)).toEqual([]);
  });

  it("negative amountGross is treated as 0 => no rows", () => {
    expect(allocateCustomerPayment([month(2026, 0, 1000)], [inst(-500)], VAT)).toEqual([]);
  });

  it("an invalid installment does not affect a valid one in the same call", () => {
    const rows = allocateCustomerPayment(
      [month(2026, 0, 1000)],
      [
        inst(NaN, { installmentsCount: 2, installmentNumber: 1 }),
        inst(590, { installmentsCount: 2, installmentNumber: 2 }),
      ],
      VAT
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].installmentNumber).toBe(2);
    expect(rows[0].amountNet).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Purity / regression guards
// ---------------------------------------------------------------------------

describe("allocateCustomerPayment - purity (regression guard)", () => {
  it("does not mutate the months or installments passed in (order, openNet, or amounts)", () => {
    const months = [month(2026, 2, 1000), month(2026, 0, 1000), month(2026, 1, 1000)];
    const installments = [inst(1770), inst(590, { installmentNumber: 2, installmentsCount: 2 })];
    const monthsSnapshot = JSON.stringify(months);
    const installmentsSnapshot = JSON.stringify(installments);

    allocateCustomerPayment(months, installments, VAT);

    expect(JSON.stringify(months)).toBe(monthsSnapshot);
    expect(JSON.stringify(installments)).toBe(installmentsSnapshot);
  });

  it("is deterministic: calling twice with the same input yields identical output", () => {
    const months = [month(2026, 0, 33.33), month(2026, 1, 33.33), month(2026, 2, 33.33)];
    const installments = [inst(100), inst(50, { installmentNumber: 2, installmentsCount: 2 })];

    const a = allocateCustomerPayment(months, installments, VAT);
    const b = allocateCustomerPayment(months, installments, VAT);

    expect(a).toEqual(b);
  });

  it("grossToNet and netToGross round-trip exactly for the David amounts", () => {
    expect(netToGross(grossToNet(6490, VAT), VAT)).toBe(6490);
    expect(grossToNet(netToGross(5500, VAT), VAT)).toBe(5500);
  });
});
