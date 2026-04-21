import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

const createMetricSchema = z.object({
  type: z.string().min(1),
  value: z.number().positive(),
  unit: z.string().min(1),
  timestamp: z.string().datetime(),
  source: z.string().default('manual'),
});

export const getMetrics = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const { type, from, to } = req.query;
  const where: Record<string, unknown> = { userId: user_id };
  if (type) where.type = type;
  if (from || to) {
    where.timestamp = {
      ...(from ? { gte: new Date(from as string) } : {}),
      ...(to ? { lte: new Date(to as string) } : {}),
    };
  }

  const metrics = await prisma.metric.findMany({
    where,
    orderBy: { timestamp: 'desc' },
  });

  res.json(
    metrics.map((m) => ({
      metric_id: m.id,
      user_id: m.userId,
      type: m.type,
      value: m.value,
      unit: m.unit,
      timestamp: m.timestamp.toISOString(),
      source: m.source,
    }))
  );
};

export const createMetric = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const parsed = createMetricSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { type, value, unit, timestamp, source } = parsed.data;
  const metric = await prisma.metric.create({
    data: { userId: user_id, type, value, unit, timestamp: new Date(timestamp), source },
  });

  res.status(201).json({ metric_id: metric.id, status: 'created' });
};

export const deleteMetric = async (req: AuthRequest, res: Response): Promise<void> => {
  const user_id = req.params.user_id as string;
  const metric_id = req.params.metric_id as string;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const metric = await prisma.metric.findFirst({ where: { id: metric_id, userId: user_id } });
  if (!metric) {
    res.status(404).json({ message: 'Metric not found' });
    return;
  }

  await prisma.metric.delete({ where: { id: metric_id } });
  res.status(204).send();
};
