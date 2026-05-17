import prisma from './prisma';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function runCleanup(): Promise<void> {
  const now = new Date();
  try {
    const [otps, tokens] = await Promise.all([
      // Delete consumed or expired OTPs
      prisma.otpCode.deleteMany({
        where: { OR: [{ consumed: true }, { expiresAt: { lt: now } }] },
      }),
      // Delete expired refresh tokens
      prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);
    console.log(`[Cleanup] Removed ${otps.count} OTPs, ${tokens.count} refresh tokens`);
  } catch (e) {
    console.error('[Cleanup] Failed:', e instanceof Error ? e.message : String(e));
  }
}

export function startCleanupJob(): void {
  // Run once at startup then every 24h
  runCleanup();
  setInterval(runCleanup, INTERVAL_MS);
}
