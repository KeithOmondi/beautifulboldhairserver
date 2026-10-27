/**
 * Input for requesting an OTP to start the booking flow.
 */
export interface RequestOtpInput {
  phone: string;
}

/**
 * Input for verifying the OTP.
 */
export interface VerifyOtpInput {
  phone: string;
  code: string; // 6-digit OTP
}

/**
 * The payload stored inside the short-lived JWT given to a verified client.
 */
export interface ClientJwtPayload {
  type: "client";
  phone: string;
  clientId: string | null; // null if they are a brand new client
}

/**
 * The response returned after successful OTP verification.
 */
export interface VerifyOtpResponse {
  token: string; // Short-lived JWT
  client: {
    id: string | null;
    name: string | null;
    phone: string;
  };
}

/**
 * Input for holding a slot before the client pays the deposit.
 * We capture the client's details here so the M-Pesa callback
 * knows exactly who the booking belongs to.
 */
export interface HoldSlotInput {
  staffId: string;
  serviceId: string;
  startAt: string; // ISO 8601 string
  name: string;    // <--- Added for M-Pesa flow
  allergies?: string | undefined; // <--- Added for M-Pesa flow
}

/**
 * The response after holding a slot and initiating M-Pesa.
 */
export interface HoldSlotResponse {
  holdId: string;
  expiresAt: Date;
  staffName: string;
  serviceName: string;
  startAt: Date;
  message: string; // E.g., "Check your phone for M-Pesa prompt"
  mpesaCheckoutId: string; // The ID Safaricom returns
}

/**
 * Input for confirming the booking.
 * In the M-Pesa flow, this is called by the Safaricom Webhook, not the client.
 */
export interface ConfirmPublicBookingInput {
  holdId: string;
  name: string;
  allergies?: string | undefined;
  isFirstLash?: boolean | undefined;
}

/**
 * The response after creating the final booking.
 */
export interface ConfirmPublicBookingResponse {
  bookingId: string;
  manageToken: string;
  startAt: Date;
  endAt: Date;
  staffName: string;
  serviceName: string;
  totalPrice: number;
  depositAmount: number;
  depositPaid: boolean;
}