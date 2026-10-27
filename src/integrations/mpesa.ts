import { Daraja } from "@lumierelabs/daraja";
import { env } from "../config/env";
import { normalizePhone } from "../utils/phone";

// Initialize the Daraja client once. It caches OAuth tokens automatically.
const daraja = Daraja({
  consumerKey: env.MPESA_CONSUMER_KEY,
  consumerSecret: env.MPESA_CONSUMER_SECRET,
  shortcode: env.MPESA_SHORTCODE,
  passkey: env.MPESA_PASSKEY,
  callbackUrl: env.MPESA_CALLBACK_URL,
  environment: env.MPESA_ENVIRONMENT,
});

/**
 * Initiates an STK Push (Lipa na M-Pesa) to the client's phone.
 * Returns the CheckoutRequestID which you must store to match the callback.
 */
export async function initiateStkPush(params: {
  phone: string; // Kenyan format, will be normalized
  amount: number; // Whole shillings only
  accountReference: string; // e.g., Booking ID
  description: string;
}) {
  // 1. Normalize phone to 2547XXXXXXXX (Daraja requires this format)
  const normalized = normalizePhone(params.phone);
  if (!normalized) {
    throw new Error("Invalid phone number for M-Pesa");
  }
  // Daraja expects the number without the '+' sign
  const mpesaPhone = normalized.replace("+", "");

  try {
    const response = await daraja.stkPush({
      transactionType: "CustomerPayBillOnline",
      amount: params.amount,
      partyA: mpesaPhone,
      phoneNumber: mpesaPhone,
      accountReference: params.accountReference.slice(0, 12), // Max 12 chars
      transactionDesc: params.description.slice(0, 13), // Max 13 chars
    });

    console.log(`✅ STK Push initiated for ${mpesaPhone}. CheckoutID: ${response.CheckoutRequestID}`);
    
    return {
      success: true,
      checkoutRequestId: response.CheckoutRequestID,
      merchantRequestId: response.MerchantRequestID,
      customerMessage: response.CustomerMessage,
    };
  } catch (error: any) {
    console.error(`❌ STK Push failed for ${mpesaPhone}:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Queries the status of an STK Push (useful for polling if the callback is delayed).
 */
export async function queryStkStatus(checkoutRequestId: string) {
  try {
    const response = await daraja.stkPushQuery({ checkoutRequestId });
    return {
      success: true,
      resultCode: response.ResultCode,
      resultDesc: response.ResultDesc,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}