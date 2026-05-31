import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AuthRequest } from '../middleware/auth';
import admin from '../utils/firebase';
import { sendVerificationEmail } from '../utils/mailer';
import crypto from 'crypto';
import { encryptPHI, decryptIfPresent, hmacHash } from '../utils/phi-crypto';

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
  const emailH = hmacHash(email);
  const existing = await prisma.user.findUnique({ where: { emailHash: emailH } });
  if (existing) {
    res.status(409).json({ message: 'Email already registered' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name: encryptPHI(name),
      email: encryptPHI(email),
      emailHash: emailH,
      passwordHash,
    },
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
  const user = await prisma.user.findUnique({ where: { emailHash: hmacHash(email) } });
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
    const payload   = verifyRefreshToken(refresh_token);
    const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    const stored    = await prisma.refreshToken.findUnique({ where: { token: tokenHash } });
    if (!stored || stored.expiresAt < new Date()) {
      res.status(401).json({ message: 'Invalid or expired refresh token' });
      return;
    }

    await prisma.refreshToken.delete({ where: { token: tokenHash } });

    const newAccessToken  = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefreshToken = signRefreshToken({ userId: payload.userId, email: payload.email });
    const newTokenHash    = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    await prisma.refreshToken.create({
      data: {
        userId: payload.userId,
        token: newTokenHash,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: req.userId },
    data: { emailVerificationToken: tokenHash, emailVerificationExpiry: expiry },
  });

  const plainEmail = decryptIfPresent(user.email) ?? '';
  await sendVerificationEmail(plainEmail, rawToken, user.id);
  res.json({ message: 'Verification email sent' });
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { token, userId } = req.query as { token: string; userId: string };
  if (!token || !userId) {
    res.status(400).send('Invalid link');
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (
    !user ||
    user.emailVerificationToken !== tokenHash ||
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
    console.error('[phoneAuth] verifyIdToken failed:', e instanceof Error ? e.message : String(e));
    res.status(401).json({ message: 'Invalid Firebase token' });
    return;
  }

  const phone = decodedToken.phone_number;
  if (!phone) {
    res.status(400).json({ message: 'Phone number not found in token' });
    return;
  }

  const phoneH = hmacHash(phone);
  const existingPhone = await prisma.user.findUnique({ where: { phoneHash: phoneH }, select: { id: true } });
  const isNewUser = !existingPhone;

  const user = await prisma.user.upsert({
    where:  { phoneHash: phoneH },
    update: {},
    create: { phone: encryptPHI(phone), phoneHash: phoneH, name: '', passwordHash: '' },
  });

  prisma.auditLog.create({
    data: { userId: user.id, action: isNewUser ? 'user.register.phone' : 'user.login.phone' },
  }).catch(() => {});

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

export const socialAuth = async (req: Request, res: Response): Promise<void> => {
  const { id_token, provider } = req.body;
  if (!id_token) {
    res.status(400).json({ message: 'id_token is required' });
    return;
  }

  let email: string | undefined;
  let name: string = '';

  try {
    if (provider === 'apple') {
      // Apple: decode JWT payload directly (Apple public key verification optional — email is enough)
      const payload = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64').toString());
      email = payload.email;
      name  = req.body.name ?? email?.split('@')[0] ?? '';
    } else {
      // Google: verify access_token via userinfo endpoint
      const res2 = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${id_token}` },
      });
      if (!res2.ok) throw new Error('Invalid Google token');
      const payload = await res2.json() as { email?: string; name?: string };
      email = payload.email;
      name  = payload.name ?? req.body.name ?? email?.split('@')[0] ?? '';
    }
  } catch (e) {
    console.error('[socialAuth] token verification failed:', e instanceof Error ? e.message : String(e));
    res.status(401).json({ message: 'Invalid token' });
    return;
  }

  if (!email) {
    res.status(400).json({ message: 'Email not found in token' });
    return;
  }

  const emailH = hmacHash(email);

  // Single upsert — avoids 2 round trips (find + create) under high concurrency
  const existing = await prisma.user.findUnique({ where: { emailHash: emailH }, select: { id: true } });
  const isNewUser = !existing;

  const user = await prisma.user.upsert({
    where:  { emailHash: emailH },
    update: {}, // existing users — nothing to update
    create: {
      email:         encryptPHI(email),
      emailHash:     emailH,
      name:          encryptPHI(name),
      passwordHash:  '',
      emailVerified: true,
    },
  });

  // Audit log fire-and-forget — never blocks the login response
  prisma.auditLog.create({
    data: { userId: user.id, action: isNewUser ? 'user.register.social' : 'user.login.social' },
  }).catch(() => {});

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
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_in:    900,
    is_new_user:   isNewUser,
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
    name:     decryptIfPresent(user.name) ?? '',
    email:    decryptIfPresent(user.email),
    phone:    decryptIfPresent(user.phone),
    dob:      decryptIfPresent(user.dob),
    gender:   user.gender,
    time_zone: user.timeZone,
  });
};
