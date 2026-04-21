import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

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

  res.json({
    user_id: user.id,
    name: user.name,
    email: user.email,
    dob: user.dob,
    gender: user.gender,
    time_zone: user.timeZone,
    height: user.profile?.height,
    baseline_weight: user.profile?.baselineWeight,
    blood_type: user.profile?.bloodType,
    medical_notes: user.profile?.medicalNotes,
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
      ...(name && { name }),
      ...(email && { email }),
      ...(dob && { dob: new Date(dob) }),
      ...(gender !== undefined && { gender }),
      ...(time_zone !== undefined && { timeZone: time_zone }),
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
          ...(blood_type !== undefined && { bloodType: blood_type }),
          ...(medical_notes !== undefined && { medicalNotes: medical_notes }),
        },
      });
    } else {
      profile = await prisma.profile.create({
        data: {
          userId: user_id,
          height,
          baselineWeight: baseline_weight,
          bloodType: blood_type,
          medicalNotes: medical_notes,
        },
      });
    }
  } else {
    profile = await prisma.profile.findUnique({ where: { userId: user_id } });
  }

  res.json({
    user_id: user.id,
    name: user.name,
    email: user.email,
    dob: user.dob,
    gender: user.gender,
    time_zone: user.timeZone,
    height: profile?.height,
    baseline_weight: profile?.baselineWeight,
    blood_type: profile?.bloodType,
    medical_notes: profile?.medicalNotes,
  });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const exportData = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

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
