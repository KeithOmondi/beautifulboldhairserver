/**
 * Centralized email templates for Brevo.
 * Keep all HTML email content here, not scattered in service files.
 */

export function otpEmailTemplate(params: { name: string; otp: string }) {
  return {
    subject: "Your Verification Code",
    htmlContent: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Verification Code</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; padding: 40px 20px; margin: 0;">
          <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
            <h1 style="color: #111827; margin: 0 0 16px; font-size: 24px;">Verification Code</h1>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
              Hi ${params.name},
            </p>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
              Use the code below to reset your password. It expires in 15 minutes.
            </p>
            <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827; font-family: 'Courier New', monospace;">
                ${params.otp}
              </span>
            </div>
            <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin: 0;">
              If you didn't request this, you can safely ignore this email. Your password won't be changed.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              This code can only be used once and expires at ${new Date(Date.now() + 15 * 60 * 1000).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}.
            </p>
          </div>
        </body>
      </html>
    `,
  };
}

export function welcomeEmailTemplate(params: { name: string }) {
  return {
    subject: "Welcome to the Team",
    htmlContent: `
      <h2>Welcome, ${params.name}!</h2>
      <p>Your account has been created. You'll be asked to set a new password when you first log in.</p>
    `,
  };
}

export function bookingConfirmationTemplate(params: {
  clientName: string;
  staffName: string;
  serviceName: string;
  startAt: string;
}) {
  return {
    subject: `Booking Confirmed – ${params.serviceName}`,
    htmlContent: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #111827;">Booking Confirmed ✓</h2>
        <p>Hi ${params.clientName},</p>
        <p>Your appointment has been booked:</p>
        <ul style="list-style: none; padding: 0;">
          <li style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Service:</strong> ${params.serviceName}</li>
          <li style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>With:</strong> ${params.staffName}</li>
          <li style="padding: 8px 0;"><strong>When:</strong> ${params.startAt}</li>
        </ul>
        <p style="color: #6b7280; font-size: 13px;">We look forward to seeing you!</p>
      </div>
    `,
  };
}