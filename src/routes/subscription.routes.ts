import { Router } from 'express';
import { getSubscription, startSubscription, cancelSubscription, weeklyCheckin, getCheckins } from '../controllers/subscription.controller';

const router = Router({ mergeParams: true });

router.get('/',           getSubscription);
router.post('/start',     startSubscription);
router.post('/cancel',    cancelSubscription);
router.post('/checkin',   weeklyCheckin);
router.get('/checkins',   getCheckins);

export default router;
