import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPartialPaymentAllocation } from "./applyPartialPaymentAllocation";
import { allocatePartialPayment } from "./allocatePartialPayment";

/* ------------------------------------------------------------------ *
 * Minimal in-memory fake of the supabase-js query builder.
 * Supports the shapes this module needs:
 *   from(t).select(cols).in(col, vals).is(col, null).neq(col, v).order(...)
 *   from(t).insert(rows)
 *   from(t).update(patch).eq("id", x) / .in("id", [...])
 * The builder is thenable, so `await` works on a partially-built chain.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

type InsertLog = { table: string; rows: Row[] };
type UpdateLog = { table: string; patch: Row; ids: string[] };

function splitTopLevel(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function coerce(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function isNullish(v: unknown) {
  return v === null || v === undefined;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private preds: Array<(r: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private wantSingle = false;
  private headOnly = false;
  private limitN: number | null = null;

  constructor(private db: FakeSupabase, private table: string) {}

  // --- shaping -------------------------------------------------------
  select(_cols?: string, opts?: { head?: boolean; count?: string }) {
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[]) {
    return this.insert(rows);
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  // --- filters -------------------------------------------------------
  eq(col: string, val: unknown) {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.preds.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: unknown) {
    if (val === null) this.preds.push((r) => isNullish(r[col]));
    else this.preds.push((r) => r[col] === val);
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op === "is" && val === null) this.preds.push((r) => !isNullish(r[col]));
    else if (op === "in") this.preds.push((r) => !(val as unknown[]).includes(r[col]));
    else this.preds.push((r) => r[col] !== val);
    return this;
  }
  gt(col: string, val: number) {
    this.preds.push((r) => Number(r[col]) > val);
    return this;
  }
  gte(col: string, val: number) {
    this.preds.push((r) => Number(r[col]) >= val);
    return this;
  }
  lt(col: string, val: number) {
    this.preds.push((r) => Number(r[col]) < val);
    return this;
  }
  lte(col: string, val: number) {
    this.preds.push((r) => Number(r[col]) <= val);
    return this;
  }
  filter(col: string, op: string, val: unknown) {
    if (op === "eq") return this.eq(col, val);
    if (op === "neq") return this.neq(col, val);
    if (op === "is") return this.is(col, val);
    return this;
  }
  or(expr: string) {
    const terms = splitTopLevel(expr).map((t) => {
      const [col, op, ...rest] = t.trim().split(".");
      const raw = rest.join(".");
      const val = coerce(raw);
      return (r: Row) => {
        switch (op) {
          case "is":
            return val === null ? isNullish(r[col]) : r[col] === val;
          case "eq":
            return r[col] === val;
          case "neq":
            return r[col] !== val;
          case "gt":
            return Number(r[col]) > Number(val);
          case "gte":
            return Number(r[col]) >= Number(val);
          case "lt":
            return Number(r[col]) < Number(val);
          case "lte":
            return Number(r[col]) <= Number(val);
          default:
            return false;
        }
      };
    });
    this.preds.push((r) => terms.some((t) => t(r)));
    return this;
  }

  // --- modifiers -----------------------------------------------------
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(_from: number, _to: number) {
    return this;
  }
  single() {
    this.wantSingle = true;
    return this;
  }
  maybeSingle() {
    this.wantSingle = true;
    return this;
  }
  throwOnError() {
    return this;
  }

  // --- execution -----------------------------------------------------
  private matched(): Row[] {
    return this.db.rows(this.table).filter((r) => this.preds.every((p) => p(r)));
  }

  private run(): { data: unknown; error: null; count?: number } {
    if (this.op === "insert") {
      const inserted = this.payload.map((r) => ({ ...r }));
      this.db.rows(this.table).push(...inserted);
      this.db.inserts.push({ table: this.table, rows: inserted.map((r) => ({ ...r })) });
      return { data: inserted, error: null };
    }
    if (this.op === "update") {
      const rows = this.matched();
      this.db.updates.push({
        table: this.table,
        patch: { ...this.patch },
        ids: rows.map((r) => String(r.id)),
      });
      for (const r of rows) Object.assign(r, this.patch);
      return { data: rows, error: null };
    }
    if (this.op === "delete") {
      const rows = this.matched();
      const keep = this.db.rows(this.table).filter((r) => !rows.includes(r));
      this.db.tables[this.table] = keep;
      this.db.deletes.push({ table: this.table, ids: rows.map((r) => String(r.id)) });
      return { data: rows, error: null };
    }
    // select
    let rows = this.matched().map((r) => ({ ...r }));
    if (this.orderCol) {
      const col = this.orderCol;
      rows = rows.slice().sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (this.orderAsc ? 1 : -1);
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.headOnly) return { data: null, error: null, count: rows.length };
    if (this.wantSingle) return { data: rows[0] ?? null, error: null, count: rows.length };
    return { data: rows, error: null, count: rows.length };
  }

  then<TR1 = { data: unknown; error: null }, TR2 = never>(
    onfulfilled?: ((v: { data: unknown; error: null; count?: number }) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null
  ): PromiseLike<TR1 | TR2> {
    let res: { data: unknown; error: null; count?: number };
    try {
      res = this.run();
    } catch (e) {
      return Promise.reject(e).then(onfulfilled as never, onrejected);
    }
    return Promise.resolve(res).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  tables: Tables;
  inserts: InsertLog[] = [];
  updates: UpdateLog[] = [];
  deletes: Array<{ table: string; ids: string[] }> = [];
  fromCalls: string[] = [];

  constructor(tables: Tables) {
    this.tables = tables;
  }
  from(table: string) {
    this.fromCalls.push(table);
    return new FakeQuery(this, table);
  }
  rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }
  get asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

/* --------------------------- seed helpers --------------------------- */

const invoice = (id: string, total: number, date: string, extra: Row = {}): Row => ({
  id,
  total_amount: total,
  invoice_date: date,
  status: "pending",
  amount_paid: null,
  deleted_at: null,
  business_id: "BIZ",
  supplier_id: "SUP",
  ...extra,
});

const payment = (id: string, invoiceId: string | null, total: number, extra: Row = {}): Row => ({
  id,
  invoice_id: invoiceId,
  total_amount: total,
  payment_date: "2026-05-01",
  deleted_at: null,
  business_id: "BIZ",
  ...extra,
});

const link = (paymentId: string, invoiceId: string, amount: number): Row => ({
  id: `L-${paymentId}-${invoiceId}`,
  payment_id: paymentId,
  invoice_id: invoiceId,
  amount_allocated: amount,
});

function makeDb(opts: { invoices?: Row[]; payments?: Row[]; payment_invoice_links?: Row[] } = {}) {
  return new FakeSupabase({
    invoices: opts.invoices ?? [],
    payments: opts.payments ?? [],
    payment_invoice_links: opts.payment_invoice_links ?? [],
  });
}

/** Link rows the function inserted, in insertion order. */
function insertedLinks(db: FakeSupabase) {
  return db.inserts.filter((i) => i.table === "payment_invoice_links").flatMap((i) => i.rows);
}

/** Invoice update statements that actually matched the given invoice id. */
function invoiceUpdatesFor(db: FakeSupabase, invoiceId: string) {
  return db.updates.filter((u) => u.table === "invoices" && u.ids.includes(invoiceId));
}

function invoiceRow(db: FakeSupabase, invoiceId: string): Row {
  const r = db.rows("invoices").find((x) => x.id === invoiceId);
  if (!r) throw new Error(`invoice ${invoiceId} missing from fake db`);
  return r;
}

/* =================================================================== */

describe("applyPartialPaymentAllocation - open balance from prior payments", () => {
  // The real production bug: ₪1774 invoice, one earlier payment recorded only
  // through the payments.invoice_id FK (no link row). The remainder 1139.9982
  // is paid; with a ₪5 tolerance the invoice must close as 'paid'.
  it("closes the invoice as paid when the prior payment is a direct-FK payment with no link row (production bug)", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1774, "2026-01-15")],
      payments: [
        payment("P_OLD", "INV1", 634.0018),
        payment("P_NEW", "INV1", 1140),
      ],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1140,
      closeTolerance: 5,
    });

    expect(res.fullyPaidIds).toEqual(["INV1"]);
    expect(res.partialId).toBeNull();
    expect(res.totalAllocated).toBeCloseTo(1139.9982, 6);

    const links = insertedLinks(db);
    expect(links).toHaveLength(1);
    expect(links[0].invoice_id).toBe("INV1");
    expect(links[0].payment_id).toBe("P_NEW");
    expect(Number(links[0].amount_allocated)).toBeCloseTo(1139.9982, 6);

    expect(invoiceRow(db, "INV1").status).toBe("paid");
    // No 'partial' / amount_paid write may reach this invoice.
    const partialWrites = invoiceUpdatesFor(db, "INV1").filter(
      (u) => u.patch.status === "partial" || "amount_paid" in u.patch
    );
    expect(partialWrites).toEqual([]);
  });

  it("gives the identical outcome when the prior payment is recorded as a payment_invoice_links row", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1774, "2026-01-15")],
      payments: [payment("P_OLD", null, 634.0018), payment("P_NEW", "INV1", 1140)],
      payment_invoice_links: [link("P_OLD", "INV1", 634.0018)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1140,
      closeTolerance: 5,
    });

    expect(res.fullyPaidIds).toEqual(["INV1"]);
    expect(res.partialId).toBeNull();
    expect(res.totalAllocated).toBeCloseTo(1139.9982, 6);

    const links = insertedLinks(db);
    expect(links).toHaveLength(1);
    expect(Number(links[0].amount_allocated)).toBeCloseTo(1139.9982, 6);
    expect(invoiceRow(db, "INV1").status).toBe("paid");
  });

  it("counts a prior payment that has BOTH an FK and a link row only once", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1774, "2026-01-15")],
      payments: [payment("P_OLD", "INV1", 634.0018), payment("P_NEW", "INV1", 1140)],
      payment_invoice_links: [link("P_OLD", "INV1", 634.0018)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1140,
      closeTolerance: 5,
    });

    // Double counting would make the open balance 505.9964 and leave ₪634 overpay.
    expect(res.totalAllocated).toBeCloseTo(1139.9982, 6);
    expect(res.overpay).toBeCloseTo(0.0018, 6);
    expect(res.fullyPaidIds).toEqual(["INV1"]);
  });

  it("ignores a soft-deleted prior payment when computing the open balance", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1774, "2026-01-15")],
      payments: [
        payment("P_OLD", "INV1", 634.0018),
        payment("P_DEL", "INV1", 500, { deleted_at: "2026-04-01T00:00:00Z" }),
        payment("P_NEW", "INV1", 1140),
      ],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1140,
      closeTolerance: 5,
    });

    expect(res.totalAllocated).toBeCloseTo(1139.9982, 6);
    expect(res.fullyPaidIds).toEqual(["INV1"]);
    expect(invoiceRow(db, "INV1").status).toBe("paid");
  });

  it("does not count the payment being applied as prior paid even though its FK is already set", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1000, "2026-02-01")],
      payments: [payment("P_NEW", "INV1", 1000)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
    });

    // If the function counted its own payment, the balance would collapse to 0
    // and it would report the whole ₪1000 as overpay.
    expect(res.overpay).toBeCloseTo(0, 6);
    expect(res.totalAllocated).toBeCloseTo(1000, 6);
    expect(res.fullyPaidIds).toEqual(["INV1"]);
    const links = insertedLinks(db);
    expect(links).toHaveLength(1);
    expect(Number(links[0].amount_allocated)).toBeCloseTo(1000, 6);
    expect(invoiceRow(db, "INV1").status).toBe("paid");
  });

  it("does not let another invoice's prior payments shrink this invoice's balance", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1000, "2026-02-01"), invoice("INV_OTHER", 1000, "2026-02-02")],
      payments: [payment("P_OTHER", "INV_OTHER", 900), payment("P_NEW", "INV1", 1000)],
      payment_invoice_links: [link("P_OTHER", "INV_OTHER", 900)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
    });

    expect(res.fullyPaidIds).toEqual(["INV1"]);
    expect(res.overpay).toBeCloseTo(0, 6);
    expect(insertedLinks(db)).toHaveLength(1);
    expect(invoiceRow(db, "INV_OTHER").status).toBe("pending");
    expect(invoiceUpdatesFor(db, "INV_OTHER")).toEqual([]);
  });
});

describe("applyPartialPaymentAllocation - exact mode vs closeTolerance", () => {
  it("writes status partial and amount_paid when the shortfall exceeds the (default 0) tolerance", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1004, "2026-03-01")],
      payments: [payment("P_NEW", "INV1", 1000)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
    });

    expect(res.partialId).toBe("INV1");
    expect(res.fullyPaidIds).toEqual([]);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].new_status).toBe("partial");
    expect(res.lines[0].amount_allocated).toBeCloseTo(1000, 6);
    expect(res.lines[0].remaining_balance).toBeCloseTo(4, 6);

    const links = insertedLinks(db);
    expect(links).toHaveLength(1);
    expect(Number(links[0].amount_allocated)).toBeCloseTo(1000, 6);

    const row = invoiceRow(db, "INV1");
    expect(row.status).toBe("partial");
    expect(Number(row.amount_paid)).toBeCloseTo(1000, 6); // total 1004 - remaining 4

    const partialWrite = invoiceUpdatesFor(db, "INV1").find((u) => u.patch.status === "partial");
    expect(partialWrite).toBeDefined();
    expect(Number(partialWrite!.patch.amount_paid)).toBeCloseTo(1000, 6);
  });

  it("treats closeTolerance 0 explicitly the same as exact mode", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1004, "2026-03-01")],
      payments: [payment("P_NEW", "INV1", 1000)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
      closeTolerance: 0,
    });

    expect(res.partialId).toBe("INV1");
    expect(invoiceRow(db, "INV1").status).toBe("partial");
  });

  it("promotes the leftover invoice to paid within closeTolerance without inventing paid money", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1004, "2026-03-01")],
      payments: [payment("P_NEW", "INV1", 1000)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
      closeTolerance: 5,
    });

    expect(res.partialId).toBeNull();
    expect(res.fullyPaidIds).toEqual(["INV1"]);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].new_status).toBe("paid");
    // The ₪4 shortfall is forgiven, not invented: the link keeps the real ₪1000.
    expect(res.lines[0].amount_allocated).toBeCloseTo(1000, 6);
    expect(res.totalAllocated).toBeCloseTo(1000, 6);

    const links = insertedLinks(db);
    expect(links).toHaveLength(1);
    expect(Number(links[0].amount_allocated)).toBeCloseTo(1000, 6);

    const row = invoiceRow(db, "INV1");
    expect(row.status).toBe("paid");
    expect(row.amount_paid).toBeNull(); // untouched
    const partialWrites = invoiceUpdatesFor(db, "INV1").filter(
      (u) => u.patch.status === "partial" || "amount_paid" in u.patch
    );
    expect(partialWrites).toEqual([]);
  });

  it("forgives a leftover exactly equal to the tolerance (<=, not <)", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1005, "2026-03-01")],
      payments: [payment("P_NEW", "INV1", 1000)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
      closeTolerance: 5,
    });

    expect(res.partialId).toBeNull();
    expect(res.fullyPaidIds).toEqual(["INV1"]);
    expect(invoiceRow(db, "INV1").status).toBe("paid");
    expect(Number(insertedLinks(db)[0].amount_allocated)).toBeCloseTo(1000, 6);
  });

  it("still marks partial when the leftover is just above the tolerance", async () => {
    const db = makeDb({
      invoices: [invoice("INV1", 1005.5, "2026-03-01")],
      payments: [payment("P_NEW", "INV1", 1000)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV1"],
      paymentAmount: 1000,
      closeTolerance: 5,
    });

    expect(res.partialId).toBe("INV1");
    expect(invoiceRow(db, "INV1").status).toBe("partial");
    expect(Number(invoiceRow(db, "INV1").amount_paid)).toBeCloseTo(1000, 6);
  });
});

describe("applyPartialPaymentAllocation - multi-invoice FIFO, overpay, empty input", () => {
  it("closes the oldest invoice in full, leaves the next partial and never touches the rest", async () => {
    // Seeded out of date order on purpose - FIFO must sort by invoice_date.
    const db = makeDb({
      invoices: [
        invoice("INV_NEW", 200, "2026-03-01"),
        invoice("INV_OLD", 300, "2026-01-05"),
        invoice("INV_MID", 500, "2026-02-10"),
      ],
      payments: [payment("P_NEW", null, 400)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV_NEW", "INV_OLD", "INV_MID"],
      paymentAmount: 400,
    });

    expect(res.fullyPaidIds).toEqual(["INV_OLD"]);
    expect(res.partialId).toBe("INV_MID");
    expect(res.totalAllocated).toBeCloseTo(400, 6);
    expect(res.overpay).toBeCloseTo(0, 6);

    const links = insertedLinks(db);
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.invoice_id)).toEqual(["INV_OLD", "INV_MID"]);
    expect(Number(links[0].amount_allocated)).toBeCloseTo(300, 6);
    expect(Number(links[1].amount_allocated)).toBeCloseTo(100, 6);

    expect(invoiceRow(db, "INV_OLD").status).toBe("paid");
    expect(invoiceRow(db, "INV_MID").status).toBe("partial");
    expect(Number(invoiceRow(db, "INV_MID").amount_paid)).toBeCloseTo(100, 6); // 500 - 400 remaining

    // The invoice the money never reached stays untouched.
    expect(invoiceRow(db, "INV_NEW").status).toBe("pending");
    expect(invoiceRow(db, "INV_NEW").amount_paid).toBeNull();
    expect(invoiceUpdatesFor(db, "INV_NEW")).toEqual([]);
  });

  it("respects prior payments per invoice while allocating FIFO across two invoices", async () => {
    const db = makeDb({
      invoices: [invoice("INV_A", 300, "2026-01-05"), invoice("INV_B", 500, "2026-02-10")],
      payments: [payment("P_PRIOR", "INV_A", 100), payment("P_NEW", null, 400)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV_A", "INV_B"],
      paymentAmount: 400,
    });

    // INV_A open = 200 -> closed; INV_B gets the remaining 200 of 500.
    expect(res.fullyPaidIds).toEqual(["INV_A"]);
    expect(res.partialId).toBe("INV_B");
    const links = insertedLinks(db);
    expect(links.map((l) => Number(l.amount_allocated))).toEqual([200, 200]);
    expect(Number(invoiceRow(db, "INV_B").amount_paid)).toBeCloseTo(200, 6);
  });

  it("reports the unabsorbed money as overpay without extra link rows", async () => {
    const db = makeDb({
      invoices: [invoice("INV_A", 100, "2026-01-05"), invoice("INV_B", 50, "2026-02-10")],
      payments: [payment("P_NEW", null, 500)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV_A", "INV_B"],
      paymentAmount: 500,
    });

    expect(res.fullyPaidIds).toEqual(["INV_A", "INV_B"]);
    expect(res.partialId).toBeNull();
    expect(res.totalAllocated).toBeCloseTo(150, 6);
    expect(res.overpay).toBeCloseTo(350, 6);

    const links = insertedLinks(db);
    expect(links).toHaveLength(2);
    expect(links.map((l) => Number(l.amount_allocated))).toEqual([100, 50]);
    expect(invoiceRow(db, "INV_A").status).toBe("paid");
    expect(invoiceRow(db, "INV_B").status).toBe("paid");
  });

  it("does no DB work at all for an empty invoiceIds list and returns the whole amount as overpay", async () => {
    const db = makeDb({ invoices: [invoice("INV1", 100, "2026-01-01")] });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: [],
      paymentAmount: 250,
    });

    expect(db.fromCalls).toEqual([]);
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(res.lines).toEqual([]);
    expect(res.fullyPaidIds).toEqual([]);
    expect(res.partialId).toBeNull();
    expect(res.totalAllocated).toBe(0);
    expect(res.overpay).toBe(250);
  });

  it("never allocates a negative amount when the invoice is already overpaid", async () => {
    const db = makeDb({
      invoices: [invoice("INV_A", 100, "2026-01-05"), invoice("INV_B", 200, "2026-02-10")],
      payments: [payment("P_PRIOR", "INV_A", 150), payment("P_NEW", null, 200)],
    });

    const res = await applyPartialPaymentAllocation(db.asClient, {
      paymentId: "P_NEW",
      invoiceIds: ["INV_A", "INV_B"],
      paymentAmount: 200,
    });

    for (const line of res.lines) expect(line.amount_allocated).toBeGreaterThanOrEqual(0);
    for (const l of insertedLinks(db)) expect(Number(l.amount_allocated)).toBeGreaterThanOrEqual(0);
    expect(res.totalAllocated).toBeLessThanOrEqual(200 + 1e-9);
    // INV_B still needs 200 and the payment is 200, so it must end up covered.
    expect(res.fullyPaidIds).toContain("INV_B");
  });
});

/* -------- regression: the pure allocator contract must not change -------- */

describe("allocatePartialPayment (existing behaviour that must not break)", () => {
  it("still closes oldest-first and leaves exactly one partial invoice", () => {
    const r = allocatePartialPayment(
      [
        { id: "a", balance: 100 },
        { id: "b", balance: 200 },
        { id: "c", balance: 300 },
      ],
      250
    );
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBe("b");
    expect(r.lines).toEqual([
      { invoice_id: "a", amount_allocated: 100, new_status: "paid", remaining_balance: 0 },
      { invoice_id: "b", amount_allocated: 150, new_status: "partial", remaining_balance: 50 },
    ]);
    expect(r.totalAllocated).toBe(250);
    expect(r.overpay).toBe(0);
  });

  it("still absorbs sub-agora float noise as a full close", () => {
    const r = allocatePartialPayment([{ id: "a", balance: 100 }], 99.999);
    expect(r.fullyPaidIds).toEqual(["a"]);
    expect(r.partialId).toBeNull();
    expect(r.lines[0].amount_allocated).toBe(100);
  });
});
