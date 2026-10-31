import { randomInt } from "node:crypto";
import { prisma } from "../../config/db";
import { AppError } from "../../utils/errors";
import { verifyPassword, hashPassword } from "../../utils/password";
import type { ChangePasswordInput, ResetPasswordInput } from "./auth.schema";
import { sendEmail } from "../../integrations/email";
import { otpEmailTemplate } from "../../integrations/email-templates";

const invalid = () => new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");

// A pre-computed bcrypt hash for the string "dummy-password".
// This prevents timing attacks: if the email doesn't exist, we still spend ~100ms hashing.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export async function verifyLogin(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();

  const staff = await prisma.staff.findUnique({ where: { email } });

  if (!staff || !staff.passwordHash) {
    await verifyPassword(password, DUMMY_HASH);
    throw invalid();
  }
  
  if (!(await verifyPassword(password, staff.passwordHash))) throw invalid();
  if (!staff.isActive) throw new AppError(403, "This account is disabled", "ACCOUNT_DISABLED");

  return staff;
}

export async function getStaffProfile(id: string) {
  const staff = await prisma.staff.findUnique({
    where: { id },
    select: { 
      id: true, 
      name: true, 
      email: true, 
      phone: true, 
      role: true, 
      branchId: true, 
      canSwitchBranches: true,
      isActive: true,
      mustChangePassword: true 
    },
  });
  
  if (!staff || !staff.isActive) {
    throw new AppError(401, "Session is no longer valid", "UNAUTHORIZED");
  }
  
  return staff;
}

export async function changePassword(staffId: string, data: ChangePasswordInput) {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff || !staff.passwordHash) throw invalid();

  const isValid = await verifyPassword(data.currentPassword, staff.passwordHash);
  if (!isValid) throw new AppError(400, "Current password is incorrect", "INVALID_PASSWORD");

  const newHash = await hashPassword(data.newPassword);
  
  await prisma.staff.update({
    where: { id: staffId },
    data: { 
      passwordHash: newHash,
      mustChangePassword: false,
    },
  });

  return { message: "Password updated successfully" };
}

export async function requestPasswordReset(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const staff = await prisma.staff.findUnique({ where: { email } });

  // Security: Do not throw an error if email doesn't exist.
  if (!staff) return { message: "If that email exists, an OTP has been sent." };

  const code = randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.otpCode.create({
    data: {
      phone: staff.phone,
      code,
      expiresAt,
      channel: "SMS",
    },
  });

  // Send the OTP via Brevo using the centralized template
  const template = otpEmailTemplate({ name: staff.name, otp: code });
  await sendEmail({
    to: { email: staff.email, name: staff.name },
    subject: template.subject,
    htmlContent: template.htmlContent,
  });

  return { message: "If that email exists, an OTP has been sent." };
}

export async function resetPassword(data: ResetPasswordInput) {
  const email = data.email.trim().toLowerCase();
  const staff = await prisma.staff.findUnique({ where: { email } });
  if (!staff) throw new AppError(400, "Invalid request", "BAD_REQUEST");

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      phone: staff.phone,
      expiresAt: { gt: new Date() },
      usedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord || otpRecord.attempts >= 5) {
    throw new AppError(400, "Invalid or expired code. Request a new one.", "INVALID_OTP");
  }
  if (otpRecord.code !== data.otp) {
    await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(400, "Invalid or expired code. Request a new one.", "INVALID_OTP");
  }

  const newHash = await hashPassword(data.newPassword);
  await prisma.staff.update({
    where: { id: staff.id },
    data: { 
      passwordHash: newHash,
      mustChangePassword: false,
    },
  });

  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { usedAt: new Date() },
  });

  return { message: "Password reset successfully. You can now log in." };
}