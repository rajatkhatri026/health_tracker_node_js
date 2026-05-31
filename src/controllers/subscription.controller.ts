import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../utils/prisma';

// ── Helpers ────────────────────────────────────────────────────────────────────

const getISOWeek = (date: Date): { week: number; year: number } => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
};

// How many days does each plan get?
const PLAN_DAYS: Record<string, number> = {
  monthly: 30,
  yearly:  365,
};

// ── GET /users/:user_id/subscription ──────────────────────────────────────────
export const getSubscription = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const sub = await prisma.subscription.findUnique({ where: { userId: user_id } });

  if (!sub) {
    res.json({ status: 'none', plan: null, expiresAt: null, daysLeft: 0, currentStreak: 0, longestStreak: 0, planWeekOffset: 0, trialDaysUnlocked: 0 });
    return;
  }

  const now = new Date();
  const isActive = sub.status === 'active' && sub.expiresAt > now;
  if (sub.status === 'active' && sub.expiresAt <= now) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
  }

  const daysLeft = isActive ? Math.ceil((sub.expiresAt.getTime() - now.getTime()) / 86400000) : 0;
  const daysUsed = Math.floor((now.getTime() - sub.startedAt.getTime()) / 86400000);

  res.json({
    status:         isActive ? 'active' : (sub.status === 'cancelled' ? 'cancelled' : 'expired'),
    plan:           sub.plan,
    expiresAt:      sub.expiresAt.toISOString(),
    startedAt:      sub.startedAt.toISOString(),
    daysLeft,
    daysUsed,
    currentStreak:  sub.currentStreak,
    longestStreak:  sub.longestStreak,
    lastCheckinAt:  sub.lastCheckinAt?.toISOString() ?? null,
    planWeekOffset: sub.planWeekOffset,
    isPaid:         isActive,
  });
};

// ── POST /users/:user_id/subscription/start ───────────────────────────────────
// Body: { plan: 'trial' | 'monthly' | 'yearly' }
export const startSubscription = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { plan } = req.body as { plan?: string };
  if (!plan || !PLAN_DAYS[plan]) {
    res.status(400).json({ message: 'plan must be one of: monthly, yearly' });
    return;
  }

  const existing = await prisma.subscription.findUnique({ where: { userId: user_id } });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_DAYS[plan] * 86400000);

  // Determine week offset for plan rotation (so each user gets a different starting week)
  const { week, year } = getISOWeek(now);
  const planWeekOffset = (week + parseInt(user_id.replace(/\D/g, '').slice(0, 4) || '0', 10)) % 3;

  let sub;
  if (existing) {
    // Upgrade existing subscription
    sub = await prisma.subscription.update({
      where: { userId: user_id },
      data: { plan, status: 'active', startedAt: now, expiresAt, planWeekOffset, updatedAt: now },
    });
  } else {
    sub = await prisma.subscription.create({
      data: { userId: user_id, plan, status: 'active', startedAt: now, expiresAt, planWeekOffset },
    });
  }

  // Audit log
  await prisma.auditLog.create({ data: { userId: user_id, action: `subscription.${plan}.started`, metadata: { plan, expiresAt } } });

  res.status(201).json({
    message:        `${plan} subscription activated!`,
    plan:           sub.plan,
    status:         sub.status,
    expiresAt:      sub.expiresAt.toISOString(),
    daysLeft:       PLAN_DAYS[plan],
    isPaid:         true,
    planWeekOffset: sub.planWeekOffset,
  });
};

// ── POST /users/:user_id/subscription/cancel ──────────────────────────────────
export const cancelSubscription = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const sub = await prisma.subscription.findUnique({ where: { userId: user_id } });
  if (!sub) { res.status(404).json({ message: 'No active subscription' }); return; }

  await prisma.subscription.update({ where: { userId: user_id }, data: { status: 'cancelled' } });
  await prisma.auditLog.create({ data: { userId: user_id, action: 'subscription.cancelled' } });

  res.json({ message: 'Subscription cancelled. Access continues until expiry.', expiresAt: sub.expiresAt.toISOString() });
};

// ── POST /users/:user_id/subscription/checkin ─────────────────────────────────
// Weekly check-in: user updates weight + meal adherence → streak updated → new plan week unlocked
// Body: { weightKg?: number, mealAdherence: number (0–7), notes?: string }
export const weeklyCheckin = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const sub = await prisma.subscription.findUnique({ where: { userId: user_id } });
  if (!sub || sub.status !== 'active' || sub.expiresAt < new Date()) {
    res.status(403).json({ message: 'Active subscription required for check-in' });
    return;
  }

  const { weightKg, mealAdherence = 0, notes } = req.body as { weightKg?: number; mealAdherence?: number; notes?: string };
  const { week, year } = getISOWeek(new Date());

  // Upsert this week's check-in
  await prisma.weeklyCheckin.upsert({
    where:  { userId_weekNumber_year: { userId: user_id, weekNumber: week, year } },
    create: { userId: user_id, subscriptionId: sub.id, weekNumber: week, year, weightKg, mealAdherence: mealAdherence ?? 0, notes },
    update: { weightKg, mealAdherence: mealAdherence ?? 0, notes },
  });

  // Save weight as a metric
  if (weightKg && weightKg > 0) {
    await prisma.metric.create({
      data: { userId: user_id, type: 'weight', value: weightKg, unit: 'kg', timestamp: new Date(), source: 'checkin' },
    });
  }

  // Update streak
  const now = new Date();
  const lastCheckin = sub.lastCheckinAt;
  let newStreak = sub.currentStreak;

  if (!lastCheckin) {
    newStreak = 1;
  } else {
    const daysSinceLast = Math.floor((now.getTime() - lastCheckin.getTime()) / 86400000);
    if (daysSinceLast <= 8) {
      newStreak += 1; // consecutive week
    } else {
      newStreak = 1; // streak broken
    }
  }

  const newLongest = Math.max(newStreak, sub.longestStreak);

  // Advance plan week offset so next week shows a different plan rotation
  const newOffset = (sub.planWeekOffset + 1) % 3;

  await prisma.subscription.update({
    where: { userId: user_id },
    data: { currentStreak: newStreak, longestStreak: newLongest, lastCheckinAt: now, planWeekOffset: newOffset },
  });

  // Motivational message based on streak
  const streakMsg =
    newStreak >= 12 ? `🏆 ${newStreak} week streak! You're unstoppable.` :
    newStreak >= 4  ? `🔥 ${newStreak} week streak! Keep going!` :
    newStreak >= 2  ? `✅ ${newStreak} week streak! Building momentum.` :
    `✅ Check-in complete! Week 1 of your streak.`;

  // New plan rotation message
  const rotationMsg = `Your Week ${week + 1} meal plan is now unlocked with fresh meals!`;

  res.json({
    message:        streakMsg,
    rotationMsg,
    currentStreak:  newStreak,
    longestStreak:  newLongest,
    planWeekOffset: newOffset,
    weekNumber:     week,
    adherence:      mealAdherence,
  });
};

// ── GET /users/:user_id/subscription/checkins ─────────────────────────────────
export const getCheckins = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const checkins = await prisma.weeklyCheckin.findMany({
    where: { userId: user_id },
    orderBy: [{ year: 'desc' }, { weekNumber: 'desc' }],
    take: 12,
  });

  res.json({ checkins });
};
