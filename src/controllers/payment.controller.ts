import { Request, Response } from 'express';
import Razorpay from 'razorpay';
import Stripe from 'stripe';
type StripeInstance = InstanceType<typeof Stripe>;
import crypto from 'crypto';
import { AuthRequest } from '../middleware/auth';
import prisma from '../utils/prisma';

// ── Gateway instances (lazy — only init if keys are set) ─────────────────────

let razorpay: Razorpay | null = null;
if (process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes('REPLACE_ME')) {
  razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

let stripe: StripeInstance | null = null;
if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('REPLACE_ME')) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
}

// ── Plan pricing ──────────────────────────────────────────────────────────────

const PRICES = {
  inr: { monthly: 49900, yearly: 299900 },  // paise (₹499, ₹2,999)
  usd: { monthly:   699, yearly:  3999  },  // cents ($6.99, $39.99)
};

const PLAN_DAYS: Record<string, number> = { monthly: 30, yearly: 365 };

// ── POST /users/:user_id/payment/razorpay/create-order ────────────────────────
// Body: { plan: 'monthly' | 'yearly', currency: 'inr' }
export const createRazorpayOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  if (!razorpay) {
    res.status(503).json({ message: 'Razorpay not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env' });
    return;
  }

  const { plan } = req.body as { plan: 'monthly' | 'yearly' };
  if (!plan || !['monthly', 'yearly'].includes(plan)) {
    res.status(400).json({ message: 'plan must be monthly or yearly' });
    return;
  }

  const amount = PRICES.inr[plan];

  const order = await (razorpay.orders.create as Function)({
    amount,
    currency: 'INR',
    receipt:  `nexara_${user_id.slice(0, 8)}_${Date.now()}`,
    notes:    { userId: user_id, plan },
  });

  res.json({
    orderId:   order.id,
    amount:    order.amount,
    currency:  order.currency,
    keyId:     process.env.RAZORPAY_KEY_ID,
    plan,
  });
};

// ── POST /users/:user_id/payment/razorpay/verify ──────────────────────────────
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan }
export const verifyRazorpayPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body as {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    plan: 'monthly' | 'yearly';
  };

  // Verify HMAC signature
  const body      = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected  = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(body).digest('hex');

  if (expected !== razorpay_signature) {
    res.status(400).json({ message: 'Payment verification failed — invalid signature' });
    return;
  }

  // Activate subscription
  await activateSubscription(user_id, plan, razorpay_payment_id, 'razorpay');

  res.json({ success: true, message: `${plan} subscription activated!`, plan });
};

// ── POST /users/:user_id/payment/stripe/create-intent ────────────────────────
// Body: { plan: 'monthly' | 'yearly', currency: 'usd' }
export const createStripeIntent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  if (!stripe) {
    res.status(503).json({ message: 'Stripe not configured. Add STRIPE_SECRET_KEY to .env' });
    return;
  }

  const { plan } = req.body as { plan: 'monthly' | 'yearly' };
  if (!plan || !['monthly', 'yearly'].includes(plan)) {
    res.status(400).json({ message: 'plan must be monthly or yearly' });
    return;
  }

  const amount = PRICES.usd[plan];

  const intent = await stripe.paymentIntents.create({
    amount,
    currency:              'usd',
    automatic_payment_methods: { enabled: true },
    metadata:              { userId: user_id, plan },
    description:           `Nexara Pro — ${plan} subscription`,
  });

  res.json({
    clientSecret:     intent.client_secret,
    publishableKey:   process.env.STRIPE_PUBLISHABLE_KEY,
    amount,
    currency:         'usd',
    plan,
  });
};

// ── POST /users/:user_id/payment/stripe/confirm ───────────────────────────────
// Body: { paymentIntentId, plan }
export const confirmStripePayment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { user_id } = req.params;
  if (req.userId !== user_id) { res.status(403).json({ message: 'Forbidden' }); return; }

  if (!stripe) {
    res.status(503).json({ message: 'Stripe not configured' });
    return;
  }

  const { paymentIntentId, plan } = req.body as { paymentIntentId: string; plan: 'monthly' | 'yearly' };

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.status !== 'succeeded') {
    res.status(400).json({ message: `Payment not completed. Status: ${intent.status}` });
    return;
  }

  // Verify the intent belongs to this user
  if (intent.metadata.userId !== user_id) {
    res.status(403).json({ message: 'Payment intent does not belong to this user' });
    return;
  }

  await activateSubscription(user_id, plan, paymentIntentId, 'stripe');

  res.json({ success: true, message: `${plan} subscription activated!`, plan });
};

// ── POST /payment/stripe/webhook ──────────────────────────────────────────────
// Stripe sends events here — handles payment_intent.succeeded as backup
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  if (!stripe) { res.sendStatus(200); return; }

  const sig = req.headers['stripe-signature'] as string;
  let event: ReturnType<StripeInstance['webhooks']['constructEvent']>;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    res.status(400).json({ message: 'Webhook signature verification failed' });
    return;
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as { id: string; metadata: Record<string, string> };
    const { userId, plan } = intent.metadata;
    if (userId && plan) {
      await activateSubscription(userId, plan as 'monthly' | 'yearly', intent.id, 'stripe');
    }
  }

  res.sendStatus(200);
};

// ── Shared: activate subscription in DB ──────────────────────────────────────

const activateSubscription = async (
  userId: string,
  plan: 'monthly' | 'yearly',
  paymentRef: string,
  gateway: 'razorpay' | 'stripe',
) => {
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + PLAN_DAYS[plan] * 86400000);

  const existing = await prisma.subscription.findUnique({ where: { userId } });

  if (existing) {
    await prisma.subscription.update({
      where: { userId },
      data:  { plan, status: 'active', startedAt: now, expiresAt, updatedAt: now },
    });
  } else {
    await prisma.subscription.create({
      data: { userId, plan, status: 'active', startedAt: now, expiresAt },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action:   `payment.${plan}.${gateway}`,
      metadata: { plan, paymentRef, gateway, expiresAt },
    },
  });
};
