import prisma from './prisma';

type NotifType = 'reminder' | 'summary' | 'goal' | 'streak' | 'system';

const sendExpoPush = async (pushToken: string, title: string, body: string): Promise<void> => {
  if (!pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ to: pushToken, title, body, sound: 'default', priority: 'high' }),
    });
  } catch {
    // never block
  }
};

const getPushToken = async (userId: string): Promise<string | null> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
    return user?.pushToken ?? null;
  } catch {
    return null;
  }
};

/**
 * Fire-and-forget: saves to DB and sends Expo push notification.
 */
export const notify = (
  userId: string,
  type: NotifType,
  title: string,
  body: string,
  metadata?: Record<string, unknown>,
): void => {
  (async () => {
    try {
      await prisma.notification.create({ data: { userId, type, title, body, metadata } });
      const token = await getPushToken(userId);
      if (token) await sendExpoPush(token, title, body);
    } catch {
      // never block
    }
  })();
};

/**
 * Deduplication guard: only fires if no identical notification within `windowMins`.
 */
export const notifyOnce = async (
  userId: string,
  type: NotifType,
  title: string,
  body: string,
  windowMins = 60,
  metadata?: Record<string, unknown>,
): Promise<void> => {
  try {
    const since = new Date(Date.now() - windowMins * 60 * 1000);
    const existing = await prisma.notification.findFirst({
      where: { userId, title, createdAt: { gte: since } },
    });
    if (existing) return;
    await prisma.notification.create({ data: { userId, type, title, body, metadata } });
    const token = await getPushToken(userId);
    if (token) await sendExpoPush(token, title, body);
  } catch {
    // never block
  }
};
