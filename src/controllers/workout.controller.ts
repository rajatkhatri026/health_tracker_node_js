import { Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

const exerciseSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  sets: z.number().int().min(1),
  reps: z.number().int().min(1),
  weightKg: z.number().optional(),
  restSecs: z.number().int().optional(),
  completed: z.boolean().default(false),
});

const createWorkoutSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  emoji: z.string().optional(),
  exercises: z.array(exerciseSchema).min(1),
  durationMins: z.number().int().min(1),
  caloriesBurned: z.number().int().min(0).optional(),
  scheduledAt: z.string().datetime(),
});

const createWorkoutBulkSchema = z.array(createWorkoutSchema).min(1).max(30);

const completeWorkoutSchema = z.object({
  exercises: z.array(exerciseSchema),
  durationMins: z.number().int().min(1),
  caloriesBurned: z.number().int().min(0),
});

export const getWorkouts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const { status, from, to, limit = '20', offset = '0' } = req.query as Record<string, string>;
    const workouts = await prisma.workout.findMany({
      where: {
        userId,
        ...(status && { status }),
        ...(from || to ? { scheduledAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } } : {}),
      },
      orderBy: { scheduledAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset),
    });
    res.json(workouts);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to fetch workouts' });
  }
};

export const createWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const parsed = createWorkoutSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }
    const { name, category, emoji, exercises, durationMins, caloriesBurned, scheduledAt } = parsed.data;
    const workout = await prisma.workout.create({
      data: {
        userId, name, category,
        emoji: emoji ?? '🏋️',
        exercises: exercises.map((e: any) => ({ ...e, id: e.id || randomUUID() })),
        durationMins,
        caloriesBurned: caloriesBurned ?? 0,
        scheduledAt,
      },
    });
    res.status(201).json(workout);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to create workout' });
  }
};

export const createWorkoutsBulk = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const parsed = createWorkoutBulkSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }
    const workouts = await Promise.all(
      parsed.data.map(({ name, category, emoji, exercises, durationMins, caloriesBurned, scheduledAt }) =>
        prisma.workout.create({
          data: {
            userId, name, category,
            emoji: emoji ?? '🏋️',
            exercises: exercises.map((e: any) => ({ ...e, id: e.id || randomUUID() })),
            durationMins,
            caloriesBurned: caloriesBurned ?? 0,
            scheduledAt,
          },
        })
      )
    );
    res.status(201).json(workouts);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to create workouts' });
  }
};

export const updateWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const workoutId = req.params.workout_id as string;
    const parsed = createWorkoutSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }
    const { name, category, emoji, exercises, durationMins, scheduledAt } = parsed.data;
    const workout = await prisma.workout.update({
      where: { id: workoutId, userId },
      data: {
        name, category,
        emoji: emoji ?? '🏋️',
        exercises: exercises.map((e: any) => ({ ...e, id: e.id || randomUUID() })),
        durationMins,
        scheduledAt,
      },
    });
    res.json(workout);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to update workout' });
  }
};

export const completeWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const workoutId = req.params.workout_id as string;
    const parsed = completeWorkoutSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: parsed.error.issues[0].message }); return; }
    const { exercises, durationMins, caloriesBurned } = parsed.data;
    const workout = await prisma.workout.update({
      where: { id: workoutId, userId },
      data: { exercises, durationMins, caloriesBurned, status: 'completed', completedAt: new Date() },
    });
    await prisma.metric.create({
      data: { userId, type: 'activity', value: durationMins, unit: 'mins', timestamp: new Date(), source: 'manual' },
    });
    res.json(workout);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to complete workout' });
  }
};

export const deleteWorkoutsBulk = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: 'ids array is required' }); return;
    }
    const { count } = await prisma.workout.deleteMany({ where: { id: { in: ids }, userId } });
    res.json({ deleted: count });
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to delete workouts' });
  }
};

export const deleteWorkout = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const workoutId = req.params.workout_id as string;
    await prisma.workout.delete({ where: { id: workoutId, userId } });
    res.json({ status: 'deleted' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to delete workout' });
  }
};

export const getWorkoutStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.user_id as string;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalCompleted, weeklyWorkouts, totalCalories] = await Promise.all([
      prisma.workout.count({ where: { userId, status: 'completed' } }),
      prisma.workout.findMany({
        where: { userId, status: 'completed', completedAt: { gte: weekAgo } },
        select: { completedAt: true, durationMins: true, caloriesBurned: true },
      }),
      prisma.workout.aggregate({
        where: { userId, status: 'completed' },
        _sum: { caloriesBurned: true, durationMins: true },
      }),
    ]);
    const dailyCounts = Array(7).fill(0);
    weeklyWorkouts.forEach((w) => {
      const daysAgo = Math.floor((Date.now() - new Date(w.completedAt!).getTime()) / (24 * 60 * 60 * 1000));
      const idx = 6 - daysAgo;
      if (idx >= 0 && idx < 7) dailyCounts[idx]++;
    });
    res.json({
      total_completed: totalCompleted,
      total_calories_burned: totalCalories._sum.caloriesBurned ?? 0,
      total_mins: totalCalories._sum.durationMins ?? 0,
      weekly_counts: dailyCounts,
      this_week: weeklyWorkouts.length,
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? 'Failed to fetch stats' });
  }
};
