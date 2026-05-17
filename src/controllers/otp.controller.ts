import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { signAccessToken, signRefreshToken } from '../utils/jwt';
import { sendSms } from '../utils/sms';
import { encryptPHI, hmacHash } from '../utils/phi-crypto';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_ATTEMPTS = 5;

const sendOtpSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format e.g. +919876543210'),
});

const verifyOtpSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  code: z.string().length(4).regex(/^\d{4}$/),
});

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  const parsed = sendOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { phone } = parsed.data;
  const phoneH = hmacHash(phone);

  // Resend cooldown — check if a recent OTP already exists for this phone
  const recent = await prisma.otpCode.findFirst({
    where: {
      phoneHash: phoneH,
      consumed: false,
      createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_MS) },
    },
  });

  if (recent) {
    res.status(429).json({ message: 'Please wait 60 seconds before requesting a new OTP' });
    return;
  }

  // Invalidate any prior unconsumed OTPs for this phone (using hash for lookup)
  await prisma.$executeRaw`UPDATE "OtpCode" SET consumed = true WHERE "phoneHash" = ${phoneH} AND consumed = false`;

  // Generate 4-digit code
  const code = String(crypto.randomInt(1000, 10000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.otpCode.create({
    data: { phone: encryptPHI(phone), phoneHash: phoneH, codeHash, expiresAt },
  });

  await sendSms(phone, `Your HealthTracker verification code is ${code}. Valid for 5 minutes.`);

  const response: Record<string, unknown> = {
    message: 'OTP sent',
    expires_in: 300,
  };

  // Return OTP in response only in mock+non-production mode for easy testing
  if (process.env.SMS_PROVIDER === 'mock' && process.env.NODE_ENV !== 'production') {
    response.dev_otp = code;
  }

  res.json(response);
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { phone, code } = parsed.data;
  const phoneH = hmacHash(phone);

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      phoneHash: phoneH,
      consumed: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRecord) {
    res.status(401).json({ message: 'No valid OTP found for this number. Please request a new one.' });
    return;
  }

  if (otpRecord.attempts >= MAX_ATTEMPTS) {
    res.status(429).json({ message: 'Too many incorrect attempts. Please request a new OTP.' });
    return;
  }

  const match = await bcrypt.compare(code, otpRecord.codeHash);

  if (!match) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });
    res.status(401).json({ message: 'Incorrect OTP' });
    return;
  }

  // Mark OTP as consumed
  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { consumed: true },
  });

  // Find or create user
  let user = await prisma.user.findUnique({ where: { phoneHash: phoneH } });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.user.create({
      data: { phone: encryptPHI(phone), phoneHash: phoneH, name: '', passwordHash: '' },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'otp.register.phone' },
    });
  } else {
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'otp.login.phone' },
    });
  }

  const payload      = { userId: user.id, email: user.email ?? '' };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const tokenHash    = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: tokenHash,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 900,
    is_new_user: isNewUser,
  });
};
