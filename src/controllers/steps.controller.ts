import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

const syncSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().min(0),
});

const bulkSyncSchema = z.array(syncSchema).min(1).max(30);

// GET /users/:user_id/steps?days=7
export const getSteps = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.params.user_id as string;
    const days = parseInt(req.query.days as string) || 7;

    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const metrics = await prisma.metric.findMany({
      where: { userId, type: 'steps', timestamp: { gte: from } },
      orderBy: { timestamp: 'asc' },
    });

    // Group by date (YYYY-MM-DD), take the latest entry per day
    const byDate = new Map<string, number>();
    metrics.forEach((m) => {
      const d = m.timestamp.toISOString().slice(0, 10);
      byDate.set(d, m.value); // later entries overwrite earlier ones
    });

    // Fill all requested days
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      result.push({ date: dateStr, steps: byDate.get(dateStr) ?? 0 });
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to get steps' });
  }
};

// POST /users/:user_id/steps/sync  — upsert single day
export const syncSteps = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.params.user_id as string;
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }

    const { date, steps } = parsed.data;
    const timestamp = new Date(`${date}T12:00:00.000Z`); // noon UTC to avoid timezone edge cases

    // Delete existing entry for this date then insert fresh
    await prisma.metric.deleteMany({
      where: {
        userId, type: 'steps',
        timestamp: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) },
      },
    });

    await prisma.metric.create({
      data: { userId, type: 'steps', value: steps, unit: 'steps', timestamp, source: 'device' },
    });

    res.json({ date, steps, status: 'synced' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to sync steps' });
  }
};

// POST /users/:user_id/steps/sync/bulk  — upsert multiple days
export const syncStepsBulk = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.params.user_id as string;
    const parsed = bulkSyncSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }

    await Promise.all(parsed.data.map(async ({ date, steps }) => {
      const timestamp = new Date(`${date}T12:00:00.000Z`);
      await prisma.metric.deleteMany({
        where: {
          userId, type: 'steps',
          timestamp: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) },
        },
      });
      await prisma.metric.create({
        data: { userId, type: 'steps', value: steps, unit: 'steps', timestamp, source: 'device' },
      });
    }));

    res.json({ synced: parsed.data.length });
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to bulk sync steps' });
  }
};
