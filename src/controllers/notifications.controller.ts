import { Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { sendExpoPush } from '../utils/expoPush';

const createSchema = z.object({
  type: z.enum(['reminder', 'summary', 'goal', 'streak', 'system']),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const fmt = (n: {
  id: string; userId: string; type: string; title: string;
  body: string; read: boolean; metadata: unknown; createdAt: Date;
}) => ({
  id: n.id,
  user_id: n.userId,
  type: n.type,
  title: n.title,
  body: n.body,
  read: n.read,
  metadata: n.metadata ?? null,
  created_at: n.createdAt.toISOString(),
});

// GET /users/:user_id/notifications
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const unreadOnly = req.query.unread === 'true';

  const notifications = await prisma.notification.findMany({
    where: { userId: user_id, ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const unreadCount = await prisma.notification.count({ where: { userId: user_id, read: false } });

  res.json({ notifications: notifications.map(fmt), unread_count: unreadCount });
};

// GET /users/:user_id/notifications/unread-count
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const count = await prisma.notification.count({ where: { userId: user_id, read: false } });
  res.json({ unread_count: count });
};

// POST /users/:user_id/notifications
export const createNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const notif = await prisma.notification.create({
    data: {
      userId: user_id,
      type: parsed.data.type,
      title: parsed.data.title,
      body: parsed.data.body,
      metadata: parsed.data.metadata ? (parsed.data.metadata as object) : undefined,
    },
  });

  // Also push to phone — fetch user's Expo push token
  const userRecord = await prisma.user.findUnique({ where: { id: user_id }, select: { pushToken: true } });
  if (userRecord?.pushToken) {
    const meta = parsed.data.metadata ?? {};
    // Skip phone push for alarm-sourced notifications (device already fired them locally)
    const isAlarmSource = (meta as Record<string, unknown>).source === 'alarm';
    if (!isAlarmSource) {
      await sendExpoPush({
        to:    userRecord.pushToken,
        title: parsed.data.title,
        body:  parsed.data.body,
        data:  { notifId: notif.id, type: parsed.data.type, ...(meta as Record<string, unknown>) },
      });
    }
  }

  res.status(201).json(fmt(notif));
};

// PATCH /users/:user_id/notifications/:notif_id/read
export const markRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id, notif_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const existing = await prisma.notification.findFirst({ where: { id: String(notif_id), userId: String(user_id) } });
  if (!existing) { res.status(404).json({ message: 'Not found' }); return; }

  const updated = await prisma.notification.update({ where: { id: String(notif_id) }, data: { read: true } });
  res.json(fmt(updated));
};

// PATCH /users/:user_id/notifications/read-all
export const markAllRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  // updateMany uses implicit transactions — not supported in Neon HTTP mode.
  // Use raw SQL instead which runs as a single statement with no transaction.
  await prisma.$executeRaw`UPDATE "Notification" SET read = true WHERE "userId" = ${user_id} AND read = false`;
  res.json({ message: 'All notifications marked as read' });
};

// DELETE /users/:user_id/notifications/:notif_id
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id, notif_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const existing = await prisma.notification.findFirst({ where: { id: String(notif_id), userId: String(user_id) } });
  if (!existing) { res.status(404).json({ message: 'Not found' }); return; }

  await prisma.notification.delete({ where: { id: String(notif_id) } });
  res.status(204).send();
};

// DELETE /users/:user_id/notifications
export const clearAll = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  await prisma.notification.deleteMany({ where: { userId: user_id } });
  res.status(204).send();
};
