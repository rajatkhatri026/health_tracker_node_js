import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { notifyOnce } from '../utils/notify';

const STEPS_GOAL = 10000; // default daily goal

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
    from.setUTCDate(from.getUTCDate() - (days - 1));
    from.setUTCHours(0, 0, 0, 0);

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

    // Fill all requested days using UTC dates to match stored timestamps
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      result.push({ date: dateStr, steps: byDate.get(dateStr) ?? 0 });
    }

    await prisma.auditLog.create({ data: { userId, action: 'phi.steps.read' } });
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
    const rangeStart = new Date(`${date}T00:00:00.000Z`);
    const rangeEnd   = new Date(`${date}T23:59:59.999Z`);

    // For past days: only update if the new value is greater (steps are final once the day ends).
    // For today: always allow the device to set the authoritative value — it reflects
    // the live pedometer count and may legitimately be lower than a previously-synced stale value.
    const todayStr = new Date().toISOString().slice(0, 10); // UTC date
    const isPastDay = date < todayStr;

    if (isPastDay) {
      const existing = await prisma.metric.findFirst({
        where: { userId, type: 'steps', timestamp: { gte: rangeStart, lte: rangeEnd } },
      });
      if (existing && existing.value >= steps) {
        res.json({ date, steps: existing.value, status: 'unchanged' });
        return;
      }
    }

    await prisma.metric.deleteMany({
      where: { userId, type: 'steps', timestamp: { gte: rangeStart, lte: rangeEnd } },
    });

    await prisma.metric.create({
      data: { userId, type: 'steps', value: steps, unit: 'steps', timestamp, source: 'device' },
    });

    // Notify once when daily goal is first crossed today
    const todayStr2 = new Date().toISOString().slice(0, 10);
    if (date === todayStr2 && steps >= STEPS_GOAL) {
      notifyOnce(userId, 'goal', '🚶 Daily Steps Goal Reached!',
        `You've hit ${steps.toLocaleString()} steps today. Goal crushed! 🎉`,
        240, { steps, goal: STEPS_GOAL });
    }

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

    const todayStr = new Date().toISOString().slice(0, 10); // UTC date

    await Promise.all(parsed.data.map(async ({ date, steps }) => {
      const timestamp  = new Date(`${date}T12:00:00.000Z`);
      const rangeStart = new Date(`${date}T00:00:00.000Z`);
      const rangeEnd   = new Date(`${date}T23:59:59.999Z`);
      const isPastDay  = date < todayStr;

      if (isPastDay) {
        const existing = await prisma.metric.findFirst({
          where: { userId, type: 'steps', timestamp: { gte: rangeStart, lte: rangeEnd } },
        });
        // Past days are final — only update if the device reports a higher count
        if (existing && existing.value >= steps) return;
      }

      await prisma.metric.deleteMany({
        where: { userId, type: 'steps', timestamp: { gte: rangeStart, lte: rangeEnd } },
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
