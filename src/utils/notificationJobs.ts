import prisma from './prisma';
import { notifyOnce } from './notify';

// ── Helpers ───────────────────────────────────────────────────────────────────

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function hourUTC(): number {
  return new Date().getUTCHours();
}

// Fetch all active user IDs (users who have at least one metric or workout — i.e. real users)
async function getActiveUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { id: true } });
  return users.map((u) => u.id);
}

// ── Individual job functions ───────────────────────────────────────────────────

/**
 * 9 AM UTC — remind users who haven't logged any steps today.
 * "Low steps" = below 3000 OR no record at all.
 */
async function checkStepsReminder(): Promise<void> {
  const today = utcToday();
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd   = new Date(`${today}T23:59:59.999Z`);
  const LOW_THRESHOLD = 3000;

  const userIds = await getActiveUserIds();

  await Promise.all(
    userIds.map(async (userId) => {
      const stepsMetric = await prisma.metric.findFirst({
        where: { userId, type: 'steps', timestamp: { gte: dayStart, lte: dayEnd } },
      });
      const steps = stepsMetric?.value ?? 0;

      if (steps < LOW_THRESHOLD) {
        await notifyOnce(
          userId, 'reminder',
          steps === 0 ? '🚶 Get Moving Today!' : `🚶 Only ${steps.toLocaleString()} Steps So Far`,
          steps === 0
            ? "You haven't logged any steps yet. Even a short walk makes a difference!"
            : `You're at ${steps.toLocaleString()} steps. Push toward your 10,000 goal — you've got this!`,
          360, // 6-hour dedup window
          { steps, goal: 10000 },
        );
      }
    }),
  );
  console.log('[NotifJobs] Steps reminders checked');
}

/**
 * 2 PM UTC — remind users whose water intake is less than 50% of their goal.
 */
async function checkWaterReminder(): Promise<void> {
  const today = utcToday();
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd   = new Date(`${today}T23:59:59.999Z`);

  const userIds = await getActiveUserIds();

  await Promise.all(
    userIds.map(async (userId) => {
      const waterMetric = await prisma.metric.findFirst({
        where: { userId, type: 'water_intake', timestamp: { gte: dayStart, lte: dayEnd } },
      });

      let intakeMl = 0;
      let goalMl = 2500;

      if (waterMetric) {
        intakeMl = waterMetric.value;
        try { goalMl = JSON.parse(waterMetric.source).goalMl ?? 2500; } catch {}
      }

      const pct = intakeMl / goalMl;

      if (pct < 0.5) {
        const remaining = goalMl - intakeMl;
        await notifyOnce(
          userId, 'reminder',
          intakeMl === 0 ? '💧 You Haven\'t Had Water Today!' : `💧 Low Water Intake — ${Math.round(pct * 100)}% of goal`,
          intakeMl === 0
            ? 'Start hydrating! Aim for at least 2.5L today. Your body will thank you.'
            : `You've had ${(intakeMl / 1000).toFixed(1)}L. Drink ${(remaining / 1000).toFixed(1)}L more to reach your goal.`,
          360,
          { intakeMl, goalMl, percent: Math.round(pct * 100) },
        );
      }
    }),
  );
  console.log('[NotifJobs] Water reminders checked');
}

/**
 * 7 PM UTC — remind users who haven't completed any workout today and have
 * at least one workout scheduled for today that is still 'scheduled'.
 */
async function checkWorkoutReminder(): Promise<void> {
  const today = utcToday();
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd   = new Date(`${today}T23:59:59.999Z`);

  // Find users who have a scheduled (not completed) workout for today
  const pendingWorkouts = await prisma.workout.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { gte: dayStart, lte: dayEnd },
    },
    select: { userId: true, name: true, emoji: true, durationMins: true },
  });

  // Deduplicate by userId
  const seen = new Set<string>();
  await Promise.all(
    pendingWorkouts.map(async (w) => {
      if (seen.has(w.userId)) return;
      seen.add(w.userId);

      await notifyOnce(
        w.userId, 'reminder',
        `${w.emoji} Don't Skip Your Workout Today!`,
        `"${w.name}" (${w.durationMins} min) is waiting. Consistency is the key to results 💪`,
        360,
        { workoutName: w.name },
      );
    }),
  );
  console.log('[NotifJobs] Workout reminders checked');
}

/**
 * 10 PM UTC — remind users who haven't logged any sleep in the last 24 hours.
 * Only fire if they have historically logged sleep (i.e. they use the feature).
 */
async function checkSleepReminder(): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const userIds = await getActiveUserIds();

  await Promise.all(
    userIds.map(async (userId) => {
      // Check if they've ever logged sleep
      const hasSleepHistory = await prisma.metric.findFirst({
        where: { userId, type: 'sleep' },
      });
      if (!hasSleepHistory) return; // never used sleep feature — skip

      // Check if they logged sleep recently
      const recentSleep = await prisma.metric.findFirst({
        where: { userId, type: 'sleep', timestamp: { gte: since } },
      });
      if (recentSleep) return; // already logged

      await notifyOnce(
        userId, 'reminder',
        '😴 Log Your Sleep Tonight',
        "Don't forget to log your sleep. Tracking rest is key to recovery and performance.",
        480,
        {},
      );
    }),
  );
  console.log('[NotifJobs] Sleep reminders checked');
}

/**
 * 8 PM UTC — daily activity summary for users who have data today.
 */
async function sendDailySummary(): Promise<void> {
  const today = utcToday();
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd   = new Date(`${today}T23:59:59.999Z`);

  const userIds = await getActiveUserIds();

  await Promise.all(
    userIds.map(async (userId) => {
      const [stepsMetric, waterMetric, completedWorkouts] = await Promise.all([
        prisma.metric.findFirst({ where: { userId, type: 'steps', timestamp: { gte: dayStart, lte: dayEnd } } }),
        prisma.metric.findFirst({ where: { userId, type: 'water_intake', timestamp: { gte: dayStart, lte: dayEnd } } }),
        prisma.workout.count({ where: { userId, status: 'completed', completedAt: { gte: dayStart, lte: dayEnd } } }),
      ]);

      // Only send if they have at least one data point today
      if (!stepsMetric && !waterMetric && completedWorkouts === 0) return;

      const steps = stepsMetric?.value ?? 0;
      let intakeMl = 0;
      let goalMl = 2500;
      if (waterMetric) {
        intakeMl = waterMetric.value;
        try { goalMl = JSON.parse(waterMetric.source).goalMl ?? 2500; } catch {}
      }

      const parts: string[] = [];
      if (steps > 0) parts.push(`${steps.toLocaleString()} steps`);
      if (intakeMl > 0) parts.push(`${(intakeMl / 1000).toFixed(1)}L water`);
      if (completedWorkouts > 0) parts.push(`${completedWorkouts} workout${completedWorkouts > 1 ? 's' : ''}`);

      if (parts.length === 0) return;

      const stepsGoalMet = steps >= 10000;
      const waterGoalMet = intakeMl >= goalMl;
      const allGood = stepsGoalMet && waterGoalMet && completedWorkouts > 0;

      await notifyOnce(
        userId, 'summary',
        allGood ? '🌟 Amazing Day! All Goals Met' : `📊 Today's Summary`,
        `${parts.join(' • ')}${allGood ? ' — You crushed it today! 🎉' : '. Keep pushing!'}`,
        720, // 12-hour dedup — once per day
        { steps, intakeMl, completedWorkouts },
      );
    }),
  );
  console.log('[NotifJobs] Daily summaries sent');
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

const JOBS: Array<{ name: string; hourUTC: number; fn: () => Promise<void> }> = [
  { name: 'steps-reminder',    hourUTC: 9,  fn: checkStepsReminder },
  { name: 'water-reminder',    hourUTC: 14, fn: checkWaterReminder },
  { name: 'workout-reminder',  hourUTC: 19, fn: checkWorkoutReminder },
  { name: 'daily-summary',     hourUTC: 20, fn: sendDailySummary },
  { name: 'sleep-reminder',    hourUTC: 22, fn: checkSleepReminder },
];

// Track which jobs have fired today to avoid re-running in the same hour
const firedToday = new Map<string, string>(); // jobName → YYYY-MM-DD

async function runDueJobs(): Promise<void> {
  const h = hourUTC();
  const today = utcToday();

  for (const job of JOBS) {
    if (job.hourUTC === h) {
      const lastRun = firedToday.get(job.name);
      if (lastRun === today) continue; // already ran today

      firedToday.set(job.name, today);
      job.fn().catch((e) => console.error(`[NotifJobs] ${job.name} failed:`, e));
    }
  }
}

export function startNotificationJobs(): void {
  // Check every 10 minutes whether any job is due
  runDueJobs();
  setInterval(runDueJobs, 10 * 60 * 1000);
  console.log('[NotifJobs] Notification jobs scheduled');
}
