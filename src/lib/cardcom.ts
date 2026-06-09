// Cardcom API v11 client. Credentials come from env ONLY.
// Swagger: https://secure.cardcom.solutions/swagger/index.html?url=/swagger/v11/swagger.json

function cfg() {
  const terminal = Number(process.env.CARDCOM_TERMINAL);
  const apiName = process.env.CARDCOM_API_NAME;
  const baseUrl = process.env.CARDCOM_BASE_URL || "https://secure.cardcom.solutions/api/v11";
  if (!terminal || !apiName) throw new Error("Missing Cardcom env vars");
  return { terminal, apiName, baseUrl };
}

export interface CardcomCustomer {
  name: string;
  email?: string | null;
  taxId?: string | null;
  phone?: string | null;
}

/** A Cardcom invoice line item. The terminal is configured to issue tax
 *  invoices, so at least one Products entry is REQUIRED — omitting it returns
 *  ResponseCode 5047 "No InvoiceLines data was send". UnitCost is the GROSS
 *  (charged) amount; the terminal's VAT config breaks out the VAT on the invoice. */
export interface CardcomProduct {
  Description: string;
  UnitCost: number;
  Quantity: number;
}

export interface CardcomDocument {
  Name: string;
  Email?: string;
  TaxId?: string;
  Mobile?: string;
  Products: CardcomProduct[];
}

/** Build the required Products array (single line = the charged amount). */
function buildProducts(description: string, grossAmount: number): CardcomProduct[] {
  return [{ Description: description, UnitCost: grossAmount, Quantity: 1 }];
}

/** Installment (תשלומים) settings on the hosted page. Regular Israeli
 *  installments just need MaxNumOfPayments > 1 — the page splits the amount and
 *  shows a payments selector. (CreditType is NOT set: 6=קרדיט financing, a
 *  different product from a plain even split.) The terminal must be enabled for
 *  installments or Cardcom ignores/rejects these. */
export interface LowProfileAdvancedDefinition {
  MinNumOfPayments: number;
  MaxNumOfPayments: number;
  SelectedNumOfPayments: number;
}

export interface LowProfilePayload {
  TerminalNumber: number;
  ApiName: string;
  Amount: number;
  Operation: "ChargeAndCreateToken" | "ChargeOnly";
  ReturnValue: string;
  SuccessRedirectUrl: string;
  FailedRedirectUrl: string;
  WebHookUrl: string;
  AdvancedDefinition?: LowProfileAdvancedDefinition;
  Document: CardcomDocument;
}

export function buildLowProfilePayload(args: {
  amount: number;
  chargeId: string;
  successUrl: string;
  failedUrl: string;
  webhookUrl: string;
  customer: CardcomCustomer;
  operation?: "ChargeAndCreateToken" | "ChargeOnly";
  productDescription?: string;
  /** Number of credit-card installments. 1 (or omitted) = single payment. */
  numOfPayments?: number;
}): LowProfilePayload {
  const { terminal, apiName } = cfg();
  const payments = Math.max(1, Math.floor(Number(args.numOfPayments) || 1));
  return {
    TerminalNumber: terminal,
    ApiName: apiName,
    Amount: args.amount,
    Operation: args.operation ?? "ChargeAndCreateToken",
    ReturnValue: args.chargeId,
    SuccessRedirectUrl: args.successUrl,
    FailedRedirectUrl: args.failedUrl,
    WebHookUrl: args.webhookUrl,
    // Only attach when splitting — a lone payment keeps the default UI.
    ...(payments > 1
      ? {
          AdvancedDefinition: {
            MinNumOfPayments: 1,
            MaxNumOfPayments: payments,
            SelectedNumOfPayments: payments,
          },
        }
      : {}),
    Document: {
      Name: args.customer.name,
      Email: args.customer.email ?? undefined,
      TaxId: args.customer.taxId ?? undefined,
      Mobile: args.customer.phone ?? undefined,
      Products: buildProducts(args.productDescription ?? "תשלום - המצפן", args.amount),
    },
  };
}

export interface TokenChargePayload {
  TerminalNumber: number;
  ApiName: string;
  Amount: number;
  Token: string;
  CardExpirationMMYY: string;
  // Same terminal as LowProfile → issues tax invoices → requires invoice lines.
  Document: CardcomDocument;
}

export function buildTokenChargePayload(args: {
  amount: number;
  token: string;
  cardExpiryMMYY: string;
  productDescription?: string;
  customerName?: string;
  customerEmail?: string | null;
  customerTaxId?: string | null;
}): TokenChargePayload {
  const { terminal, apiName } = cfg();
  return {
    TerminalNumber: terminal,
    ApiName: apiName,
    Amount: args.amount,
    Token: args.token,
    CardExpirationMMYY: args.cardExpiryMMYY,
    Document: {
      Name: args.customerName ?? "לקוח",
      Email: args.customerEmail ?? undefined,
      TaxId: args.customerTaxId ?? undefined,
      Products: buildProducts(args.productDescription ?? "מנוי חודשי - המצפן", args.amount),
    },
  };
}

export interface NormalizedResult {
  success: boolean;
  token?: string;
  lastFour?: string;
  expiryMMYY?: string;
  transactionId?: string;
  error?: string;
  raw: unknown;
}

/**
 * Extract the fields we need from a Cardcom v11 result. Field names confirmed
 * against a real production GetLpResult payload (terminal 191080):
 *   - token: TokenInfo.Token
 *   - expiry: separate numeric TokenInfo.CardMonth + TokenInfo.CardYear → MMYY
 *   - last4: TranzactionInfo.Last4CardDigitsString (zero-padded string)
 *   - txid: TranzactionId
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeLpResult(raw: any): NormalizedResult {
  const code = raw?.ResponseCode ?? raw?.responseCode;
  const success = code === 0;
  const tokenInfo = raw?.TokenInfo ?? raw?.tokenInfo ?? {};
  const tx = raw?.TranzactionInfo ?? raw?.TransactionInfo ?? {};
  const ui = raw?.UIValues ?? {};
  const tranId =
    raw?.TranzactionId ?? raw?.TransactionId ?? tx?.TranzactionId ?? raw?.InternalDealNumber;

  // Cardcom returns the card expiry as separate numeric month + year fields
  // (NOT a combined string). Build MMYY (e.g. month 8, year 2027 → "0827").
  const month = tokenInfo.CardMonth ?? tx.CardMonth ?? ui.CardMonth;
  const year = tokenInfo.CardYear ?? tx.CardYear ?? ui.CardYear;
  const expiryMMYY =
    month != null && year != null
      ? String(month).padStart(2, "0") + String(year).slice(-2)
      : undefined;

  const lastFour =
    tx.Last4CardDigitsString ??
    (tx.Last4CardDigits != null ? String(tx.Last4CardDigits).padStart(4, "0") : undefined);

  return {
    success,
    token: tokenInfo.Token ?? tx.Token ?? raw?.Token,
    lastFour,
    expiryMMYY,
    transactionId: tranId != null ? String(tranId) : undefined,
    error: success ? undefined : raw?.Description ?? raw?.description ?? `ResponseCode ${code}`,
    raw,
  };
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const { baseUrl } = cfg();
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

/** Create a hosted LowProfile page. Returns the page URL + LowProfile id. */
export async function createLowProfile(args: Parameters<typeof buildLowProfilePayload>[0]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await postJson("/LowProfile/Create", buildLowProfilePayload(args))) as any;
  return {
    url: raw?.Url ?? raw?.url,
    lowProfileId: raw?.LowProfileId ?? raw?.lowProfileId,
    raw,
  };
}

/** Verify a LowProfile transaction result server-side. */
export async function getLpResult(lowProfileId: string): Promise<NormalizedResult> {
  const { terminal, apiName } = cfg();
  const raw = await postJson("/LowProfile/GetLpResult", {
    TerminalNumber: terminal,
    ApiName: apiName,
    LowProfileId: lowProfileId,
  });
  return normalizeLpResult(raw);
}

/** Charge a saved token (server-to-server, no PAN). */
export async function chargeToken(args: {
  amount: number;
  token: string;
  cardExpiryMMYY: string;
  productDescription?: string;
  customerName?: string;
  customerEmail?: string | null;
  customerTaxId?: string | null;
}): Promise<NormalizedResult> {
  const raw = await postJson("/Transactions/Transaction", buildTokenChargePayload(args));
  return normalizeLpResult(raw);
}
