import { env, mpesaEnabled } from "../config/env";
import { normalizePhone } from "../utils/phone";

/**
 * Direct Daraja (Safaricom) integration: OAuth token + STK Push + STK Query.
 * https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate
 */

const baseUrl = () => (env.MPESA_ENVIRONMENT === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;

  const basic = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString("base64");
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Daraja rejected the consumer key/secret (HTTP ${res.status}). Check MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET and MPESA_ENVIRONMENT.`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: string };
  token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
  return token.value;
}

/** yyyyMMddHHmmss in Nairobi time, as Daraja expects. */
function timestamp(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().replace(/\D/g, "").slice(0, 14);
}

const password = (ts: string) => Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${ts}`).toString("base64");

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { errorMessage?: string; errorCode?: string };
  if (!res.ok) throw new Error(json.errorMessage ?? `Daraja responded with HTTP ${res.status}`);
  return json;
}

export async function initiateStkPush(params: {
  phone: string;
  amount: number;
  accountReference: string;
  description: string;
}): Promise<{ success: true; checkoutRequestId: string } | { success: false; error: string }> {
  if (!mpesaEnabled) return { success: false, error: "M-Pesa is not configured" };

  const normalized = normalizePhone(params.phone);
  if (!normalized) return { success: false, error: "Invalid phone number for M-Pesa" };
  const phone = normalized.replace("+", "");

  try {
    const ts = timestamp();
    const res = await post<{ ResponseCode: string; ResponseDescription: string; CheckoutRequestID: string }>("/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      TransactionType: env.MPESA_TRANSACTION_TYPE,
      Amount: Math.round(params.amount),
      PartyA: phone,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: env.MPESA_CALLBACK_URL,
      AccountReference: params.accountReference.slice(0, 12),
      TransactionDesc: params.description.slice(0, 13),
    });

    if (res.ResponseCode !== "0") return { success: false, error: res.ResponseDescription };
    return { success: true, checkoutRequestId: res.CheckoutRequestID };
  } catch (error: any) {
    console.error(`STK Push failed for ${phone}:`, error.message);
    return { success: false, error: error.message };
  }
}

/** Polling fallback. Safaricom only returns a result code here (no receipt), so use it to detect failures. */
/**
 * Whether an STK status check result means the payment definitely did not happen (cancelled, wrong PIN,
 * no money, timed out). 0 is paid, and 4999 means "still under processing", so neither is a failure;
 * a result we cannot read is never treated as one either.
 */
export const isFinalStkFailure = (code: number) => Number.isFinite(code) && code !== 0 && code !== 4999;

export async function queryStkStatus(checkoutRequestId: string) {
  try {
    const ts = timestamp();
    const res = await post<{ ResultCode?: string; ResultDesc?: string }>("/mpesa/stkpushquery/v1/query", {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    });
    if (res.ResultCode === undefined) return { success: false as const, error: "No result yet" };
    return { success: true as const, resultCode: Number(res.ResultCode), resultDesc: String(res.ResultDesc ?? "") };
  } catch (error: any) {
    // Safaricom answers "still processing" with an error; that simply means "not decided yet".
    return { success: false as const, error: error.message as string };
  }
}
