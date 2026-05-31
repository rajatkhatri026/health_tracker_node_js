import path from 'path';
import { Response } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { encryptIfPresent, decryptIfPresent, encryptPHI, hmacHash } from '../utils/phi-crypto';

const LOGO_PATH = path.join(__dirname, '../assets/logo.png');

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  time_zone: z.string().optional(),
  height: z.number().optional(),
  baseline_weight: z.number().optional(),
  blood_type: z.string().optional(),
  medical_notes: z.string().optional(),
});

const MAX_AVATAR_BYTES = 500 * 1024; // 500 KB limit

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: user_id },
    include: { profile: true },
  });

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.read' } });

  res.json({
    user_id: user.id,
    name:     decryptIfPresent(user.name) ?? '',
    email:    decryptIfPresent(user.email),
    dob:      decryptIfPresent(user.dob),
    gender:   user.gender,
    time_zone: user.timeZone,
    height:          user.profile?.height,
    baseline_weight: user.profile?.baselineWeight,
    blood_type:      decryptIfPresent(user.profile?.bloodType),
    medical_notes:   decryptIfPresent(user.profile?.medicalNotes),
    // avatar_url intentionally excluded — fetch via GET /profile/avatar to avoid
    // sending large base64 blob on every profile load
  });
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid input', errors: parsed.error.flatten() });
    return;
  }

  const { name, email, dob, gender, time_zone, height, baseline_weight, blood_type, medical_notes } = parsed.data;

  try {
  const user = await prisma.user.update({
    where: { id: user_id },
    data: {
      ...(name  && { name:  encryptPHI(name) }),
      ...(email && { email: encryptPHI(email), emailHash: hmacHash(email) }),
      ...(dob   && { dob:   encryptPHI(dob) }),
      ...(gender     !== undefined && { gender }),
      ...(time_zone  !== undefined && { timeZone: time_zone }),
    },
  });

  const hasProfileData = height !== undefined || baseline_weight !== undefined || blood_type !== undefined || medical_notes !== undefined;
  let profile = null;
  if (hasProfileData) {
    const existing = await prisma.profile.findUnique({ where: { userId: user_id } });
    if (existing) {
      profile = await prisma.profile.update({
        where: { userId: user_id },
        data: {
          ...(height !== undefined && { height }),
          ...(baseline_weight !== undefined && { baselineWeight: baseline_weight }),
          ...(blood_type !== undefined && { bloodType: encryptIfPresent(blood_type) }),
          ...(medical_notes !== undefined && { medicalNotes: encryptIfPresent(medical_notes) }),
        },
      });
    } else {
      profile = await prisma.profile.create({
        data: {
          userId: user_id,
          height,
          baselineWeight: baseline_weight,
          bloodType: encryptIfPresent(blood_type),
          medicalNotes: encryptIfPresent(medical_notes),
        },
      });
    }
  } else {
    profile = await prisma.profile.findUnique({ where: { userId: user_id } });
  }

  await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.update' } });

  res.json({
    user_id: user.id,
    name:     decryptIfPresent(user.name) ?? '',
    email:    decryptIfPresent(user.email),
    dob:      decryptIfPresent(user.dob),
    gender:   user.gender,
    time_zone: user.timeZone,
    height:          profile?.height,
    baseline_weight: profile?.baselineWeight,
    blood_type:      decryptIfPresent(profile?.bloodType),
    medical_notes:   decryptIfPresent(profile?.medicalNotes),
    // avatar_url intentionally excluded — fetch via GET /profile/avatar
  });
  } catch (err) {
    console.error('updateProfile error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// PUT /users/:user_id/profile/push-token  — save Expo push token
export const savePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { push_token } = req.body as { push_token?: string };
  if (!push_token || typeof push_token !== 'string') {
    res.status(400).json({ message: 'push_token is required' });
    return;
  }

  try {
    await prisma.user.update({ where: { id: user_id }, data: { pushToken: push_token } });
    res.json({ ok: true });
  } catch (err) {
    console.error('savePushToken error:', err);
    res.status(500).json({ message: 'Failed to save push token' });
  }
};

// GET /users/:user_id/profile/avatar  — fetch avatar only (kept separate to avoid bloating main profile response)
export const getAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId: user_id },
      select: { avatarUrl: true },
    });
    res.json({ avatar_url: profile?.avatarUrl ?? null });
  } catch (err) {
    console.error('getAvatar error:', err);
    res.status(500).json({ message: 'Failed to get avatar' });
  }
};

// PUT /users/:user_id/profile/avatar  — upload base64 avatar
export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { avatar } = req.body as { avatar?: string };
  if (!avatar || typeof avatar !== 'string') {
    res.status(400).json({ message: 'avatar field (base64 data URI) is required' });
    return;
  }
  // Validate it's a data URI
  if (!avatar.startsWith('data:image/')) {
    res.status(400).json({ message: 'avatar must be a base64 image data URI (data:image/...)' });
    return;
  }
  // Size guard — base64 is ~4/3 of binary size
  if (Buffer.byteLength(avatar, 'utf8') > MAX_AVATAR_BYTES * 1.4) {
    res.status(413).json({ message: 'Image too large. Please use an image under 500 KB.' });
    return;
  }

  try {
    const existing = await prisma.profile.findUnique({ where: { userId: user_id } });
    if (existing) {
      await prisma.profile.update({ where: { userId: user_id }, data: { avatarUrl: avatar } });
    } else {
      await prisma.profile.create({ data: { userId: user_id, avatarUrl: avatar } });
    }
    await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.avatar.upload' } });
    res.json({ avatar_url: avatar });
  } catch (err) {
    console.error('uploadAvatar error:', err);
    res.status(500).json({ message: 'Failed to upload avatar' });
  }
};

// DELETE /users/:user_id/profile/avatar  — remove avatar
export const deleteAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  try {
    // Use upsert instead of updateMany — updateMany uses implicit transactions
    // which are not supported by Neon's HTTP adapter
    await prisma.profile.upsert({
      where: { userId: user_id },
      update: { avatarUrl: null },
      create: { userId: user_id },
    });
    await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.profile.avatar.delete' } });
    res.status(204).send();
  } catch (err) {
    console.error('deleteAvatar error:', err);
    res.status(500).json({ message: 'Failed to delete avatar' });
  }
};

export const exportData = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  try {
    // Fetch all data in parallel
    const [user, metrics, goals, workouts] = await Promise.all([
      prisma.user.findUnique({ where: { id: user_id }, include: { profile: true } }),
      prisma.metric.findMany({ where: { userId: user_id }, orderBy: { timestamp: 'desc' }, take: 100 }),
      prisma.goal.findMany({ where: { userId: user_id }, orderBy: { createdAt: 'desc' } }),
      prisma.workout.findMany({ where: { userId: user_id }, orderBy: { scheduledAt: 'desc' }, take: 20 }),
    ]);

    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.data.export' } });

    // Decrypt all PHI fields
    const name      = decryptIfPresent(user.name) ?? 'User';
    const phone     = decryptIfPresent(user.phone) ?? '—';
    const dob       = decryptIfPresent(user.dob);
    const bloodType = decryptIfPresent(user.profile?.bloodType) ?? '—';
    const height    = user.profile?.height;
    const weight    = user.profile?.baselineWeight;
    const bmi       = height && weight ? (weight / Math.pow(height / 100, 2)).toFixed(1) : null;
    const bmiLabel  = bmi ? (parseFloat(bmi) < 18.5 ? 'Underweight' : parseFloat(bmi) < 25 ? 'Normal' : parseFloat(bmi) < 30 ? 'Overweight' : 'Obese') : null;

    const dobFormatted = dob ? (() => {
      try { return new Date(dob).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }); }
      catch { return dob; }
    })() : '—';

    const exportDate = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    const firstName  = name.split(' ')[0];
    const dateStr    = new Date().toISOString().slice(0, 10);
    const fileName   = `Nexara_Health_Report_${firstName}_${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4', autoFirstPage: true });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const LEFT  = 50;
    const COL2  = 260;
    const RIGHT = pageW - 50;

    // ── Watermark helper (called after addPage too) ───────────────────────
    const drawWatermark = () => {
      doc.save();
      // big faint "NEXARA" diagonal text
      doc.opacity(0.04)
         .fontSize(90).font('Helvetica-Bold').fillColor('#0891B2')
         .rotate(-45, { origin: [pageW / 2, pageH / 2] })
         .text('NEXARA', 0, pageH / 2 - 50, { align: 'center', width: pageW, lineBreak: false });
      doc.restore();
    };

    // Draw watermark on first page
    drawWatermark();

    // Auto-draw watermark on every new page
    doc.on('pageAdded', drawWatermark);

    // ── Header banner ────────────────────────────────────────────────────
    // Dark gradient-like background (two rects for depth illusion)
    doc.rect(0, 0, pageW, 90).fill('#0C2340');
    doc.rect(0, 60, pageW, 30).fill('#0A1F35');

    // Cyan accent bar at bottom of header
    doc.rect(0, 88, pageW, 4).fill('#0891B2');

    // Logo — top-left in header
    try {
      doc.image(LOGO_PATH, LEFT, 12, { width: 52, height: 52 });
    } catch { /* logo missing — skip */ }

    // Title text beside logo
    doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold')
       .text('Nexara', LEFT + 62, 18, { lineBreak: false });
    doc.fillColor('#BAE6FD').fontSize(10).font('Helvetica')
       .text('Health Report', LEFT + 62, 44, { lineBreak: false });

    // Export date + name — right side of header
    doc.fillColor('#BAE6FD').fontSize(8).font('Helvetica')
       .text(`Exported: ${exportDate}`, 0, 20, { align: 'right', width: pageW - LEFT, lineBreak: false });
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica')
       .text(name, 0, 34, { align: 'right', width: pageW - LEFT, lineBreak: false });

    // Thin cyan decorative line below header
    doc.y = 108;

    // ── Helpers ──────────────────────────────────────────────────────────
    const ROW_H = 20;
    const BOTTOM_MARGIN = 70;

    const checkPage = () => {
      if (doc.y + ROW_H + 30 > doc.page.height - BOTTOM_MARGIN) doc.addPage();
    };

    const sectionHeader = (title: string) => {
      checkPage();
      const sy = doc.y + 12;
      // Full cyan banner
      doc.rect(LEFT, sy, RIGHT - LEFT, 22).fill('#0891B2');
      // Brighter left accent strip
      doc.rect(LEFT, sy, 4, 22).fill('#38BDF8');
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
         .text(title, LEFT + 14, sy + 7, { width: RIGHT - LEFT - 24, lineBreak: false });
      doc.y = sy + 26;
    };

    const dataRow = (label: string, value: string, shaded: boolean) => {
      checkPage();
      const ry = doc.y;
      if (shaded) doc.rect(LEFT, ry, RIGHT - LEFT, ROW_H).fill('#F4F5FA');
      doc.rect(LEFT, ry, RIGHT - LEFT, ROW_H).stroke('#E4E7F0');
      doc.fillColor('#6B7280').fontSize(9).font('Helvetica')
         .text(label, LEFT + 10, ry + 5, { width: COL2 - LEFT - 20, lineBreak: false });
      doc.fillColor('#0F0F1A').fontSize(9).font('Helvetica-Bold')
         .text(value, COL2, ry + 5, { width: RIGHT - COL2 - 10, lineBreak: false });
      doc.y = ry + ROW_H;
    };

    // ── Personal Info ────────────────────────────────────────────────────
    sectionHeader('PERSONAL INFO');
    dataRow('Full Name',     name,               false);
    dataRow('Phone',         phone,              true);
    dataRow('Gender',        user.gender ?? '—', false);
    dataRow('Date of Birth', dobFormatted,       true);

    // ── Body Metrics ─────────────────────────────────────────────────────
    sectionHeader('BODY METRICS');
    dataRow('Height',     height ? `${height} cm`         : '—', false);
    dataRow('Weight',     weight ? `${weight} kg`         : '—', true);
    dataRow('BMI',        bmi    ? `${bmi} (${bmiLabel})` : '—', false);
    dataRow('Blood Type', bloodType,                              true);

    // ── Active Goals ──────────────────────────────────────────────────────
    const activeGoals = goals.filter(g => g.status === 'active');
    if (activeGoals.length > 0) {
      sectionHeader('ACTIVE GOALS');
      activeGoals.slice(0, 8).forEach((g, i) => {
        const metric = g.metricType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        dataRow(metric, `Target: ${g.targetValue}`, i % 2 === 0);
      });
    }

    // ── Health Metrics — deduplicated, one entry per day per type ─────────
    type MetricRow = { timestamp: Date; value: number; unit: string };
    const SHOW_TYPES: { type: string; label: string; unit: string }[] = [
      { type: 'steps',      label: 'STEPS (Last 7 Days)',        unit: 'steps' },
      { type: 'water',      label: 'WATER INTAKE (Last 7 Days)', unit: 'ml'    },
      { type: 'calories',   label: 'CALORIES (Last 7 Days)',     unit: 'kcal'  },
      { type: 'weight',     label: 'WEIGHT LOG',                 unit: 'kg'    },
      { type: 'heart_rate', label: 'HEART RATE',                 unit: 'bpm'   },
      { type: 'sleep',      label: 'SLEEP',                      unit: 'hrs'   },
    ];

    for (const { type, label, unit } of SHOW_TYPES) {
      // Deduplicate: one entry per calendar date (latest timestamp wins)
      const byDate: Record<string, MetricRow> = {};
      metrics
        .filter(m => m.type === type)
        .forEach(m => {
          const d = new Date(m.timestamp).toISOString().slice(0, 10);
          if (!byDate[d] || m.timestamp > byDate[d].timestamp)
            byDate[d] = { timestamp: m.timestamp, value: m.value, unit: m.unit };
        });

      const rows = Object.values(byDate)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 7);

      if (rows.length === 0) continue;

      sectionHeader(label);
      rows.forEach((m, i) => {
        const d = new Date(m.timestamp).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        const displayUnit = m.unit || unit;
        dataRow(d, `${Math.round(m.value).toLocaleString()} ${displayUnit}`, i % 2 === 0);
      });
    }

    // ── Recent Workouts ───────────────────────────────────────────────────
    const completedWorkouts = workouts.filter(w => w.status === 'completed').slice(0, 7);
    if (completedWorkouts.length > 0) {
      sectionHeader('RECENT WORKOUTS');
      completedWorkouts.forEach((w, i) => {
        const d = new Date(w.scheduledAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        dataRow(d, `${w.name}  ·  ${w.durationMins} min  ·  ${w.caloriesBurned} kcal`, i % 2 === 0);
      });
    }

    // ── Footer ────────────────────────────────────────────────────────────
    doc.y += 20;
    // Cyan accent line above footer
    doc.rect(LEFT, doc.y, RIGHT - LEFT, 2).fill('#0891B2');
    doc.y += 8;
    doc.fontSize(7.5).font('Helvetica').fillColor('#9CA3AF')
       .text(
         'Generated by Nexara  ·  nexara.app  ·  This document contains personal health data. Keep it confidential.',
         LEFT, doc.y, { align: 'center', width: RIGHT - LEFT }
       );

    doc.end();

  } catch (err) {
    console.error('exportData error:', err);
    res.status(500).json({ message: 'Failed to generate export' });
  }
};

// ── Weekly Report PDF ─────────────────────────────────────────────────────────
export const exportWeeklyReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  try {
    // Week boundaries (Mon–Sun)
    const now  = new Date();
    const day  = now.getDay() || 7;
    const mon  = new Date(now); mon.setDate(now.getDate() - day + 1); mon.setHours(0, 0, 0, 0);
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);       sun.setHours(23, 59, 59, 999);

    const [user, metrics, workouts] = await Promise.all([
      prisma.user.findUnique({ where: { id: user_id }, include: { profile: true } }),
      prisma.metric.findMany({
        where: { userId: user_id, timestamp: { gte: mon, lte: sun } },
        orderBy: { timestamp: 'asc' },
      }),
      prisma.workout.findMany({
        where: { userId: user_id, scheduledAt: { gte: mon, lte: sun } },
        orderBy: { scheduledAt: 'asc' },
      }),
    ]);

    if (!user) { res.status(404).json({ message: 'User not found' }); return; }

    await prisma.auditLog.create({ data: { userId: user_id, action: 'phi.weekly.report.export' } });

    const name      = decryptIfPresent(user.name) ?? 'User';
    const firstName = name.split(' ')[0];
    const fmt       = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const weekRange = `${fmt(mon)} – ${fmt(sun)}`;
    const exportDate = now.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    const fileName  = `Nexara_Weekly_Report_${firstName}_${now.toISOString().slice(0, 10)}.pdf`;

    // ── Derived stats ─────────────────────────────────────────────────
    const completedWorkouts = workouts.filter(w => w.status === 'completed');
    const totalCaloriesBurned = completedWorkouts.reduce((s, w) => s + (w.caloriesBurned ?? 0), 0);
    const totalWorkoutMins    = completedWorkouts.reduce((s, w) => s + (w.durationMins ?? 0), 0);

    // Latest metric per type this week
    const latestByType: Record<string, typeof metrics[0]> = {};
    metrics.forEach(m => { latestByType[m.type] = m; });

    // Daily steps/water/calories — deduplicated by date
    type DayMetric = { date: string; value: number; unit: string };
    const dedupByDay = (type: string): DayMetric[] => {
      const byDate: Record<string, typeof metrics[0]> = {};
      metrics.filter(m => m.type === type).forEach(m => {
        const d = new Date(m.timestamp).toISOString().slice(0, 10);
        if (!byDate[d] || m.timestamp > byDate[d].timestamp) byDate[d] = m;
      });
      return Object.values(byDate)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(m => ({
          date: new Date(m.timestamp).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          value: Math.round(m.value),
          unit: m.unit,
        }));
    };

    const stepsDays    = dedupByDay('steps');
    const waterDays    = dedupByDay('water');
    const caloriesDays = dedupByDay('calories');

    // ── PDF ───────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const doc  = new PDFDocument({ margin: 50, size: 'A4', autoFirstPage: true });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const LEFT  = 50;
    const RIGHT = pageW - 50;
    const COL2  = 260;
    const ROW_H = 20;
    const BOTTOM_MARGIN = 70;

    // ── Watermark ─────────────────────────────────────────────────────
    const drawWatermark = () => {
      doc.save();
      doc.opacity(0.04).fontSize(90).font('Helvetica-Bold').fillColor('#0891B2')
         .rotate(-45, { origin: [pageW / 2, pageH / 2] })
         .text('NEXARA', 0, pageH / 2 - 50, { align: 'center', width: pageW, lineBreak: false });
      doc.restore();
    };
    drawWatermark();
    doc.on('pageAdded', drawWatermark);

    // ── Header banner ─────────────────────────────────────────────────
    doc.rect(0, 0, pageW, 90).fill('#0C2340');
    doc.rect(0, 60, pageW, 30).fill('#0A1F35');
    doc.rect(0, 88, pageW, 4).fill('#0891B2');
    try { doc.image(LOGO_PATH, LEFT, 12, { width: 52, height: 52 }); } catch {}
    doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('Nexara', LEFT + 62, 18, { lineBreak: false });
    doc.fillColor('#BAE6FD').fontSize(10).font('Helvetica').text('Weekly Report', LEFT + 62, 44, { lineBreak: false });
    doc.fillColor('#BAE6FD').fontSize(8).text(`Exported: ${exportDate}`, 0, 20, { align: 'right', width: pageW - LEFT, lineBreak: false });
    doc.fillColor('#FFFFFF').fontSize(8).text(`${name}  ·  ${weekRange}`, 0, 34, { align: 'right', width: pageW - LEFT, lineBreak: false });
    doc.y = 108;

    // ── Helpers ───────────────────────────────────────────────────────
    const checkPage = () => {
      if (doc.y + ROW_H + 30 > pageH - BOTTOM_MARGIN) doc.addPage();
    };

    const sectionHeader = (title: string) => {
      checkPage();
      const sy = doc.y + 12;
      doc.rect(LEFT, sy, RIGHT - LEFT, 22).fill('#0891B2');
      doc.rect(LEFT, sy, 4, 22).fill('#38BDF8');
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
         .text(title, LEFT + 14, sy + 7, { width: RIGHT - LEFT - 24, lineBreak: false });
      doc.y = sy + 26;
    };

    const dataRow = (label: string, value: string, shaded: boolean) => {
      checkPage();
      const ry = doc.y;
      if (shaded) doc.rect(LEFT, ry, RIGHT - LEFT, ROW_H).fill('#F4F5FA');
      doc.rect(LEFT, ry, RIGHT - LEFT, ROW_H).stroke('#E4E7F0');
      doc.fillColor('#6B7280').fontSize(9).font('Helvetica')
         .text(label, LEFT + 10, ry + 5, { width: COL2 - LEFT - 20, lineBreak: false });
      doc.fillColor('#0F0F1A').fontSize(9).font('Helvetica-Bold')
         .text(value, COL2, ry + 5, { width: RIGHT - COL2 - 10, lineBreak: false });
      doc.y = ry + ROW_H;
    };

    // ── Summary ───────────────────────────────────────────────────────
    sectionHeader('WEEK SUMMARY');
    dataRow('Week',                weekRange,                                              false);
    dataRow('Workouts Completed',  `${completedWorkouts.length} of ${workouts.length}`,    true);
    dataRow('Total Workout Time',  totalWorkoutMins > 0 ? `${totalWorkoutMins} min`  : '—', false);
    dataRow('Calories Burned',     totalCaloriesBurned > 0 ? `${totalCaloriesBurned} kcal` : '—', true);
    dataRow('Latest Weight',       latestByType['weight']     ? `${latestByType['weight'].value} kg`    : '—', false);
    dataRow('Latest Sleep',        latestByType['sleep']      ? `${latestByType['sleep'].value} hrs`    : '—', true);
    dataRow('Latest Heart Rate',   latestByType['heart_rate'] ? `${latestByType['heart_rate'].value} bpm` : '—', false);

    // ── Daily Steps ───────────────────────────────────────────────────
    if (stepsDays.length > 0) {
      sectionHeader('DAILY STEPS');
      stepsDays.forEach((d, i) => dataRow(d.date, `${d.value.toLocaleString()} ${d.unit}`, i % 2 === 0));
    }

    // ── Daily Water ───────────────────────────────────────────────────
    if (waterDays.length > 0) {
      sectionHeader('DAILY WATER INTAKE');
      waterDays.forEach((d, i) => dataRow(d.date, `${d.value.toLocaleString()} ${d.unit}`, i % 2 === 0));
    }

    // ── Daily Calories ────────────────────────────────────────────────
    if (caloriesDays.length > 0) {
      sectionHeader('DAILY CALORIES');
      caloriesDays.forEach((d, i) => dataRow(d.date, `${d.value.toLocaleString()} ${d.unit}`, i % 2 === 0));
    }

    // ── Workouts ──────────────────────────────────────────────────────
    if (completedWorkouts.length > 0) {
      sectionHeader('COMPLETED WORKOUTS');
      completedWorkouts.forEach((w, i) => {
        const d = new Date(w.scheduledAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        dataRow(d, `${w.name}  ·  ${w.durationMins} min  ·  ${w.caloriesBurned} kcal`, i % 2 === 0);
      });
    }

    // ── Footer ────────────────────────────────────────────────────────
    doc.y += 20;
    doc.rect(LEFT, doc.y, RIGHT - LEFT, 2).fill('#0891B2');
    doc.y += 8;
    doc.fontSize(7.5).font('Helvetica').fillColor('#9CA3AF')
       .text('Generated by Nexara  ·  nexara.app  ·  This document contains personal health data. Keep it confidential.',
             LEFT, doc.y, { align: 'center', width: RIGHT - LEFT });

    doc.end();

  } catch (err) {
    console.error('exportWeeklyReport error:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to generate weekly report' });
  }
};
