import { Response } from 'express';
import Groq from 'groq-sdk';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';
import { decryptIfPresent } from '../utils/phi-crypto';

let _groq: Groq | null = null;
const getGroq = () => {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Gather user's health context to inject as system prompt
const buildHealthContext = async (userId: string): Promise<string> => {
  const [user, metrics, goals, workouts, steps, water] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    }),
    prisma.metric.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: 30,
    }),
    prisma.goal.findMany({
      where: { userId, status: 'active' },
    }),
    prisma.workout.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'desc' },
      take: 10,
    }),
    prisma.metric.findMany({
      where: { userId, type: 'steps', timestamp: { gte: new Date(Date.now() - 7 * 86400000) } },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.metric.findMany({
      where: { userId, type: 'nutrition', timestamp: { gte: new Date(Date.now() - 7 * 86400000) } },
      orderBy: { timestamp: 'desc' },
    }),
  ]);

  const name = decryptIfPresent(user?.name) ?? 'User';
  const gender = user?.gender ?? 'unknown';
  const dob = user?.dob ? decryptIfPresent(user.dob) : null;
  const age = dob ? Math.floor((Date.now() - new Date(dob as string).getTime()) / (365.25 * 86400000)) : null;
  const height = user?.profile?.height;
  const weight = user?.profile?.baselineWeight;
  const bmi = height && weight ? (weight / ((height / 100) ** 2)).toFixed(1) : null;

  // Latest metrics per type
  const latestByType: Record<string, string> = {};
  for (const m of metrics) {
    if (!latestByType[m.type]) {
      latestByType[m.type] = `${m.value} ${m.unit}`;
    }
  }

  const avgSteps = steps.length
    ? Math.round(steps.reduce((s, m) => s + m.value, 0) / steps.length)
    : null;
  const avgCalories = water.length
    ? Math.round(water.reduce((s, m) => s + m.value, 0) / water.length)
    : null;

  const activeGoals = goals.map(
    (g) => `${g.metricType}: target ${g.targetValue}${g.currentValue != null ? `, current ${g.currentValue}` : ''} (${g.recurrence})`
  );

  const recentWorkouts = workouts.slice(0, 5).map(
    (w) => `${w.name} (${w.category}, ${w.durationMins}min, ${w.status})`
  );

  return `You are Nexara AI, the intelligent health companion built into the Nexara health tracking app. You are knowledgeable, warm, and data-driven.

USER PROFILE:
- Name: ${name}
- Age: ${age ?? 'unknown'}, Gender: ${gender}
- Height: ${height ? `${height}cm` : 'unknown'}, Weight: ${weight ? `${weight}kg` : 'unknown'}, BMI: ${bmi ?? 'unknown'}

RECENT HEALTH DATA (last 30 days):
- Weight: ${latestByType['weight'] ?? 'no data'}
- Blood pressure: ${latestByType['blood_pressure'] ?? 'no data'}
- Glucose: ${latestByType['glucose'] ?? 'no data'}
- Sleep: ${latestByType['sleep'] ?? 'no data'}
- Activity: ${latestByType['activity'] ?? 'no data'}
- Calories burned: ${latestByType['calories_burned'] ?? 'no data'}

LAST 7 DAYS:
- Average daily steps: ${avgSteps ?? 'no data'}
- Average daily calories: ${avgCalories ?? 'no data'}

ACTIVE GOALS:
${activeGoals.length ? activeGoals.join('\n') : 'No active goals'}

RECENT WORKOUTS:
${recentWorkouts.length ? recentWorkouts.join('\n') : 'No recent workouts'}

INSTRUCTIONS:
- Be warm, encouraging, and concise. Use the user's name occasionally.
- Give specific, actionable advice based on their real data.
- Keep responses under 200 words unless a detailed plan is requested.
- Use emojis sparingly to keep the tone friendly.
- Never diagnose medical conditions. Recommend seeing a doctor for medical concerns.
- Format lists with bullet points when helpful.
- Today's date: ${new Date().toDateString()}`;
};

// POST /users/:user_id/ai/chat
export const chat = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const { messages } = req.body as { messages?: ChatMessage[] };
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ message: 'messages array is required' });
    return;
  }

  // Limit conversation history to last 20 messages to control token usage
  const recentMessages = messages.slice(-20);

  try {
    let systemPrompt: string;
    try {
      systemPrompt = await buildHealthContext(user_id);
    } catch (ctxErr) {
      console.error('AI buildHealthContext error:', ctxErr);
      systemPrompt = `You are Nexara AI, an intelligent health companion. Be warm, concise, and helpful. Today's date: ${new Date().toDateString()}`;
    }

    const completion = await getGroq().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
      ],
      max_tokens: 400,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
    res.json({ reply });
  } catch (err: unknown) {
    const groqErr = err as { status?: number; message?: string; error?: { message?: string } };
    console.error('AI chat error — status:', groqErr?.status, '| message:', groqErr?.message, '| error:', groqErr?.error);
    const status = groqErr?.status ?? 0;
    const msg = groqErr?.error?.message ?? groqErr?.message ?? 'Unknown error';
    if (status === 401 || msg.includes('api_key') || msg.includes('Invalid API Key')) {
      res.status(503).json({ message: 'AI service not configured. Please add your Groq API key.' });
    } else if (status === 429) {
      res.status(429).json({ message: 'Rate limit reached. Please wait a moment.' });
    } else {
      res.status(500).json({ message: `AI error: ${msg}` });
    }
  }
};
