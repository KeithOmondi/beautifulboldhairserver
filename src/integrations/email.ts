import { BrevoClient } from "@getbrevo/brevo";
import { env } from "../config/env";

const brevo = new BrevoClient({ apiKey: env.BREVO_API_KEY });

interface SendEmailParams {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export async function sendEmail({ to, subject, htmlContent, textContent }: SendEmailParams) {
  try {
    const result = await brevo.transactionalEmails.sendTransacEmail({
      sender: {
        name: env.BREVO_SENDER_NAME,
        email: env.BREVO_SENDER_EMAIL,
      },
      to: [to],
      subject,
      htmlContent,
      textContent: textContent ?? htmlContent.replace(/<[^>]*>?/gm, ""),
    });

    console.log(`✅ Email sent to ${to.email}. Message ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error: any) {
    console.error(`❌ Failed to send email to ${to.email}:`, error.message);
    return { success: false, error: error.message };
  }
}