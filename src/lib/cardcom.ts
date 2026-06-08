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

export interface LowProfilePayload {
  TerminalNumber: number;
  ApiName: string;
  Amount: number;
  Operation: "ChargeAndCreateToken";
  ReturnValue: string;
  SuccessRedirectUrl: string;
  FailedRedirectUrl: string;
  WebHookUrl: string;
  Document?: { Name: string; Email?: string; TaxId?: string; Mobile?: string };
}

export function buildLowProfilePayload(args: {
  amount: number;
  chargeId: string;
  successUrl: string;
  failedUrl: string;
  webhookUrl: string;
  customer: CardcomCustomer;
}): LowProfilePayload {
  const { terminal, apiName } = cfg();
  return {
    TerminalNumber: terminal,
    ApiName: apiName,
    Amount: args.amount,
    Operation: "ChargeAndCreateToken",
    ReturnValue: args.chargeId,
    SuccessRedirectUrl: args.successUrl,
    FailedRedirectUrl: args.failedUrl,
    WebHookUrl: args.webhookUrl,
    Document: {
      Name: args.customer.name,
      Email: args.customer.email ?? undefined,
      TaxId: args.customer.taxId ?? undefined,
      Mobile: args.customer.phone ?? undefined,
    },
  };
}

export interface TokenChargePayload {
  TerminalNumber: number;
  ApiName: string;
  Amount: number;
  Token: string;
  CardExpirationMMYY: string;
}

export function buildTokenChargePayload(args: {
  amount: number;
  token: string;
  cardExpiryMMYY: string;
}): TokenChargePayload {
  const { terminal, apiName } = cfg();
  return {
    TerminalNumber: terminal,
    ApiName: apiName,
    Amount: args.amount,
    Token: args.token,
    CardExpirationMMYY: args.cardExpiryMMYY,
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

/** Defensive extraction — Cardcom field names vary; check several. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeLpResult(raw: any): NormalizedResult {
  const code = raw?.ResponseCode ?? raw?.responseCode;
  const success = code === 0;
  const tokenInfo = raw?.TokenInfo ?? raw?.tokenInfo ?? {};
  const tranId =
    raw?.TranzactionId ?? raw?.TransactionId ?? raw?.tranzactionId ?? raw?.InternalDealNumber;
  return {
    success,
    token: tokenInfo.Token ?? tokenInfo.token ?? raw?.Token,
    lastFour:
      tokenInfo.CardLast4Digits ?? tokenInfo.Last4Digits ?? raw?.CardNumLast4 ?? raw?.Last4,
    expiryMMYY: tokenInfo.CardYearMonth ?? tokenInfo.CardValidityYearMonth ?? raw?.CardExpiry,
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
}): Promise<NormalizedResult> {
  const raw = await postJson("/Transactions/Transaction", buildTokenChargePayload(args));
  return normalizeLpResult(raw);
}
