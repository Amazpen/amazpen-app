import { describe, it, expect, beforeEach } from "vitest";
import { buildLowProfilePayload, buildTokenChargePayload, normalizeLpResult } from "./cardcom";

beforeEach(() => {
  process.env.CARDCOM_TERMINAL = "191080";
  process.env.CARDCOM_API_NAME = "test-api-name";
  process.env.CARDCOM_BASE_URL = "https://secure.cardcom.solutions/api/v11";
});

describe("buildLowProfilePayload", () => {
  it("includes terminal, api name, amount, ChargeAndCreateToken op, and ReturnValue", () => {
    const p = buildLowProfilePayload({
      amount: 199,
      chargeId: "charge-123",
      successUrl: "https://app/x/success",
      failedUrl: "https://app/x/failed",
      webhookUrl: "https://app/x/webhook",
      customer: { name: "דני", email: "d@x.co", taxId: "123", phone: "050" },
    });
    expect(p.TerminalNumber).toBe(191080);
    expect(p.ApiName).toBe("test-api-name");
    expect(p.Amount).toBe(199);
    expect(p.Operation).toBe("ChargeAndCreateToken");
    expect(p.ReturnValue).toBe("charge-123");
    expect(p.WebHookUrl).toBe("https://app/x/webhook");
    expect(p.SuccessRedirectUrl).toBe("https://app/x/success");
    expect(p.FailedRedirectUrl).toBe("https://app/x/failed");
    expect(p.Document?.Name).toBe("דני");
    // Terminal issues tax invoices → exactly one product line is required (else 5047).
    expect(p.Document.Products).toHaveLength(1);
    expect(p.Document.Products[0]).toEqual({
      Description: "תשלום - המצפן",
      UnitCost: 199,
      Quantity: 1,
    });
  });

  it("uses a custom product description when provided", () => {
    const p = buildLowProfilePayload({
      amount: 50,
      chargeId: "c",
      successUrl: "s",
      failedUrl: "f",
      webhookUrl: "w",
      customer: { name: "x" },
      productDescription: "מנוי חודשי - המצפן",
    });
    expect(p.Document.Products[0].Description).toBe("מנוי חודשי - המצפן");
    expect(p.Document.Products[0].UnitCost).toBe(50);
  });

  it("uses ChargeOnly when operation is explicitly passed", () => {
    const p = buildLowProfilePayload({
      amount: 199,
      chargeId: "charge-456",
      successUrl: "https://app/x/success",
      failedUrl: "https://app/x/failed",
      webhookUrl: "https://app/x/webhook",
      customer: { name: "דני" },
      operation: "ChargeOnly",
    });
    expect(p.Operation).toBe("ChargeOnly");
  });
});

describe("buildTokenChargePayload", () => {
  it("uses confirmed token fields", () => {
    const p = buildTokenChargePayload({ amount: 199, token: "tok-1", cardExpiryMMYY: "1230" });
    expect(p.TerminalNumber).toBe(191080);
    expect(p.ApiName).toBe("test-api-name");
    expect(p.Amount).toBe(199);
    expect(p.Token).toBe("tok-1");
    expect(p.CardExpirationMMYY).toBe("1230");
    // Same terminal requires an invoice line on the token charge too.
    expect(p.Document.Products).toHaveLength(1);
    expect(p.Document.Products[0].UnitCost).toBe(199);
  });
});

describe("normalizeLpResult", () => {
  it("maps a successful raw result (ResponseCode 0) to success", () => {
    const raw = {
      ResponseCode: 0,
      TranzactionId: 555,
      TokenInfo: { Token: "tok-xyz", CardLast4Digits: "4242", CardYearMonth: "1230" },
    };
    const n = normalizeLpResult(raw);
    expect(n.success).toBe(true);
    expect(n.token).toBe("tok-xyz");
    expect(n.lastFour).toBe("4242");
    expect(n.expiryMMYY).toBe("1230");
    expect(n.transactionId).toBe("555");
  });
  it("maps a non-zero ResponseCode to failure with the description", () => {
    const n = normalizeLpResult({ ResponseCode: 57, Description: "declined" });
    expect(n.success).toBe(false);
    expect(n.error).toBe("declined");
  });
});
