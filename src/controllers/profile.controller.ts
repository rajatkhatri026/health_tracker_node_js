import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { encryptIfPresent, decryptIfPresent, encryptPHI, hmacHash } from '../utils/phi-crypto';

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  time_zone: z.string().optional(),
  height: z.number().optional(),
  baseline_weight: z.number().optional(),
  blood_type: z.string().optional(),
  medical_notes: z.string().optional(),
});

const MAX_AVATAR_BYTES = 500 * 1024; // 500 KB limit

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: user_id },
    include: { profile: true },
  });

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.read' } });

  res.json({
    user_id: user.id,
    name:     decryptIfPresent(user.name) ?? '',
    email:    decryptIfPresent(user.email),
    dob:      decryptIfPresent(user.dob),
    gender:   user.gender,
    time_zone: user.timeZone,
    height:          user.profile?.height,
    baseline_weight: user.profile?.baselineWeight,
    blood_type:      decryptIfPresent(user.profile?.bloodType),
    medical_notes:   decryptIfPresent(user.profile?.medicalNotes),
    // avatar_url intentionally excluded — fetch via GET /profile/avatar to avoid
    // sending large base64 blob on every profile load
  });
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { name, email, dob, gender, time_zone, height, baseline_weight, blood_type, medical_notes } = parsed.data;

  try {
  const user = await prisma.user.update({
    where: { id: user_id },
    data: {
      ...(name  && { name:  encryptPHI(name) }),
      ...(email && { email: encryptPHI(email), emailHash: hmacHash(email) }),
      ...(dob   && { dob:   encryptPHI(dob) }),
      ...(gender     !== undefined && { gender }),
      ...(time_zone  !== undefined && { timeZone: time_zone }),
    },
  });

  const hasProfileData = height !== undefined || baseline_weight !== undefined || blood_type !== undefined || medical_notes !== undefined;
  let profile = null;
  if (hasProfileData) {
    const existing = await prisma.profile.findUnique({ where: { userId: user_id } });
    if (existing) {
      profile = await prisma.profile.update({
        where: { userId: user_id },
        data: {
          ...(height !== undefined && { height }),
          ...(baseline_weight !== undefined && { baselineWeight: baseline_weight }),
          ...(blood_type !== undefined && { bloodType: encryptIfPresent(blood_type) }),
          ...(medical_notes !== undefined && { medicalNotes: encryptIfPresent(medical_notes) }),
        },
      });
    } else {
      profile = await prisma.profile.create({
        data: {
          userId: user_id,
          height,
          baselineWeight: baseline_weight,
          bloodType: encryptIfPresent(blood_type),
          medicalNotes: encryptIfPresent(medical_notes),
        },
      });
    }
  } else {
    profile = await prisma.profile.findUnique({ where: { userId: user_id } });
  }

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.update' } });

  res.json({
    user_id: user.id,
    name:     decryptIfPresent(user.name) ?? '',
    email:    decryptIfPresent(user.email),
    dob:      decryptIfPresent(user.dob),
    gender:   user.gender,
    time_zone: user.timeZone,
    height:          profile?.height,
    baseline_weight: profile?.baselineWeight,
    blood_type:      decryptIfPresent(profile?.bloodType),
    medical_notes:   decryptIfPresent(profile?.medicalNotes),
    // avatar_url intentionally excluded — fetch via GET /profile/avatar
  });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// PUT /users/:user_id/profile/push-token  — save Expo push token
export const savePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { push_token } = req.body as { push_token?: string };
  if (!push_token || typeof push_token !== 'string') {
    res.status(400).json({ message: 'push_token is required' });
    return;
  }

  try {
    await prisma.user.update({ where: { id: user_id }, data: { pushToken: push_token } });
    res.json({ ok: true });
  } catch (err) {
    console.error('savePushToken error:', err);
    res.status(500).json({ message: 'Failed to save push token' });
  }
};

// GET /users/:user_id/profile/avatar  — fetch avatar only (kept separate to avoid bloating main profile response)
export const getAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: user_id },
      select: { avatarUrl: true },
    });
    res.json({ avatar_url: profile?.avatarUrl ?? null });
  } catch (err) {
    console.error('getAvatar error:', err);
    res.status(500).json({ message: 'Failed to get avatar' });
  }
};

// PUT /users/:user_id/profile/avatar  — upload base64 avatar
export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { avatar } = req.body as { avatar?: string };
  if (!avatar || typeof avatar !== 'string') {
    res.status(400).json({ message: 'avatar field (base64 data URI) is required' });
    return;
  }
  // Validate it's a data URI
  if (!avatar.startsWith('data:image/')) {
    res.status(400).json({ message: 'avatar must be a base64 image data URI (data:image/...)' });
    return;
  }
  // Size guard — base64 is ~4/3 of binary size
  if (Buffer.byteLength(avatar, 'utf8') > MAX_AVATAR_BYTES * 1.4) {
    res.status(413).json({ message: 'Image too large. Please use an image under 500 KB.' });
    return;
  }

  try {
    const existing = await prisma.profile.findUnique({ where: { userId: user_id } });
    if (existing) {
      await prisma.profile.update({ where: { userId: user_id }, data: { avatarUrl: avatar } });
    } else {
      await prisma.profile.create({ data: { userId: user_id, avatarUrl: avatar } });
    }
    await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.avatar.upload' } });
    res.json({ avatar_url: avatar });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    res.status(500).json({ message: 'Failed to upload avatar' });
  }
};

// DELETE /users/:user_id/profile/avatar  — remove avatar
export const deleteAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  try {
    // Use upsert instead of updateMany — updateMany uses implicit transactions
    // which are not supported by Neon's HTTP adapter
    await prisma.profile.upsert({
      where: { userId: user_id },
      update: { avatarUrl: null },
      create: { userId: user_id },
    });
    await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.avatar.delete' } });
    res.status(204).send();
  } catch (err) {
    console.error('deleteAvatar error:', err);
    res.status(500).json({ message: 'Failed to delete avatar' });
  }
};

export const exportData = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.data.export' } });

  const metrics = await prisma.metric.findMany({
    where: { userId: user_id },
    orderBy: { timestamp: 'desc' },
  });

  const format = req.query.format as string;

  if (format === 'csv') {
    const header = 'metric_id,type,value,unit,timestamp,source\n';
    const rows = metrics
      .map((m) => `${m.id},${m.type},${m.value},${m.unit},${m.timestamp.toISOString()},${m.source}`)
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="health-data.csv"');
    res.send(header + rows);
  } else {
    res.status(400).json({ message: 'Only csv format is supported currently' });
  }
};
