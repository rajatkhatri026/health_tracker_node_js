import { Router } from 'express';
import { getSteps, syncSteps, syncStepsBulk } from '../controllers/steps.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router({ mergeParams: true });

router.use(authMiddleware);
router.get('/', getSteps);
router.post('/sync', syncSteps);
router.post('/sync/bulk', syncStepsBulk);

export default router;
