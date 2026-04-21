import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { submitRating, getMyRating } from '../controllers/rating.controller';

const router = Router();

router.use(authMiddleware);
router.post('/', submitRating);
router.get('/me', getMyRating);

export default router;
