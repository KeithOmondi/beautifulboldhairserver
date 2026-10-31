import { z } from "zod";
import { PaymentMethod, PaymentKind } from "../../generated/prisma/client";

// Card is not accepted until the card terminal is integrated (old card records stay readable).
const paymentMethodEnum = z.nativeEnum(PaymentMethod).refine((m) => m !== "CARD", "Card payments are not available yet. Use cash or M-Pesa.");
const paymentKindEnum = z.nativeEnum(PaymentKind);

export const createPaymentSchema = z.object({
  bookingId: z.string().cuid("Invalid booking ID").optional(),
  amount: z.number().int().positive("Payment amount must be greater than zero"),
  method: paymentMethodEnum,
  kind: paymentKindEnum,
  // Safaricom M-Pesa receipts are typically 10 uppercase alphanumeric characters (e.g., "SJ12345678")
  mpesaReceipt: z.string().length(10, "M-Pesa receipt must be 10 characters").toUpperCase().optional(),
  mpesaPhone: z.string().optional(),
  notes: z.string().optional(),
}).refine((data) => {
  // If the payment method is M-Pesa, a receipt is required
  if (data.method === "MPESA" && !data.mpesaReceipt) {
    return false;
  }
  return true;
}, {
  message: "M-Pesa receipt is required when method is MPESA",
  path: ["mpesaReceipt"],
});

export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;