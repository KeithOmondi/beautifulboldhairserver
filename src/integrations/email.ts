import { BrevoClient } from "@getbrevo/brevo";
import { env, emailEnabled } from "../config/env";

let client: BrevoClient | null = null;
const getClient = () => (client ??= new BrevoClient({ apiKey: env.BREVO_API_KEY! }));

interface SendEmailParams {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export async function sendEmail({ to, subject, htmlContent, textContent }: SendEmailParams) {
  if (!emailEnabled) {
    console.warn(`[email disabled] to=${to.email} subject="${subject}"`);
    return { success: false, error: "Email is not configured" };
  }
  try {
    const result = await getClient().transactionalEmails.sendTransacEmail({
      sender: { name: env.BREVO_SENDER_NAME ?? "Salon", email: env.BREVO_SENDER_EMAIL! },
      to: [to],
      subject,
      htmlContent,
      textContent: textContent ?? htmlContent.replace(/<[^>]*>?/gm, ""),
    });
    return { success: true, messageId: result.messageId };
  } catch (error: any) {
    console.error(`Failed to send email to ${to.email}:`, error.message);
    return { success: false, error: error.message };
  }
}
