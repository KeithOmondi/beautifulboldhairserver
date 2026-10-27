import type { 
  Payment, 
  PaymentMethod, 
  PaymentKind 
} from "../../generated/prisma/client";

/**
 * Input for recording a new payment (Cash, M-Pesa, or Card).
 */
export interface CreatePaymentInput {
  bookingId?: string; // Optional: for walk-in product sales (like selling a wig)
  amount: number;
  method: PaymentMethod;
  kind: PaymentKind; // DEPOSIT, BALANCE, or REFUND
  mpesaReceipt?: string;
  mpesaPhone?: string;
  notes?: string;
}

/**
 * The response returned after a payment is recorded.
 * Includes the updated booking balance so the front desk knows what's still owed.
 */
export interface PaymentResponse {
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  kind: PaymentKind;
  mpesaReceipt: string | null;
  createdAt: Date;
  booking?: {
    id: string;
    totalPrice: number;
    totalPaid: number;
    balanceDue: number;
  };
}

/**
 * A payment record enriched with booking and client details.
 */
export type PaymentWithDetails = Payment & {
  booking?: {
    id: string;
    client: { name: string; phone: string };
    service: { name: string };
  } | null;
};