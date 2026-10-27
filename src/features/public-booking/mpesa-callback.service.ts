import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { confirmPublicBooking } from "./public-booking.service";

interface MpesaCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value: string | number }>;
      };
    };
  };
}

export async function handleMpesaCallback(branchId: string, payload: MpesaCallbackBody) {
  const callback = payload.Body.stkCallback;
  const checkoutId = callback.CheckoutRequestID;

  // 1. Find the hold using CheckoutRequestID
  const hold = await prisma.slotHold.findUnique({
    where: { mpesaCheckoutId: checkoutId },
  });

  // If hold is already deleted, we already processed this! Return 200 to stop Safaricom retries.
  if (!hold) {
    console.log(`ℹ️ M-Pesa callback for already-processed CheckoutID: ${checkoutId}`);
    return { ResultCode: 0, ResultDesc: "Accepted" };
  }

  // 2. Check if payment failed (User cancelled, no money, etc.)
  if (callback.ResultCode !== 0) {
    console.log(`❌ M-Pesa failed for hold ${hold.id}: ${callback.ResultDesc}`);
    
    // Release the slot immediately so someone else can book
    await prisma.slotHold.delete({ where: { id: hold.id } });
    return { ResultCode: 0, ResultDesc: "Accepted" };
  }

  // 3. Payment successful. Extract Receipt Number.
  const items = callback.CallbackMetadata?.Item || [];
  const receiptNumber = items.find((i) => i.Name === "MpesaReceiptNumber")?.Value as string;
  const amountPaid = items.find((i) => i.Name === "Amount")?.Value as number;

  if (!receiptNumber) {
    throw new AppError(400, "Callback missing M-Pesa receipt", "INVALID_CALLBACK");
  }

  console.log(`✅ Payment received for hold ${hold.id}. Receipt: ${receiptNumber}, Amount: ${amountPaid}`);

  // 4. Create the booking
  try {
    // We use placeholder data here. In a real app, you would have collected 
    // the client's name and allergies in Step 1 (before M-Pesa) and stored them in the SlotHold.
    const bookingResponse = await confirmPublicBooking(branchId, hold.clientPhone, {
      holdId: hold.id,
      name: "M-Pesa Client", 
      isFirstLash: false,
    });

    // 5. Record the Payment!
    // We add the payment record using the amount Safaricom confirmed, not what the client claimed.
    await prisma.payment.create({
      data: {
        branchId,
        bookingId: bookingResponse.bookingId,
        amount: amountPaid || 0,
        method: "MPESA",
        kind: "DEPOSIT",
        mpesaReceipt: receiptNumber,
        mpesaPhone: hold.clientPhone,
        mpesaCallbackId: checkoutId,
      }
    });

    console.log(`✅ Booking ${bookingResponse.bookingId} confirmed via M-Pesa.`);
  } catch (error: any) {
    console.error(`❌ CRITICAL: Payment received but booking failed!`, error.message);
    console.error(`   User paid ${amountPaid} KES (Receipt: ${receiptNumber}), but slot was taken.`);
    // In a real app, this would trigger an automatic refund or an SMS to the owner.
  }

  return { ResultCode: 0, ResultDesc: "Accepted" };
}