import { env, smsEnabled, talksasaEnabled } from "../config/env";
import { prisma } from "../config/db";

/**
 * Sends an SMS via TalkSasa (when TALKSASA_API_TOKEN and TALKSASA_SENDER_ID are set) or Africa's Talking. Without credentials the message is only logged,
 * so the whole booking flow still works in development and demos.
 * Every attempt is recorded in NotificationLog.
 */
export async function sendSms(to: string, message: string, templateKey = "custom") {
  const recipient = to.replace(/\s/g, "");

  const log = await prisma.notificationLog
    .create({ data: { channel: "SMS", templateKey, recipient, payload: { message } } })
    .catch(() => null);

  if (!smsEnabled) {
    console.log(`[sms:dev] to=${recipient} :: ${message}`);
    if (log) {
      await prisma.notificationLog
        .update({ where: { id: log.id }, data: { status: "SENT", sentAt: new Date(), providerId: "console" } })
        .catch(() => {});
    }
    return { success: true };
  }

  if (talksasaEnabled) {
    try {
      const providerId = await sendViaTalkSasa(recipient, message);
      if (log) {
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: "SENT", sentAt: new Date(), ...(providerId ? { providerId } : {}) },
        });
      }
      return { success: true };
    } catch (error: any) {
      console.error(`SMS to ${recipient} failed:`, error.message);
      if (log) {
        await prisma.notificationLog
          .update({ where: { id: log.id }, data: { status: "FAILED", errorMessage: String(error.message).slice(0, 500) } })
          .catch(() => {});
      }
      return { success: false, error: error.message as string };
    }
  }

  try {
    const body = new URLSearchParams({ username: env.SMS_USERNAME!, to: recipient, message });
    if (env.SMS_SENDER_ID) body.set("from", env.SMS_SENDER_ID);

    const host = env.SMS_USERNAME === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const res = await fetch(`https://${host}/version1/messaging`, {
      method: "POST",
      headers: {
        apiKey: env.SMS_PROVIDER_API_KEY!,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
    const json: any = await res.json();
    const providerId = json?.SMSMessageData?.Recipients?.[0]?.messageId as string | undefined;

    if (log) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: "SENT", sentAt: new Date(), ...(providerId ? { providerId } : {}) },
      });
    }
    return { success: true };
  } catch (error: any) {
    console.error(`SMS to ${recipient} failed:`, error.message);
    if (log) {
      await prisma.notificationLog
        .update({ where: { id: log.id }, data: { status: "FAILED", errorMessage: String(error.message).slice(0, 500) } })
        .catch(() => {});
    }
    return { success: false, error: error.message as string };
  }
}

/** TalkSasa wants the number in international form without spaces: 07XXXXXXXX becomes 2547XXXXXXXX. */
function toInternational(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return digits;
}

async function sendViaTalkSasa(recipient: string, message: string): Promise<string | undefined> {
  const base = (env.TALKSASA_BASE_URL ?? "https://bulksms.talksasa.com/api/v3").replace(/\/$/, "");
  const res = await fetch(`${base}/sms/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${String(env.TALKSASA_API_TOKEN).trim().replace(/^bearer\s+/i, "").replace(/^["']|["']$/g, "")}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: toInternational(recipient), sender_id: env.TALKSASA_SENDER_ID, type: "plain", message }),
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => ({}));
  // TalkSasa reports failures in the body (status "error") as well as with HTTP codes.
  if (!res.ok || json?.status === "error") throw new Error(String(json?.message ?? `SMS provider responded ${res.status}`));
  const id = json?.data?.uid ?? json?.data?.id ?? json?.uid ?? json?.id;
  return id ? String(id) : undefined;
}
