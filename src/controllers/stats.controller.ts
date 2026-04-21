import { Request, Response } from 'express';
import prisma from '../utils/prisma';

export const getPlatformStats = async (_req: Request, res: Response) => {
  const [activeUsers, totalWorkouts, avgRatingRaw] = await Promise.all([
    prisma.user.count(),
    prisma.metric.count({ where: { type: 'activity' } }),
    prisma.rating.aggregate({ _avg: { stars: true } }),
  ]);

  const avgRating = avgRatingRaw._avg.stars !== null
    ? parseFloat(avgRatingRaw._avg.stars.toFixed(1))
    : null;

  res.json({
    active_users: activeUsers,
    total_workouts: totalWorkouts,
    avg_rating: avgRating,
  });
};
