import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AuthRequest } from '../middleware/auth';
import admin from '../utils/firebase';
import { sendVerificationEmail } from '../utils/mailer';
import crypto from 'crypto';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const register = async (req: Request, res: Response): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { name, email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'user.register' },
  });

  res.status(201).json({ user_id: user.id });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input' });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: 'Invalid email or password' });
    return;
  }

  const payload = { userId: user.id, email: user.email ?? '' };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'user.login' },
  });

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 900,
  });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    res.status(400).json({ message: 'refresh_token is required' });
    return;
  }

  try {
    const payload = verifyRefreshToken(refresh_token);
    const stored = await prisma.refreshToken.findUnique({ where: { token: refresh_token } });
    if (!stored || stored.expiresAt < new Date()) {
      res.status(401).json({ message: 'Invalid or expired refresh token' });
      return;
    }

    await prisma.refreshToken.delete({ where: { token: refresh_token } });

    const newAccessToken = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefreshToken = signRefreshToken({ userId: payload.userId, email: payload.email });

    await prisma.refreshToken.create({
      data: {
        userId: payload.userId,
        token: newRefreshToken,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    res.json({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_in: 900,
    });
  } catch {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
};

export const sendEmailVerification = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || !user.email) {
    res.status(400).json({ message: 'No email address on file' });
    return;
  }
  if (user.emailVerified) {
    res.status(400).json({ message: 'Email already verified' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: req.userId },
    data: { emailVerificationToken: token, emailVerificationExpiry: expiry },
  });

  await sendVerificationEmail(user.email, token, user.id);
  res.json({ message: 'Verification email sent' });
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { token, userId } = req.query as { token: string; userId: string };
  if (!token || !userId) {
    res.status(400).send('Invalid link');
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.emailVerificationToken !== token ||
    !user.emailVerificationExpiry ||
    user.emailVerificationExpiry < new Date()
  ) {
    res.status(400).send('Invalid or expired verification link');
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null },
  });

  res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
      <h2 style="color:#1D1D35;">✓ Email verified!</h2>
      <p style="color:#666;">You can close this tab and return to the app.</p>
    </body></html>
  `);
};

export const phoneAuth = async (req: Request, res: Response): Promise<void> => {
  const { id_token } = req.body;
  if (!id_token) {
    res.status(400).json({ message: 'id_token is required' });
    return;
  }

  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(id_token);
  } catch (e) {
    console.error('[phoneAuth] verifyIdToken failed:', e);
    res.status(401).json({ message: 'Invalid Firebase token', detail: e instanceof Error ? e.message : String(e) });
    return;
  }

  const phone = decodedToken.phone_number;
  if (!phone) {
    res.status(400).json({ message: 'Phone number not found in token' });
    return;
  }

  let user = await prisma.user.findUnique({ where: { phone } });
  const isNewUser = !user;

  if (!user) {
    user = await prisma.user.create({
      data: { phone, name: '', passwordHash: '' },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.register.phone' },
    });
  } else {
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.login.phone' },
    });
  }

  const payload = { userId: user.id, email: user.email ?? '' };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 900,
    is_new_user: isNewUser,
  });
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, name: true, email: true, phone: true, dob: true, gender: true, timeZone: true },
  });
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json({
    user_id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    dob: user.dob,
    gender: user.gender,
    time_zone: user.timeZone,
  });
};
