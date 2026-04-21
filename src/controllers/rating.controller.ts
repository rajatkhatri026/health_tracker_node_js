import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  review: z.string().max(500).optional(),
});

export const submitRating = async (req: AuthRequest, res: Response) => {
  const parsed = ratingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'stars (1–5) is required' });
    return;
  }
  const { stars, review } = parsed.data;
  const userId = req.userId!;

  const rating = await prisma.rating.upsert({
    where: { userId },
    update: { stars, review: review ?? null },
    create: { userId, stars, review: review ?? null },
  });

  res.json({ rating_id: rating.id, stars: rating.stars });
};

export const getMyRating = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const rating = await prisma.rating.findUnique({ where: { userId } });
  res.json(rating ?? null);
};
