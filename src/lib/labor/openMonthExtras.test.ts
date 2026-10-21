import { describe, expect, it } from "vitest";
import { laborSubcategoryIds, sumOpenMonthLaborExtras } from "./openMonthExtras";

const categories = [
  { id: "labor", name: "עלויות עובדים", parent_id: null },
  { id: "labor2", name: "עלות עובדים", parent_id: null },
  { id: "extra", name: 'עלויות כ"א נוספות', parent_id: "labor" },
  { id: "foreign", name: "עובדים זרים", parent_id: "labor2" },
  { id: "ops", name: "הוצאות תפעול", parent_id: null },
  { id: "rent", name: "שכירות", parent_id: "ops" },
];

describe("laborSubcategoryIds", () => {
  it("returns subcategories of every top-level labor parent only", () => {
    expect(laborSubcategoryIds(categories)).toEqual(new Set(["extra", "foreign"]));
  });

  it("ignores a labor-named category that is itself a subcategory", () => {
    const nested = [
      { id: "ops", name: "הוצאות תפעול", parent_id: null },
      { id: "fake", name: "עלות עובדים", parent_id: "ops" },
      { id: "child", name: "x", parent_id: "fake" },
    ];
    expect(laborSubcategoryIds(nested).size).toBe(0);
  });
});

describe("sumOpenMonthLaborExtras", () => {
  const ids = laborSubcategoryIds(categories);

  it("counts employee_costs invoices under a labor subcategory", () => {
    const invoices = [
      { subtotal: 100000, supplier: { expense_type: "employee_costs", expense_category_id: "extra" } },
      { subtotal: "500", supplier: { expense_type: "employee_costs", expense_category_id: "foreign" } },
    ];
    expect(sumOpenMonthLaborExtras(invoices, ids)).toBe(100500);
  });

  it("skips current_expenses suppliers, already counted as current expenses", () => {
    const invoices = [{ subtotal: 300, supplier: { expense_type: "current_expenses", expense_category_id: "extra" } }];
    expect(sumOpenMonthLaborExtras(invoices, ids)).toBe(0);
  });

  it("skips employee_costs suppliers with no category or a parent-level category", () => {
    const invoices = [
      { subtotal: 100, supplier: { expense_type: "employee_costs", expense_category_id: null } },
      { subtotal: 200, supplier: { expense_type: "employee_costs", expense_category_id: "labor" } },
      { subtotal: 400, supplier: { expense_type: "employee_costs", expense_category_id: "rent" } },
      { subtotal: 800, supplier: null },
    ];
    expect(sumOpenMonthLaborExtras(invoices, ids)).toBe(0);
  });

  it("skips invoices created by a month close", () => {
    const invoices = [
      { subtotal: 4000, labor_close_id: "close-1", supplier: { expense_type: "employee_costs", expense_category_id: "foreign" } },
    ];
    expect(sumOpenMonthLaborExtras(invoices, ids)).toBe(0);
  });

  it("lets a credit note reduce the total", () => {
    const invoices = [
      { subtotal: 1000, supplier: { expense_type: "employee_costs", expense_category_id: "extra" } },
      { subtotal: -250, supplier: { expense_type: "employee_costs", expense_category_id: "extra" } },
    ];
    expect(sumOpenMonthLaborExtras(invoices, ids)).toBe(750);
  });
});
