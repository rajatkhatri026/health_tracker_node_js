import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { notifyOnce } from '../utils/notify';

const upsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  intakeMl: z.number().min(0),
  goalMl: z.number().positive(),
});

// GET /users/:user_id/water?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getWater = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { from, to } = req.query;

  // Build timestamp range — default to today if no params given
  const start = from ? new Date(`${from}T00:00:00.000Z`) : (() => { const d = new Date(); d.setUTCHours(0,0,0,0); return d; })();
  const end   = to   ? new Date(`${to}T23:59:59.999Z`)   : (() => { const d = new Date(); d.setUTCHours(23,59,59,999); return d; })();

  const rows = await prisma.metric.findMany({
    where: { userId: user_id, type: 'water_intake', timestamp: { gte: start, lte: end } },
    orderBy: { timestamp: 'asc' },
  });

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.water.read' } });

  res.json(rows.map((r) => {
    let goalMl = 2500;
    try { goalMl = JSON.parse(r.source).goalMl ?? 2500; } catch {}
    return { id: r.id, date: r.timestamp.toISOString().slice(0, 10), intakeMl: r.value, goalMl };
  }));
};

// PUT /users/:user_id/water/:date  — upsert one day's record
export const upsertWater = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id, date } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const parsed = upsertSchema.safeParse({ date, ...req.body });
  if (!parsed.success) { res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() }); return; }

  const { intakeMl, goalMl } = parsed.data;
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd   = new Date(`${date}T23:59:59.999Z`);

  // Find existing record for this day
  const existing = await prisma.metric.findFirst({
    where: { userId: user_id, type: 'water_intake', timestamp: { gte: dayStart, lte: dayEnd } },
  });

  // We store goalMl in the `source` field as JSON, intakeMl in `value`, unit = 'ml'
  const sourceJson = JSON.stringify({ goalMl });

  let record;
  if (existing) {
    record = await prisma.metric.update({
      where: { id: existing.id },
      data: { value: intakeMl, source: sourceJson },
    });
  } else {
    record = await prisma.metric.create({
      data: {
        userId: user_id,
        type: 'water_intake',
        value: intakeMl,
        unit: 'ml',
        timestamp: new Date(`${date}T12:00:00.000Z`),
        source: sourceJson,
      },
    });
  }

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.water.upsert', metadata: { date, intakeMl, goalMl } } });

  // Notify once per day when goal is first reached
  const todayStr = new Date().toISOString().slice(0, 10);
  if (date === todayStr && intakeMl >= goalMl) {
    notifyOnce(user_id, 'goal', '💧 Hydration Goal Reached!',
      `You've hit your ${(goalMl / 1000).toFixed(1)}L water goal for today. Stay refreshed! 💪`,
      360, { intakeMl, goalMl });
  }

  res.json({
    id: record.id,
    date,
    intakeMl: record.value,
    goalMl,
  });
};
