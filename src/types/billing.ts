export type SubscriptionStatus =
  | "pending"
  | "active"
  | "paused"
  | "cancelled"
  | "failed";

export type ChargeStatus = "pending" | "success" | "failed";
export type ChargeType = "initial" | "recurring" | "manual" | "one_time";

export interface BillingCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface BillingSubscription {
  id: string;
  customer_id: string;
  /** NET (pre-VAT). Gross charged = monthly_amount * (1 + vat_percent/100). */
  monthly_amount: number;
  vat_percent: number;
  currency: string;
  status: SubscriptionStatus;
  cardcom_token: string | null;
  card_last_four: string | null;
  card_expiry: string | null;
  next_charge_date: string | null;
  day_of_month: number | null;
  failed_attempts: number;
  started_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingCharge {
  id: string;
  subscription_id: string | null;
  customer_id: string | null;
  /** GROSS charged (net + vat). The breakdown is in net/vat fields below. */
  amount: number;
  vat_percent: number | null;
  net_amount: number | null;
  vat_amount: number | null;
  status: ChargeStatus;
  type: ChargeType;
  cardcom_low_profile_id: string | null;
  cardcom_transaction_id: string | null;
  cardcom_payment_url: string | null;
  cardcom_response: unknown;
  error_message: string | null;
  charged_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** Row shape returned by GET /api/billing/customers */
export interface BillingCustomerWithSubscription extends BillingCustomer {
  subscription: BillingSubscription | null;
}
