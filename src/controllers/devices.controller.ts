import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

const connectDeviceSchema = z.object({
  vendor: z.string().min(1),
  model: z.string().min(1),
});

const createConsentSchema = z.object({
  provider_id: z.string().min(1),
  scope: z.string().min(1),
  expires_at: z.string().datetime().optional(),
});

export const connectDevice = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const parsed = connectDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const device = await prisma.device.create({
    data: { userId: user_id, vendor: parsed.data.vendor, model: parsed.data.model },
  });

  res.status(201).json({
    device_id: device.id,
    user_id: device.userId,
    vendor: device.vendor,
    model: device.model,
    last_sync: device.lastSync.toISOString(),
  });
};

export const getConsents = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const consents = await prisma.consent.findMany({ where: { userId: user_id } });
  res.json(
    consents.map((c) => ({
      consent_id: c.id,
      user_id: c.userId,
      provider_id: c.providerId,
      scope: c.scope,
      granted_at: c.grantedAt.toISOString(),
      expires_at: c.expiresAt.toISOString(),
    }))
  );
};

export const createConsent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const parsed = createConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const expiresAt = parsed.data.expires_at
    ? new Date(parsed.data.expires_at)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const consent = await prisma.consent.create({
    data: {
      userId: user_id,
      providerId: parsed.data.provider_id,
      scope: parsed.data.scope,
      expiresAt,
    },
  });

  res.status(201).json({
    consent_id: consent.id,
    user_id: consent.userId,
    provider_id: consent.providerId,
    scope: consent.scope,
    granted_at: consent.grantedAt.toISOString(),
    expires_at: consent.expiresAt.toISOString(),
  });
};
