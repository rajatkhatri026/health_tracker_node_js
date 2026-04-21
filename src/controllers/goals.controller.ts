import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

const createGoalSchema = z.object({
  metric_type: z.string().min(1),
  target_value: z.number().positive(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  recurrence: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
});

const updateGoalSchema = createGoalSchema.partial();

const formatGoal = (g: {
  id: string; userId: string; metricType: string; targetValue: number;
  currentValue: number | null; startDate: Date; endDate: Date;
  recurrence: string; status: string;
}) => ({
  goal_id: g.id,
  user_id: g.userId,
  metric_type: g.metricType,
  target_value: g.targetValue,
  current_value: g.currentValue ?? undefined,
  start_date: g.startDate.toISOString(),
  end_date: g.endDate.toISOString(),
  recurrence: g.recurrence,
  status: g.status,
});

export const getGoals = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const goals = await prisma.goal.findMany({
    where: { userId: user_id },
    orderBy: { createdAt: 'desc' },
  });

  res.json(goals.map(formatGoal));
};

export const createGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const parsed = createGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { metric_type, target_value, start_date, end_date, recurrence } = parsed.data;
  const goal = await prisma.goal.create({
    data: {
      userId: user_id,
      metricType: metric_type,
      targetValue: target_value,
      startDate: new Date(start_date),
      endDate: new Date(end_date),
      recurrence,
    },
  });

  res.status(201).json({ goal_id: goal.id, status: 'created' });
};

export const updateGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  const user_id = req.params.user_id as string;
  const goal_id = req.params.goal_id as string;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const existing = await prisma.goal.findFirst({ where: { id: goal_id, userId: user_id } });
  if (!existing) {
    res.status(404).json({ message: 'Goal not found' });
    return;
  }

  const parsed = updateGoalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { metric_type, target_value, start_date, end_date, recurrence } = parsed.data;
  const updated = await prisma.goal.update({
    where: { id: goal_id as string },
    data: {
      ...(metric_type && { metricType: metric_type }),
      ...(target_value !== undefined && { targetValue: target_value }),
      ...(start_date && { startDate: new Date(start_date) }),
      ...(end_date && { endDate: new Date(end_date) }),
      ...(recurrence && { recurrence }),
    },
  });

  res.json(formatGoal(updated));
};

export const deleteGoal = async (req: AuthRequest, res: Response): Promise<void> => {
  const user_id = req.params.user_id as string;
  const goal_id = req.params.goal_id as string;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const existing = await prisma.goal.findFirst({ where: { id: goal_id, userId: user_id } });
  if (!existing) {
    res.status(404).json({ message: 'Goal not found' });
    return;
  }

  await prisma.goal.delete({ where: { id: goal_id } });
  res.status(204).send();
};
