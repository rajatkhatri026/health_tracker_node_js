import { Router, raw } from 'express';
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  createStripeIntent,
  confirmStripePayment,
  stripeWebhook,
} from '../controllers/payment.controller';

// Webhook route needs raw body — registered separately in app.ts
export const stripeWebhookRouter = Router();
stripeWebhookRouter.post('/stripe/webhook', raw({ type: 'application/json' }), stripeWebhook);

// Authenticated payment routes (merged with user router in app.ts)
const router = Router({ mergeParams: true });

router.post('/razorpay/create-order', createRazorpayOrder);
router.post('/razorpay/verify',       verifyRazorpayPayment);
router.post('/stripe/create-intent',  createStripeIntent);
router.post('/stripe/confirm',        confirmStripePayment);

export default router;
